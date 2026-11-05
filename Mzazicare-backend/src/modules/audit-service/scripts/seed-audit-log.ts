/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru,
 */

/**
 * Builds DEVELOPMENT seed data for the audit log from the simulated activity in
 * ml/audit-anomaly (sim-v2), and exports it as MongoDB Extended JSON for a
 * Compass import.
 *
 * Every entry is sealed exactly like auditService.record() seals live events:
 * same canonical JSON, same HMAC-SHA-256, same AUDIT_HMAC_SECRET (read through
 * env.ts), same chaining and the same checkpoint interval. So /v1/audit/verify
 * accepts the seeded chain, and live events continue it seamlessly.
 *
 * Seeded entries are marked metadata.seed = true so they are never mistaken
 * for real activity.
 *
 * Usage (from Mzazicare-backend, after `python src/simulate.py` in ml/audit-anomaly):
 *   pnpm tsx src/modules/audit-service/scripts/seed-audit-log.ts \
 *     --csv ../ml/audit-anomaly/data/raw/audit_events_sim-v2.csv --count 15000 --out seed-data
 *
 * Then in Compass, into an EMPTY chain only:
 *   audit_logs        -> ADD DATA -> Import JSON -> seed-data/audit_logs.json
 *   audit_checkpoints -> ADD DATA -> Import JSON -> seed-data/audit_checkpoints.json
 */

/* eslint-disable no-console -- CLI script: printing progress is its job */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { env } from "@/shared/config/env";
import {
  GENESIS_HASH,
  fingerprint,
  sealEntry,
  type SealableEntry,
} from "@/modules/audit-service/services/audit.crypto";

// Must match CHECKPOINT_EVERY in services/audit.service.ts.
const CHECKPOINT_EVERY = 25;

type Args = { csv: string; count: number; out: string };

const parseArgs = (argv: string[]): Args => {
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    const value = i >= 0 ? argv[i + 1] : undefined;
    return value ?? fallback;
  };
  const count = Number(get("--count", "15000"));
  if (!Number.isInteger(count) || count < 1) throw new Error("--count must be a positive integer");
  return {
    csv: resolve(get("--csv", "../ml/audit-anomaly/data/raw/audit_events_sim-v2.csv")),
    count,
    out: resolve(get("--out", "seed-data")),
  };
};

type SimRow = {
  occurredAt: Date;
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  plantedIncident: string | null;
};

// The simulator's CSV has no quoted fields or embedded commas, so a plain split is safe.
const readSimulation = (path: string, limit: number): SimRow[] => {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = (lines[0] ?? "").split(",");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column "${name}" missing from ${path}`);
    return i;
  };
  const c = {
    occurredAt: col("occurredAt"),
    actorId: col("actorId"),
    actorRole: col("actorRole"),
    action: col("action"),
    targetType: col("targetType"),
    targetId: col("targetId"),
    ip: col("ip"),
    anomalyType: col("anomaly_type"),
  };
  const orNull = (v: string | undefined): string | null => (v && v.length > 0 ? v : null);

  return lines.slice(1, limit + 1).map((line) => {
    const f = line.split(",");
    const at = (i: number): string => f[i] ?? "";
    // pandas writes "2026-08-03 04:12:00+00:00"; make it strict ISO for Date.
    const occurredAt = new Date(at(c.occurredAt).replace(" ", "T"));
    if (Number.isNaN(occurredAt.getTime())) throw new Error(`Bad timestamp: ${at(c.occurredAt)}`);
    return {
      occurredAt,
      actorId: at(c.actorId),
      actorRole: at(c.actorRole),
      action: at(c.action),
      targetType: orNull(at(c.targetType)),
      targetId: orNull(at(c.targetId)),
      ip: orNull(at(c.ip)),
      plantedIncident: orNull(at(c.anomalyType)),
    };
  });
};

const ejsonDate = (d: Date): { $date: string } => ({ $date: d.toISOString() });

const main = (): void => {
  const secret: unknown = env.AUDIT_HMAC_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error(
      "AUDIT_HMAC_SECRET is missing at runtime (or shorter than 32 characters). " +
        "Check Mzazicare-backend/.env and the schema in src/shared/config/env.ts.",
    );
  }
  const args = parseArgs(process.argv.slice(2));
  const rows = readSimulation(args.csv, args.count);

  const logs: Record<string, unknown>[] = [];
  const checkpoints: Record<string, unknown>[] = [];
  let previousHash = GENESIS_HASH;

  rows.forEach((row, index) => {
    const sequence = index + 1;
    const metadata = {
      seed: true,
      simulation: "sim-v2",
      simulationRow: index,
      plantedIncident: row.plantedIncident, // ground truth kept for later evaluation only
    };
    // Sealed a moment after it happened, like the live queue.
    const sealedAt = new Date(row.occurredAt.getTime() + 500 + (index % 2500));

    const sealable: SealableEntry = {
      sequence,
      eventKey: fingerprint({ seed: "sim-v2", row: index, action: row.action, actorId: row.actorId }),
      action: row.action,
      actorId: row.actorId,
      actorRole: row.actorRole,
      targetType: row.targetType,
      targetId: row.targetId,
      requestId: null,
      ip: row.ip,
      metadata,
      occurredAt: row.occurredAt,
      sealedAt,
      previousHash,
    };
    const hash = sealEntry(sealable, secret);

    logs.push({
      ...sealable,
      occurredAt: ejsonDate(sealable.occurredAt),
      sealedAt: ejsonDate(sealable.sealedAt),
      hash,
    });
    if (sequence % CHECKPOINT_EVERY === 0) {
      checkpoints.push({ sequence, hash, recordedAt: ejsonDate(sealedAt) });
    }
    previousHash = hash;
  });

  mkdirSync(args.out, { recursive: true });
  writeFileSync(resolve(args.out, "audit_logs.json"), JSON.stringify(logs));
  writeFileSync(resolve(args.out, "audit_checkpoints.json"), JSON.stringify(checkpoints));

  const planted = rows.filter((r) => r.plantedIncident).length;
  console.log(`Sealed ${logs.length} entries (sequence 1..${logs.length}), ${planted} from planted incidents`);
  console.log(`Wrote ${checkpoints.length} checkpoints (every ${CHECKPOINT_EVERY})`);
  console.log(`Last hash: ${previousHash}`);
  console.log(`Files: ${resolve(args.out, "audit_logs.json")}`);
  console.log(`       ${resolve(args.out, "audit_checkpoints.json")}`);
};

main();