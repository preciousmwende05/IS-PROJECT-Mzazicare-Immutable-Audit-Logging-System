import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

// Same data → same text, always: keys sorted at every level, Dates as ISO strings.
export const canonicalJson = (value: unknown): string => {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${parts.join(",")}}`;
};

// Plain SHA-256 fingerprint: used to recognise a retried event (idempotency), not to seal.
export const fingerprint = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

export type SealableEntry = {
  sequence: number;
  eventKey: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  ip: string | null;
  metadata: unknown;
  occurredAt: Date;
  sealedAt: Date;
  previousHash: string;
};

// HMAC-SHA-256 over the canonical entry, which includes the previous entry's hash.
export const sealEntry = (entry: SealableEntry, secret: string): string =>
  createHmac("sha256", secret).update(canonicalJson(entry)).digest("hex");

// Constant-time comparison so timing can't reveal how much of a hash matched.
export const hashesEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
};