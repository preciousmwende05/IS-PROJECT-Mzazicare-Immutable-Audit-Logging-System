/**
 * U-CS 78: recording and verifying the hash chain.
 *
 * The repository is replaced by an in-memory array, so these tests exercise the
 * real service logic (sequencing, chaining, idempotency, checkpoints and every
 * tamper check in verify()) without a database. Each "attack" below edits the
 * stored array directly, the way someone with database access could.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditLog } from "@/modules/audit-service/models/audit-log.model";
import type { AuditCheckpoint } from "@/modules/audit-service/models/audit-checkpoint.model";

const store = vi.hoisted(() => ({
  logs: [] as Record<string, any>[],
  checkpoints: [] as Record<string, any>[],
}));

vi.mock("@/modules/audit-service/repository/audit.repository", () => ({
  auditRepository: {
    findLast: async () =>
      store.logs.length ? { ...store.logs.reduce((a, b) => (a.sequence > b.sequence ? a : b)) } : null,
    findByEventKey: async (eventKey: string) => store.logs.find((l) => l.eventKey === eventKey) ?? null,
    findBySequence: async (sequence: number) => store.logs.find((l) => l.sequence === sequence) ?? null,
    create: async (data: Record<string, any>) => {
      if (store.logs.some((l) => l.sequence === data.sequence)) {
        throw Object.assign(new Error("dup sequence"), { code: 11000, keyPattern: { sequence: 1 } });
      }
      const saved = { ...data };
      store.logs.push(saved);
      return { ...saved };
    },
    streamInOrder: () => {
      const ordered = [...store.logs].sort((a, b) => a.sequence - b.sequence).map((l) => ({ ...l }));
      return (async function* () {
        yield* ordered;
      })();
    },
    latestCheckpoint: async () =>
      store.checkpoints.length
        ? store.checkpoints.reduce((a, b) => (a.sequence > b.sequence ? a : b))
        : null,
    createCheckpoint: async (data: Record<string, any>) => {
      store.checkpoints.push({ ...data });
      return data;
    },
    findPage: async () => [[], 0],
  },
}));

const { auditService } = await import("@/modules/audit-service/services/audit.service");
const { GENESIS_HASH } = await import("@/modules/audit-service/services/audit.crypto");

const recordMany = async (count: number) => {
  for (let i = 1; i <= count; i += 1) {
    await auditService.record({ action: "elder.viewed", actorId: `user-${i}`, occurredAt: `2026-11-05T08:00:${String(i % 60).padStart(2, "0")}Z`, n: i });
  }
};

const bySequence = (sequence: number) => store.logs.find((l) => l.sequence === sequence)!;

beforeEach(() => {
  store.logs.length = 0;
  store.checkpoints.length = 0;
});

describe("auditService.record", () => {
  it("numbers entries 1, 2, 3 and links each one to the hash before it", async () => {
    await recordMany(3);
    const [first, second, third] = [1, 2, 3].map(bySequence) as AuditLog[];
    expect(first!.previousHash).toBe(GENESIS_HASH);
    expect(second!.previousHash).toBe(first!.hash);
    expect(third!.previousHash).toBe(second!.hash);
  });

  it("pulls the standard fields out of the event payload", async () => {
    const saved = await auditService.record({
      action: "careplan.viewed",
      actorId: "u-1",
      actorRole: "caregiver",
      targetType: "elder",
      targetId: "e-1",
      requestId: "r-1",
      ip: "10.0.0.9",
    });
    expect(saved).toMatchObject({
      action: "careplan.viewed",
      actorId: "u-1",
      actorRole: "caregiver",
      targetType: "elder",
      targetId: "e-1",
      requestId: "r-1",
      ip: "10.0.0.9",
    });
  });

  it("records a retried event only once (idempotency)", async () => {
    const event = { action: "visit.checked_in", actorId: "u-1", occurredAt: "2026-11-05T08:00:00Z" };
    const a = await auditService.record(event);
    const b = await auditService.record({ ...event });
    expect(store.logs).toHaveLength(1);
    expect(b.sequence).toBe(a.sequence);
  });

  it("keeps sequences gap free when many events arrive at once", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => auditService.record({ action: "x", n: i })),
    );
    expect(store.logs.map((l) => l.sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    expect((await auditService.verify()).intact).toBe(true);
  });

  it("writes a checkpoint every 25 entries", async () => {
    await recordMany(51);
    expect(store.checkpoints.map((c: AuditCheckpoint) => c.sequence)).toEqual([25, 50]);
    expect(store.checkpoints[1]!.hash).toBe(bySequence(50).hash);
  });
});

describe("auditService.verify", () => {
  it("reports an empty chain as intact", async () => {
    expect(await auditService.verify()).toMatchObject({ intact: true, checkedEntries: 0 });
  });

  it("reports an untouched chain as intact", async () => {
    await recordMany(30);
    expect(await auditService.verify()).toMatchObject({
      intact: true,
      checkedEntries: 30,
      lastSequence: 30,
      checkpointSequence: 25,
    });
  });

  it("detects an edited entry", async () => {
    await recordMany(10);
    bySequence(4).actorId = "someone-else";
    expect(await auditService.verify()).toMatchObject({ intact: false, brokenAtSequence: 4 });
  });

  it("detects edited metadata", async () => {
    await recordMany(10);
    bySequence(7).metadata = { ...bySequence(7).metadata, n: 999 };
    expect(await auditService.verify()).toMatchObject({ intact: false, brokenAtSequence: 7 });
  });

  it("detects an entry deleted from the middle", async () => {
    await recordMany(10);
    store.logs.splice(store.logs.indexOf(bySequence(5)), 1);
    const result = await auditService.verify();
    expect(result).toMatchObject({ intact: false, brokenAtSequence: 5 });
    if (!result.intact) expect(result.reason).toMatch(/missing/);
  });

  it("detects the newest entries being deleted, using the checkpoint", async () => {
    await recordMany(30);
    store.logs.splice(0, store.logs.length, ...store.logs.filter((l) => l.sequence <= 20));
    const result = await auditService.verify();
    expect(result).toMatchObject({ intact: false, checkedEntries: 20 });
    if (!result.intact) expect(result.reason).toMatch(/checkpoint/);
  });

  it("detects an entry whose hash was recomputed without the real key", async () => {
    await recordMany(5);
    const target = bySequence(3);
    target.action = "elder.deleted";
    target.hash = "a".repeat(64);
    expect(await auditService.verify()).toMatchObject({ intact: false, brokenAtSequence: 3 });
  });

  it("detects a broken link between entries", async () => {
    await recordMany(5);
    bySequence(4).previousHash = "b".repeat(64);
    const result = await auditService.verify();
    expect(result).toMatchObject({ intact: false, brokenAtSequence: 4 });
    if (!result.intact) expect(result.reason).toMatch(/previousHash/);
  });

  it("detects an entry that disagrees with its checkpoint", async () => {
    await recordMany(26);
    store.checkpoints[0]!.hash = "c".repeat(64);
    expect(await auditService.verify()).toMatchObject({ intact: false, brokenAtSequence: 25 });
  });
});

describe("auditService.getBySequence", () => {
  it("throws NotFound for a sequence that does not exist", async () => {
    await expect(auditService.getBySequence(42)).rejects.toMatchObject({ statusCode: 404 });
  });
});
