/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

/**
 * Every business rule for U-CS 78 lives here.
 *
 * No express types in this file. If you cannot call a function from a worker
 * or a seed script, it is in the wrong layer.
 */

import { env } from "@/shared/config/env";
import { ConflictError, NotFoundError } from "@/shared/errors";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import type { AuditLog } from "@/modules/audit-service/models/audit-log.model";
import { auditRepository } from "@/modules/audit-service/repository/audit.repository";
import {
  GENESIS_HASH,
  fingerprint,
  hashesEqual,
  sealEntry,
  type SealableEntry,
} from "@/modules/audit-service/services/audit.crypto";

const MAX_SEQUENCE_ATTEMPTS = 5;
const CHECKPOINT_EVERY = 25;

const getAuditHmacSecret = (): string => {
  const secret = process.env.AUDIT_HMAC_SECRET;
  if (!secret) throw new Error("AUDIT_HMAC_SECRET is not configured");
  return secret;
};

// ---------- small helpers ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asText = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

// The exact payload shape lives in shared/events/types.ts; read common field names defensively.
const pickText = (source: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const found = asText(source[key]);
    if (found) return found;
  }
  return null;
};

const pickDate = (source: Record<string, unknown>, ...keys: string[]): Date => {
  for (const key of keys) {
    const raw = source[key];
    if (typeof raw === "string" || typeof raw === "number" || raw instanceof Date) {
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return new Date();
};

const isDuplicateKeyOn = (error: unknown, field: string): boolean => {
  const err = error as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  if (err?.code !== 11000) return false;
  if (err.keyPattern) return field in err.keyPattern;
  return String(err.message ?? "").includes(field);
};

// One seal at a time inside this process, so sequences are assigned in order.
let queueTail: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => undefined);
  return run;
};

const toSealable = (entry: AuditLog): SealableEntry => ({
  sequence: entry.sequence,
  eventKey: entry.eventKey,
  action: entry.action,
  actorId: entry.actorId ?? null,
  actorRole: entry.actorRole ?? null,
  targetType: entry.targetType ?? null,
  targetId: entry.targetId ?? null,
  requestId: entry.requestId ?? null,
  ip: entry.ip ?? null,
  metadata: entry.metadata ?? {},
  occurredAt: new Date(entry.occurredAt),
  sealedAt: new Date(entry.sealedAt),
  previousHash: entry.previousHash,
});

export type VerificationResult =
  | {
      intact: true;
      checkedEntries: number;
      lastSequence: number;
      lastHash: string;
      checkpointSequence: number | null;
    }
  | { intact: false; checkedEntries: number; brokenAtSequence: number; reason: string };

// ---------- service ----------

