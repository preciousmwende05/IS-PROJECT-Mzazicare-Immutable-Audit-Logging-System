/**
 * U-CS 78: the cryptographic building blocks of the audit chain.
 * If any of these change behaviour, every existing seal stops verifying.
 */
import { describe, expect, it } from "vitest";

import {
  GENESIS_HASH,
  canonicalJson,
  fingerprint,
  hashesEqual,
  sealEntry,
  type SealableEntry,
} from "@/modules/audit-service/services/audit.crypto";

const SECRET = "test-audit-hmac-secret-at-least-32-chars";

const entry = (overrides: Partial<SealableEntry> = {}): SealableEntry => ({
  sequence: 1,
  eventKey: "abc",
  action: "elder.viewed",
  actorId: "user-1",
  actorRole: "caregiver",
  targetType: "elder",
  targetId: "elder-1",
  requestId: "req-1",
  ip: "10.0.0.1",
  metadata: { path: "/v1/elders/elder-1" },
  occurredAt: new Date("2026-11-05T08:00:00.000Z"),
  sealedAt: new Date("2026-11-05T08:00:01.000Z"),
  previousHash: GENESIS_HASH,
  ...overrides,
});

describe("canonicalJson", () => {
  it("gives the same text whatever order the keys were written in", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("writes dates as ISO strings and drops undefined keys", () => {
    expect(canonicalJson({ at: new Date("2026-01-01T00:00:00.000Z"), gone: undefined })).toBe(
      '{"at":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it("keeps array order, because order is meaningful in arrays", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it("treats null and undefined values the same way", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("fingerprint", () => {
  it("is a 64 character SHA-256 hex digest that ignores key order", () => {
    const a = fingerprint({ action: "x", actorId: "1" });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint({ actorId: "1", action: "x" })).toBe(a);
  });
});

describe("sealEntry", () => {
  it("is deterministic for the same entry and key", () => {
    expect(sealEntry(entry(), SECRET)).toBe(sealEntry(entry(), SECRET));
    expect(sealEntry(entry(), SECRET)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["action", { action: "elder.updated" }],
    ["actor", { actorId: "user-2" }],
    ["target", { targetId: "elder-2" }],
    ["metadata", { metadata: { path: "/v1/elders/other" } }],
    ["time", { occurredAt: new Date("2026-11-05T08:00:00.001Z") }],
    ["link to previous entry", { previousHash: "f".repeat(64) }],
  ])("changes when the %s changes (tamper evidence)", (_label, change) => {
    expect(sealEntry(entry(change), SECRET)).not.toBe(sealEntry(entry(), SECRET));
  });

  it("cannot be reproduced without the secret key (forgery resistance)", () => {
    expect(sealEntry(entry(), "a-different-secret-of-32-or-more-chars")).not.toBe(
      sealEntry(entry(), SECRET),
    );
  });
});

describe("hashesEqual", () => {
  it("is true only for identical hashes", () => {
    const h = sealEntry(entry(), SECRET);
    expect(hashesEqual(h, h)).toBe(true);
    const lastCharFlipped = h.slice(0, -1) + (h.endsWith("0") ? "1" : "0");
    expect(hashesEqual(h, lastCharFlipped)).toBe(false);
  });

  it("returns false (does not throw) when lengths differ", () => {
    expect(hashesEqual("abc", "abcd")).toBe(false);
  });
});
