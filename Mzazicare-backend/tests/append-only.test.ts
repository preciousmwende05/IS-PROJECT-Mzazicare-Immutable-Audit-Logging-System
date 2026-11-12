/**
 * U-CS 78: the audit log model refuses every update and delete. The hooks run
 * before Mongoose talks to the database, so no database is needed to prove it.
 */
import mongoose from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";

import { AuditLogModel } from "@/modules/audit-service/models/audit-log.model";

const APPEND_ONLY = /append-only/;

beforeAll(() => {
  // If a hook ever stops refusing, fail fast instead of waiting for a database.
  mongoose.set("bufferCommands", false);
});

describe("AuditLogModel is append-only", () => {
  it.each([
    ["updateOne", () => AuditLogModel.updateOne({ sequence: 1 }, { action: "x" }).exec()],
    ["updateMany", () => AuditLogModel.updateMany({}, { action: "x" }).exec()],
    ["findOneAndUpdate", () => AuditLogModel.findOneAndUpdate({ sequence: 1 }, { action: "x" }).exec()],
    ["replaceOne", () => AuditLogModel.replaceOne({ sequence: 1 }, { action: "x" }).exec()],
    ["findOneAndReplace", () => AuditLogModel.findOneAndReplace({ sequence: 1 }, { action: "x" }).exec()],
    ["deleteOne", () => AuditLogModel.deleteOne({ sequence: 1 }).exec()],
    ["deleteMany", () => AuditLogModel.deleteMany({}).exec()],
    ["findOneAndDelete", () => AuditLogModel.findOneAndDelete({ sequence: 1 }).exec()],
  ])("refuses %s", async (_name, run) => {
    await expect(run()).rejects.toThrow(APPEND_ONLY);
  });

  it("refuses re-saving an entry that already exists", async () => {
    const existing = AuditLogModel.hydrate({
      _id: new mongoose.Types.ObjectId(),
      sequence: 1,
      eventKey: "k",
      action: "elder.viewed",
      occurredAt: new Date(),
      sealedAt: new Date(),
      previousHash: "0".repeat(64),
      hash: "1".repeat(64),
    });
    existing.set("action", "elder.deleted");
    await expect(existing.save()).rejects.toThrow(APPEND_ONLY);
  });
});
