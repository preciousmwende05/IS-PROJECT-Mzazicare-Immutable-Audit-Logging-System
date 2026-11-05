/**
 * U-CS 78 — Immutable Audit Logging & Compliance System
 * Owner(s): Precious Mwende Waweru, Anthony Atenya
 */

import {
  AuditLogModel,
  type AuditLog,
  type NewAuditLog,
} from "@/modules/audit-service/models/audit-log.model";
import {
  AuditCheckpointModel,
  type AuditCheckpoint,
  type NewAuditCheckpoint,
} from "@/modules/audit-service/models/audit-checkpoint.model";

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 *
 * Append-only by design: there are deliberately NO update or delete methods.
 * The model hooks also refuse updates and deletes if anyone tries.
 */
export const auditRepository = {
  findLast: async (): Promise<AuditLog | null> =>
    AuditLogModel.findOne().sort({ sequence: -1 }).lean<AuditLog>(),

  findByEventKey: async (eventKey: string): Promise<AuditLog | null> =>
    AuditLogModel.findOne({ eventKey }).lean<AuditLog>(),

  findBySequence: async (sequence: number): Promise<AuditLog | null> =>
    AuditLogModel.findOne({ sequence }).lean<AuditLog>(),

  create: async (data: NewAuditLog): Promise<AuditLog> => {
    const doc = await AuditLogModel.create(data);
    return doc.toObject() as AuditLog;
  },

  findPage: async (
    where: Record<string, unknown>,
    skip: number,
    limit: number,
  ): Promise<[AuditLog[], number]> =>
    Promise.all([
      AuditLogModel.find(where).sort({ sequence: -1 }).skip(skip).limit(limit).lean<AuditLog[]>(),
      AuditLogModel.countDocuments(where),
    ]),

  // Streams the whole chain oldest-first without loading it all into memory.
  streamInOrder: () => AuditLogModel.find().sort({ sequence: 1 }).lean<AuditLog>().cursor(),

  latestCheckpoint: async (): Promise<AuditCheckpoint | null> =>
    AuditCheckpointModel.findOne().sort({ sequence: -1 }).lean<AuditCheckpoint>(),

  createCheckpoint: async (data: NewAuditCheckpoint): Promise<AuditCheckpoint> => {
    const doc = await AuditCheckpointModel.create(data);
    return doc.toObject() as AuditCheckpoint;
  },
};