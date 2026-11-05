/**
 * U-CS 77 — Care Operations Monitoring & Control System
 * Owner(s): Samuel Kahiga, Wachira Peter Githinji
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

const operationsSchema = new Schema(
  {
    // TODO(operations): define the persisted fields for U-CS 77.
  },
  { timestamps: true, collection: "operations_snapshots" },
);

// Index what you filter and sort on.
// operationsSchema.index({ createdAt: -1 });

export type OperationsSnapshot = InferSchemaType<typeof operationsSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewOperationsSnapshot = InferSchemaType<typeof operationsSchema>;
export type OperationsSnapshotDocument = HydratedDocument<OperationsSnapshot>;

export const OperationsSnapshotModel = model("OperationsSnapshot", operationsSchema);