export const auditService = {
  record: (payload: unknown) =>
    oneAtATime(async () => {
      const source = isRecord(payload) ? payload : { value: payload };
      const eventKey = fingerprint(source);

      // Idempotency: a retried event is recognised and not written twice.
      const already = await auditRepository.findByEventKey(eventKey);
      if (already) return already;

      const actor = isRecord(source.actor) ? source.actor : {};
      const fields = {
        eventKey,
        action: pickText(source, "action", "event", "type") ?? "unknown",
        actorId:
          pickText(source, "actorId", "userId", "performedBy") ?? pickText(actor, "id", "userId"),
        actorRole: pickText(source, "actorRole", "role") ?? pickText(actor, "role"),
        targetType: pickText(source, "targetType", "resourceType", "entity"),
        targetId: pickText(source, "targetId", "resourceId", "entityId"),
        requestId: pickText(source, "requestId"),
        ip: pickText(source, "ip", "ipAddress"),
        metadata: source,
        occurredAt: pickDate(source, "occurredAt", "timestamp", "at", "createdAt"),
      };

      for (let attempt = 1; attempt <= MAX_SEQUENCE_ATTEMPTS; attempt += 1) {
        const last = await auditRepository.findLast();
        const sealable: SealableEntry = {
          ...fields,
          sequence: (last?.sequence ?? 0) + 1,
          previousHash: last?.hash ?? GENESIS_HASH,
          sealedAt: new Date(),
        };
        const hash = sealEntry(sealable, getAuditHmacSecret());

        try {
          const saved = await auditRepository.create({ ...sealable, hash });
          if (saved.sequence % CHECKPOINT_EVERY === 0) {
            await auditRepository.createCheckpoint({
              sequence: saved.sequence,
              hash: saved.hash,
              recordedAt: new Date(),
            });
          }
          return saved;
        } catch (error) {
          if (isDuplicateKeyOn(error, "eventKey")) {
            const existing = await auditRepository.findByEventKey(eventKey);
            if (existing) return existing;
          }
          if (isDuplicateKeyOn(error, "sequence")) continue; // another writer took this slot; retry
          throw error;
        }
      }

      throw new ConflictError("Could not allocate an audit sequence after several attempts");
    }),

  verify: async (): Promise<VerificationResult> => {
    const checkpoint = await auditRepository.latestCheckpoint();
    let expectedSequence = 1;
    let previousHash = GENESIS_HASH;
    let checked = 0;

    for await (const entry of auditRepository.streamInOrder()) {
      if (entry.sequence !== expectedSequence) {
        return {
          intact: false,
          checkedEntries: checked,
          brokenAtSequence: expectedSequence,
          reason: `Entry ${expectedSequence} is missing (next entry found is ${entry.sequence})`,
        };
      }
      if (entry.previousHash !== previousHash) {
        return {
          intact: false,
          checkedEntries: checked,
          brokenAtSequence: entry.sequence,
          reason: "previousHash does not match the hash of the entry before it",
        };
      }
      const recomputed = sealEntry(toSealable(entry), getAuditHmacSecret());
      if (!hashesEqual(recomputed, entry.hash)) {
        return {
          intact: false,
          checkedEntries: checked,
          brokenAtSequence: entry.sequence,
          reason: "Content was altered or the seal was forged (hash does not match)",
        };
      }
      if (checkpoint && entry.sequence === checkpoint.sequence && entry.hash !== checkpoint.hash) {
        return {
          intact: false,
          checkedEntries: checked,
          brokenAtSequence: entry.sequence,
          reason: "Entry does not match the checkpoint recorded for this position",
        };
      }

      previousHash = entry.hash;
      expectedSequence += 1;
      checked += 1;
    }

    if (checkpoint && checked < checkpoint.sequence) {
      return {
        intact: false,
        checkedEntries: checked,
        brokenAtSequence: checked + 1,
        reason: `Chain ends at ${checked} but a checkpoint proves it reached ${checkpoint.sequence}: newest entries were deleted`,
      };
    }

    return {
      intact: true,
      checkedEntries: checked,
      lastSequence: checked,
      lastHash: previousHash,
      checkpointSequence: checkpoint?.sequence ?? null,
    };
  },

  list: async (
    filters: { action?: string; actorId?: string; from?: string; to?: string },
    query: { page?: unknown; limit?: unknown },
  ) => {
    const { page, limit, skip } = parsePagination(query);
    const where: Record<string, unknown> = {};
    if (filters.action) where.action = filters.action;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.$gte = new Date(filters.from);
      if (filters.to) range.$lte = new Date(filters.to);
      where.occurredAt = range;
    }
    const [items, total] = await auditRepository.findPage(where, skip, limit);
    return buildPage(items, total, page, limit);
  },

  getBySequence: async (sequence: number) => {
    const entry = await auditRepository.findBySequence(sequence);
    if (!entry) throw new NotFoundError("Audit entry");
    return entry;
  },

  /**
   * Every entry about one record, newest first ("who accessed my data").
   * Seeded simulator entries are excluded: they are not real people. The caller
   * decides who may see this; it is a plain read here.
   */
  listForTarget: async (
    targetType: string,
    targetId: string,
    query: { page?: unknown; limit?: unknown },
  ) => {
    const { page, limit, skip } = parsePagination(query);
    const where = { targetType, targetId, "metadata.seed": { $ne: true } };
    const [items, total] = await auditRepository.findPage(where, skip, limit);
    return buildPage(items, total, page, limit);
  },
};