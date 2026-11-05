/**
 * U-CS 77 — Care Operations Monitoring & Control System
 * Owner(s): Samuel Kahiga, Wachira Peter Githinji
 */

import {
  OperationsSnapshotModel,
  type OperationsSnapshot,
  type NewOperationsSnapshot,
} from "@/modules/operations-service/models/operations.model";

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 */
export const operationsRepository = {
  findById: async (id: string): Promise<OperationsSnapshot | null> =>
    OperationsSnapshotModel.findById(id).lean<OperationsSnapshot>(),

  create: async (data: NewOperationsSnapshot): Promise<OperationsSnapshot> => {
    const doc = await OperationsSnapshotModel.create(data);
    return doc.toObject() as OperationsSnapshot;
  },

  update: async (
    id: string,
    patch: Partial<NewOperationsSnapshot>,
  ): Promise<OperationsSnapshot | null> =>
    OperationsSnapshotModel.findByIdAndUpdate(id, patch, { new: true }).lean<OperationsSnapshot>(),

  delete: async (id: string): Promise<void> => {
    await OperationsSnapshotModel.findByIdAndDelete(id);
  },

  // TODO(operations): add the queries U-CS 77 needs. Index every field you filter or sort by.
};
