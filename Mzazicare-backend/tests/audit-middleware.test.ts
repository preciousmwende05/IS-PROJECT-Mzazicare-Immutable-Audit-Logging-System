/**
 * U-CS 78: what reaches the audit trail from HTTP requests.
 *   audit()             successes only
 *   auditFailure()      refused attempts (4xx), e.g. auth.login.failed
 *   auditAccessDenied   every 403 as access.denied, tagged with the elder
 * The event bus is mocked, so each test inspects exactly what was published.
 */
import express, { type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as { event: string; payload: Record<string, any> }[]);

vi.mock("@/shared/events/bus", () => ({
  publish: async (event: string, payload: Record<string, any>) => {
    published.push({ event, payload });
  },
}));

const { audit, auditAccessDenied, auditFailure } = await import("@/shared/middleware/audit.middleware");

const ELDER_ID = "65f1a2b3c4d5e6f7a8b9c0d1";

const respond = (status: number) => (_req: Request, res: Response) => res.status(status).json({});

const buildApp = () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use((req, _res, next) => {
    req.requestId = "req-test";
    next();
  });
  app.use(auditAccessDenied);
  app.get("/elders/:id", audit("elder.viewed", (req) => ({ elderId: req.params.id })), respond(200));
  app.get("/elders/:id/broken", audit("elder.viewed"), respond(500));
  app.get(`/v1/elders/:id/care-plan`, respond(403));
  app.post("/v1/auth/login", auditFailure("auth.login.failed", (req) => ({ phone: req.body.phone })), express.json(), respond(401));
  app.post("/v1/auth/login-ok", auditFailure("auth.login.failed"), respond(200));
  app.post("/v2/auth/login", respond(403)); // e.g. a locked or deactivated account
  return app;
};

// Events are published after the response finishes; give them a tick.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  published.length = 0;
});

describe("audit() on successful requests", () => {
  it("records the action with who, what record and which request", async () => {
    await request(buildApp()).get(`/elders/${ELDER_ID}`).set("X-Forwarded-For", "41.90.1.2");
    await settle();

    expect(published).toHaveLength(1);
    expect(published[0]!.event).toBe("audit.recorded");
    expect(published[0]!.payload).toMatchObject({
      action: "elder.viewed",
      outcome: "success",
      statusCode: 200,
      actorRole: "anonymous",
      requestId: "req-test",
      targetType: "elder",
      targetId: ELDER_ID,
      ip: "41.90.1.2",
    });
  });

  it("does not record a request that failed", async () => {
    await request(buildApp()).get(`/elders/${ELDER_ID}/broken`);
    await settle();
    expect(published).toHaveLength(0);
  });
});

describe("auditFailure() on refused attempts", () => {
  it("records a failed sign-in with the phone that was tried", async () => {
    await request(buildApp()).post("/v1/auth/login").send({ phone: "+254700000001" });
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]!.payload).toMatchObject({
      action: "auth.login.failed",
      outcome: "failure",
      statusCode: 401,
      subject: { phone: "+254700000001" },
    });
  });

  it("records nothing when the sign-in succeeded", async () => {
    await request(buildApp()).post("/v1/auth/login-ok");
    await settle();
    expect(published).toHaveLength(0);
  });
});

describe("auditAccessDenied on every 403", () => {
  it("records access.denied and files it under the elder in the URL", async () => {
    await request(buildApp()).get(`/v1/elders/${ELDER_ID}/care-plan`);
    await settle();
    expect(published).toHaveLength(1);
    expect(published[0]!.payload).toMatchObject({
      action: "access.denied",
      outcome: "failure",
      statusCode: 403,
      targetType: "elder",
      targetId: ELDER_ID,
      subject: { method: "GET", path: `/v1/elders/${ELDER_ID}/care-plan` },
    });
  });

  it("leaves login refusals to auth.login.failed, so they are not counted twice", async () => {
    await request(buildApp()).post("/v2/auth/login");
    await settle();
    expect(published).toHaveLength(0);
  });
});
