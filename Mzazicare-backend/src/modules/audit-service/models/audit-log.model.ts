import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const auditLogSchema = new Schema(
  {
    sequence: { type: Number, required: true, min: 1 },
    eventKey: { type: String, required: true },
    action: { type: String, required: true },
    actorId: { type: String, default: null },
    actorRole: { type: String, default: null },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
    sealedAt: { type: Date, required: true },
    previousHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { collection: "auditlogs", versionKey: false, minimize: false },
);

// Integrity indexes: one entry per position, one entry per event.
auditLogSchema.index({ sequence: 1 }, { unique: true });
auditLogSchema.index({ eventKey: 1 }, { unique: true });

// Query indexes: every field we filter or sort by.
auditLogSchema.index({ action: 1, sequence: -1 });
auditLogSchema.index({ actorId: 1, sequence: -1 });
auditLogSchema.index({ occurredAt: -1 });
// "Who accessed my data": every entry about one record (e.g. one elder).
auditLogSchema.index({ targetType: 1, targetId: 1, sequence: -1 });

// Append-only, enforced at application level.
const refuseMutation = (): never => {
  throw new Error("Audit log is append-only: updates and deletes are not allowed");
};

auditLogSchema.pre(
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

auditLogSchema.pre("save", function () {
  if (!this.isNew) refuseMutation();
});

export type NewAuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLog = NewAuditLog & { _id: Types.ObjectId };

export const AuditLogModel = model("AuditLog", auditLogSchema);