/**
 * U-CS 78 — anomaly alerts for admins and auditors.
 *
 *   detectRuleBreaches   policy rules over the live audit log (every few minutes)
 *   verifyChainScheduled the hash-chain check on a timer, result kept for the UI
 *   notifyPending        tell every active admin and auditor about new alerts,
 *                        whichever source raised them (rules, model, chain)
 *
 * The rules are the same as the ML pipeline's POLICY_RULES
 * (ml/audit-anomaly/src/config.py): no honest window reached them in 41,696
 * simulated windows, so they alert at once without waiting for the model.
 */

import logger from "@/shared/config/logger";
import { redis } from "@/shared/config/redis";
import { ConflictError } from "@/shared/errors";
import { recordAuditEvent } from "@/shared/middleware/audit.middleware";
import { notify } from "@/shared/notifications";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import type { AuditAnomaly } from "@/modules/audit-service/models/audit-anomaly.model";
import { anomalyRepository } from "@/modules/audit-service/repository/anomaly.repository";
import { auditService } from "@/modules/audit-service/services/audit.service";

export const POLICY_RULES = { denied_attempts: 3, failed_logins: 5 } as const;
const WINDOW_MS = 15 * 60_000;
const LOOKBACK_MS = 30 * 60_000;
const LAST_VERIFICATION_KEY = "audit:verification:last";

export type ScheduledVerification = {
  at: string;
  intact: boolean;
  checkedEntries: number | null;
  brokenAtSequence: number | null;
  reason: string | null;
};

type Counts = { denied: number; failed: number; role: string | null; first: Date; last: Date };

/** The actor a refusal belongs to: the signed-in user, or the phone tried at sign-in. */
const actorKey = (entry: { actorId?: string | null; metadata?: unknown; ip?: string | null }): string => {
  if (entry.actorId) return entry.actorId;
  const phone = ((entry.metadata ?? {}) as { subject?: { phone?: string } }).subject?.phone;
  return phone ? `phone:${phone}` : `ip:${entry.ip ?? "unknown"}`;
};

export const anomalyService = {
  /** Policy rules over the last 30 minutes, in fixed 15-minute windows. Idempotent. */
  detectRuleBreaches: async (now: Date = new Date()): Promise<number> => {
    const entries = await anomalyRepository.findRefusalsSince(new Date(now.getTime() - LOOKBACK_MS));
    const windows = new Map<string, Counts>();
    for (const e of entries) {
      const at = new Date(e.occurredAt);
      const start = Math.floor(at.getTime() / WINDOW_MS) * WINDOW_MS;
      const key = `${actorKey(e)}|${start}`;
      const w = windows.get(key) ?? { denied: 0, failed: 0, role: e.actorRole ?? null, first: at, last: at };
      if (e.action === "access.denied") w.denied += 1;
      else w.failed += 1;
      w.last = at;
      windows.set(key, w);
    }

    let raised = 0;
    for (const [key, w] of windows) {
      const [actor, startMs] = key.split("|") as [string, string];
      const windowStart = new Date(Number(startMs));
      const breaches: [string, string, number][] = [];
      if (w.denied >= POLICY_RULES.denied_attempts) breaches.push(["access_denied_burst", `${w.denied} refused requests in 15 minutes`, w.denied]);
      if (w.failed >= POLICY_RULES.failed_logins) breaches.push(["failed_login_burst", `${w.failed} failed sign-ins in 15 minutes`, w.failed]);
      for (const [kind, summary] of breaches) {
        const created = await anomalyRepository.createOnce({
          key: `policy:${kind}:${actor}:${windowStart.toISOString()}`,
          source: "policy",
          kind,
          actorId: actor,
          actorRole: w.role,
          windowStart,
          windowEnd: new Date(windowStart.getTime() + WINDOW_MS),
          score: null,
          summary,
          reasons: [`RULE ${kind === "access_denied_burst" ? "denied_attempts" : "failed_logins"} >= ${kind === "access_denied_burst" ? POLICY_RULES.denied_attempts : POLICY_RULES.failed_logins}`],
          counts: { denied: w.denied, failed: w.failed },
        });
        if (created) raised += 1;
      }
    }
    return raised;
  },

  /** The scheduled integrity check. A broken chain raises a critical alert. */
  verifyChainScheduled: async (): Promise<ScheduledVerification> => {
    const result = (await auditService.verify()) as {
      intact: boolean;
      checkedEntries?: number;
      brokenAtSequence?: number;
      reason?: string;
    };
    const record: ScheduledVerification = {
      at: new Date().toISOString(),
      intact: result.intact,
      checkedEntries: result.checkedEntries ?? null,
      brokenAtSequence: result.brokenAtSequence ?? null,
      reason: result.reason ?? null,
    };
    await redis.set(LAST_VERIFICATION_KEY, JSON.stringify(record));
    if (!result.intact) {
      logger.error(`[audit] scheduled verification FAILED at ${record.brokenAtSequence}: ${record.reason}`);
      await anomalyRepository.createOnce({
        key: `chain:broken:${record.brokenAtSequence ?? "unknown"}`,
        source: "chain",
        kind: "chain_broken",
        actorId: null,
        actorRole: null,
        windowStart: null,
        windowEnd: null,
        score: null,
        summary: `Audit chain broken at entry ${record.brokenAtSequence ?? "?"}: ${record.reason ?? "unknown reason"}`,
        reasons: [record.reason ?? "integrity check failed"],
        counts: {},
      });
      recordAuditEvent({
        action: "audit.chain.verification_failed",
        actorId: null,
        actorRole: "system",
        outcome: "failure",
        subject: { brokenAtSequence: record.brokenAtSequence, reason: record.reason },
      });
    }
    return record;
  },

  lastVerification: async (): Promise<ScheduledVerification | null> => {
    const raw = await redis.get(LAST_VERIFICATION_KEY);
    return raw ? (JSON.parse(raw) as ScheduledVerification) : null;
  },

  /** Every new alert (any source) → in-app notification to all active admins and auditors. */
  notifyPending: async (): Promise<number> => {
    const pending = await anomalyRepository.findUnnotified();
    for (const a of pending) {
      const chain = a.source === "chain";
      await notify(
        {
          template: chain ? "audit.chain.failed" : "audit.anomaly.detected",
          audience: { roles: ["admin", "auditor"] },
          urgency: "high",
          data: {
            anomalyId: String(a._id),
            who: a.actorId?.startsWith("phone:") ? `Sign-ins for ${a.actorId.slice(6)}` : a.actorId ? `User ${a.actorId.slice(-5).toUpperCase()}` : "System",
            role: a.actorRole ?? "unknown role",
            summary: a.summary,
            brokenAt: chain ? (a.summary.match(/entry (\d+)/)?.[1] ?? "") : undefined,
          },
        },
        { dedupeKey: `anomaly:${String(a._id)}` },
      );
      await anomalyRepository.markNotified(a._id);
    }
    return pending.length;
  },

  list: async (query: { status?: string; page?: unknown; limit?: unknown }) => {
    const { page, limit, skip } = parsePagination(query);
    const where = query.status ? { status: query.status } : {};
    const [items, total] = await anomalyRepository.findPage(where, skip, limit);
    return buildPage<AuditAnomaly>(items, total, page, limit);
  },

  resolve: async (id: string, actorId: string, note: string): Promise<AuditAnomaly> => {
    const resolved = await anomalyRepository.resolve(id, actorId, note);
    if (!resolved) throw new ConflictError("This alert is not open (already resolved, or not found)");
    return resolved;
  },
};
