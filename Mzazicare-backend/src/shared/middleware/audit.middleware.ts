import type { NextFunction, Request, Response } from "express";

import logger from "@/shared/config/logger";
import { publish } from "@/shared/events/bus";

type Subject = (req: Request) => Record<string, unknown>;
/** A fixed name, or one derived from the request (e.g. from the new status). */
type Action = string | ((req: Request) => string);

/**
 * Which record an entry is about, taken from its subject. The first key found
 * wins, so an entry naming both an elder and a user is filed under the elder.
 * "Who accessed my data" (U-CS 78 + consent) filters on targetType/targetId.
 */
const TARGET_KEYS: [key: string, type: string][] = [
  ["elderId", "elder"],
  ["visitId", "visit"],
  ["bookingId", "booking"],
  ["serviceId", "service"],
  ["userId", "user"],
];

const targetOf = (subject: Record<string, unknown>): { targetType?: string; targetId?: string } => {
  for (const [key, type] of TARGET_KEYS) {
    const value = subject[key];
    if (typeof value === "string" && value) return { targetType: type, targetId: value };
  }
  return {};
};

export type AuditEvent = {
  action: string;
  actorId: string | null;
  actorRole: string;
  subject?: Record<string, unknown>;
  outcome?: "success" | "failure";
  statusCode?: number;
  requestId?: string;
  ip?: string;
  userAgent?: string;
};

/**
 * Record an audit entry from anywhere (services, workers), not just routes.
 * Never throws: an audit write failing must not fail the user's request, but
 * it is logged loudly.
 */
export const recordAuditEvent = (event: AuditEvent): void => {
  const subject = event.subject ?? {};
  void publish("audit.recorded", {
    ...event,
    subject,
    ...targetOf(subject),
    occurredAt: new Date().toISOString(),
  }).catch((err) => logger.error(`[audit] failed to record ${event.action}: ${err.message}`));
};

const record = (
  req: Request,
  res: Response,
  action: Action,
  subject: Subject | undefined,
  outcome: "success" | "failure",
) =>
  recordAuditEvent({
    action: typeof action === "function" ? action(req) : action,
    outcome,
    statusCode: res.statusCode,
    // Routes without a token (login) can name the actor via res.locals.
    actorId: req.user?.id ?? (res.locals.actorId as string | undefined) ?? null,
    actorRole: req.user?.role ?? (res.locals.actorRole as string | undefined) ?? "anonymous",
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    subject: subject?.(req) ?? {},
  });

/**
 * Records a completed action into the immutable audit trail (U-CS 78).
 *
 * Attach it to any route whose outcome must be provable after the fact:
 *
 *   router.post("/:id/approve",
 *     authMiddleware,
 *     requirePermission("caregivers:approve"),
 *     audit("caregiver.approved", (req) => ({ caregiverId: req.params.id })),
 *     caregiverController.approve);
 *
 * It fires only after a 2xx/3xx response, so a failed attempt never lands in
 * the compliance record as though it had succeeded.
 */
export const audit =
  (action: Action, subject?: Subject) => (req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      record(req, res, action, subject, "success");
    });
    next();
  };

/**
 * Records a REFUSED attempt (4xx): wrong password, locked account, access
 * denied, rate-limited. These are the signals anomaly detection needs.
 * 5xx is our fault, not the caller's, so it is not recorded here.
 * Put it FIRST in the chain so even rate-limited requests are captured.
 */
export const auditFailure =
  (action: Action, subject?: Subject) => (req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      if (res.statusCode < 400 || res.statusCode >= 500) return;
      record(req, res, action, subject, "failure");
    });
    next();
  };

/**
 * App-wide: every 403 is recorded as `access.denied` — a signed-in user asked
 * for something their role or care-circle access does not allow. Mounted once
 * in app.ts, before the routers. Login refusals are skipped here because the
 * login route already records them as `auth.login.failed`.
 */
export const auditAccessDenied = (req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => {
    if (res.statusCode !== 403) return;
    const path = req.originalUrl.split("?")[0] ?? "";
    if (path.endsWith("/auth/login")) return;
    const elderId = path.match(/\/elders\/([a-f\d]{24})/i)?.[1];
    record(req, res, "access.denied", () => ({ method: req.method, path, ...(elderId && { elderId }) }), "failure");
  });
  next();
};
