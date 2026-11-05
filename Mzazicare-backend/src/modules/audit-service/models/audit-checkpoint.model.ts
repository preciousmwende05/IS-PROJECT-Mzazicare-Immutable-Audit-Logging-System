import { Schema, model, type InferSchemaType, type Types } from "mongoose";

// A periodic note: "the chain had reached sequence N with hash X".
// If the newest log entries are deleted, the chain ends before the last checkpoint.
const auditCheckpointSchema = new Schema(
  {
    sequence: { type: Number, required: true },
    hash: { type: String, required: true },
    recordedAt: { type: Date, required: true },
  },
  { collection: "auditcheckpoints", versionKey: false },
);

auditCheckpointSchema.index({ sequence: -1 }, { unique: true });

const refuseMutation = (): never => {
  throw new Error("Audit checkpoints are append-only");
};

auditCheckpointSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  refuseMutation,
);

auditCheckpointSchema.pre("save", function () {
  if (!this.isNew) refuseMutation();
});

export type NewAuditCheckpoint = InferSchemaType<typeof auditCheckpointSchema>;
export type AuditCheckpoint = NewAuditCheckpoint & { _id: Types.ObjectId };

export const AuditCheckpointModel = model("AuditCheckpoint", auditCheckpointSchema);