import type { AuditLog } from "@/modules/audit-service/models/audit-log.model";

export type AuditLogView = {
  id: string;
  sequence: number;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  ip: string | null;
  metadata: unknown;
  occurredAt: string;
  sealedAt: string;
  previousHash: string;
  hash: string;
};

export const serializeAuditLog = (entry: AuditLog): AuditLogView => ({
  id: String(entry._id),
  sequence: entry.sequence,
  action: entry.action,
  actorId: entry.actorId ?? null,
  actorRole: entry.actorRole ?? null,
  targetType: entry.targetType ?? null,
  targetId: entry.targetId ?? null,
  requestId: entry.requestId ?? null,
  ip: entry.ip ?? null,
  metadata: entry.metadata ?? {},
  occurredAt: new Date(entry.occurredAt).toISOString(),
  sealedAt: new Date(entry.sealedAt).toISOString(),
  previousHash: entry.previousHash,
  hash: entry.hash,
});