/**
 * Who may do what. The auditor role must be able to read the audit log and
 * nothing else; a session must end the moment an admin cuts a user off.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisStore = vi.hoisted(() => ({ values: new Map<string, string>(), down: false }));

vi.mock("@/shared/config/redis", () => ({
  redis: {
    get: async (key: string) => {
      if (redisStore.down) throw new Error("redis unavailable");
      return redisStore.values.get(key) ?? null;
    },
    set: async (key: string, value: string) => {
      redisStore.values.set(key, value);
      return "OK";
    },
  },
}));

const { authMiddleware, cutOffAccessTokens } = await import("@/shared/middleware/auth.middleware");
const { requirePermission, requireRole } = await import("@/shared/middleware/role.middleware");
const { PERMISSIONS, PERMISSIONS_BY_ROLE } = await import("@/shared/middleware/permissions");
const { errorMiddleware } = await import("@/shared/middleware/error.middleware");
const { env } = await import("@/shared/config/env");

type Role = keyof typeof PERMISSIONS_BY_ROLE;

const tokenFor = (sub: string, role: Role, iat = Math.floor(Date.now() / 1000)) =>
  jwt.sign({ sub, role, iat }, env.JWT_SECRET);

const buildApp = () => {
  const app = express();
  app.get("/audit", authMiddleware, requirePermission("audit:read"), (_req, res) => res.json({ ok: true }));
  app.get("/admin", authMiddleware, requireRole("admin"), (_req, res) => res.json({ ok: true }));
  app.get("/me", authMiddleware, (req: Request, res: Response) => res.json(req.user));
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorMiddleware(err, req, res, next));
  return app;
};

beforeEach(() => {
  redisStore.values.clear();
  redisStore.down = false;
});

describe("role permissions", () => {
  it("gives the auditor read access to the audit log and nothing else", () => {
    expect(PERMISSIONS_BY_ROLE.auditor).toEqual(["audit:read"]);
  });

  it("gives the admin every permission", () => {
    expect([...PERMISSIONS_BY_ROLE.admin].sort()).toEqual([...PERMISSIONS].sort());
  });

  it.each(["family", "elder", "caregiver", "coordinator"] as Role[])(
    "does not let %s read the audit log",
    (role) => {
      expect(PERMISSIONS_BY_ROLE[role]).not.toContain("audit:read");
    },
  );
});

describe("route guards", () => {
  const app = buildApp();

  it.each([
    ["auditor", 200],
    ["admin", 200],
    ["family", 403],
    ["caregiver", 403],
    ["coordinator", 403],
  ] as [Role, number][])("audit log: %s gets %i", async (role, status) => {
    const res = await request(app).get("/audit").set("Authorization", `Bearer ${tokenFor("u-1", role)}`);
    expect(res.status).toBe(status);
  });

  it("refuses an auditor on admin-only routes", async () => {
    const res = await request(app).get("/admin").set("Authorization", `Bearer ${tokenFor("u-1", "auditor")}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("authMiddleware", () => {
  const app = buildApp();

  it("refuses a request with no token", async () => {
    expect((await request(app).get("/me")).status).toBe(401);
  });

  it("refuses a token signed with the wrong key", async () => {
    const forged = jwt.sign({ sub: "u-1", role: "admin" }, "not-the-real-secret-not-the-real-secret");
    expect((await request(app).get("/me").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  it("accepts a valid token and exposes the user", async () => {
    const res = await request(app).get("/me").set("Authorization", `Bearer ${tokenFor("u-7", "family")}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "u-7", role: "family" });
  });

  it("ends existing sessions immediately when a user is cut off", async () => {
    const oldToken = tokenFor("u-9", "caregiver", Math.floor(Date.now() / 1000) - 60);
    expect((await request(app).get("/me").set("Authorization", `Bearer ${oldToken}`)).status).toBe(200);

    await cutOffAccessTokens("u-9");

    const res = await request(app).get("/me").set("Authorization", `Bearer ${oldToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/session has ended/i);
  });

  it("fails closed when the session store cannot be reached", async () => {
    redisStore.down = true;
    const res = await request(app).get("/me").set("Authorization", `Bearer ${tokenFor("u-1", "admin")}`);
    expect(res.status).toBe(401);
  });
});
