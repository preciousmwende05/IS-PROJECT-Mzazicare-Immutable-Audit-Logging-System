/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

/**
 * Controllers stay thin: read the request, call the service, shape the reply.
 * No database access, no business rules, and never res.status(4xx) — throw an
 * AppError and let error.middleware turn it into a response.
 *
 * import type { Request, Response } from "express";
 * import { asyncHandler } from "@/shared/utils/async.util";
 * import { created, paginated } from "@/shared/utils/response.util";
 * import { auditService } from "@/modules/audit-service/services/audit.service";
 * import { serializeAuditLog } from "@/modules/audit-service/views/audit.view";
 */

  // list: asyncHandler(async (req: Request, res: Response) => {
  //   const page = await auditService.list(req.query);
  //   return paginated(res, { ...page, items: page.items.map(serializeAuditLog) });
  // }),
  //
  // create: asyncHandler(async (req: Request, res: Response) => {
  //   const auditLog = await auditService.create(req.body, req.user!.id);
  //   return created(res, serializeAuditLog(auditLog));
  // }),
/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { ok, paginated } from "@/shared/utils/response.util";
import { auditService } from "@/modules/audit-service/services/audit.service";
import { serializeAuditLog } from "@/modules/audit-service/views/audit-log.view";
import type { AuditAnomaly } from "@/modules/audit-service/models/audit-anomaly.model";
import { anomalyService } from "@/modules/audit-service/services/anomaly.service";
import { authService } from "@/modules/auth-service/services/auth.service";

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Translates HTTP <-> domain. No rules here: read the request, call the
 * service, reply through the view.
 */
export const auditController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await auditService.list(
      {
        action: text(req.query.action),
        actorId: text(req.query.actorId),
        from: text(req.query.from),
        to: text(req.query.to),
      },
      req.query,
    );
    return paginated(res, { ...page, items: page.items.map(serializeAuditLog) });
  }),

  getBySequence: asyncHandler(async (req: Request, res: Response) => {
    const entry = await auditService.getBySequence(Number(req.params.sequence));
    return ok(res, serializeAuditLog(entry));
  }),

  verify: asyncHandler(async (_req: Request, res: Response) => {
    return ok(res, await auditService.verify());
  }),

  /** The latest automatic (scheduled) integrity check, or null before the first. */
  lastVerification: asyncHandler(async (_req: Request, res: Response) =>
    ok(res, await anomalyService.lastVerification()),
  ),

  anomalies: asyncHandler(async (req: Request, res: Response) => {
    const page = await anomalyService.list({ status: text(req.query.status), page: req.query.page, limit: req.query.limit });
    const names = await authService.getDisplayNames(page.items.map((a) => a.actorId ?? "").filter(Boolean));
    return paginated(res, { ...page, items: page.items.map((a) => serializeAnomaly(a, names)) });
  }),

  resolveAnomaly: asyncHandler(async (req: Request, res: Response) => {
    const a = await anomalyService.resolve(req.params.id!, req.user!.id, req.body.note);
    const names = await authService.getDisplayNames([a.actorId ?? "", a.resolvedBy ?? ""].filter(Boolean));
    return ok(res, serializeAnomaly(a, names));
  }),
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** An alert as admins and auditors see it: who, what, when, why. */
const serializeAnomaly = (a: AuditAnomaly, names: Map<string, { name: string; role: string }>) => ({
  id: String(a._id),
  reference: `AN-${String(a._id).slice(-5).toUpperCase()}`,
  source: a.source,
  kind: a.kind,
  actorId: a.actorId ?? null,
  actorName: a.actorId?.startsWith("phone:")
    ? `Sign-in attempts for ${a.actorId.slice(6)}`
    : a.actorId
      ? names.get(a.actorId)?.name ?? `User ${a.actorId.slice(-5).toUpperCase()}`
      : "System",
  actorRole: a.actorRole ?? null,
  windowStart: iso(a.windowStart),
  windowEnd: iso(a.windowEnd),
  score: a.score ?? null,
  summary: a.summary,
  reasons: a.reasons ?? [],
  status: a.status,
  createdAt: iso(a.createdAt),
  notifiedAt: iso(a.notifiedAt),
  resolvedBy: a.resolvedBy ? names.get(a.resolvedBy)?.name ?? a.resolvedBy : null,
  resolvedAt: iso(a.resolvedAt),
  resolution: a.resolution ?? null,
});
