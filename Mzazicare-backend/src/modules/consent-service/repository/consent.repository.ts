/**
 * Consent & Data Rights — the only layer that touches the database.
 */

import { Types } from "mongoose";

import {
  ConsentRecordModel,
  DataRequestModel,
  type ConsentPurpose,
  type ConsentRecord,
  type DataRequest,
  type DataRequestStatus,
  type NewConsentRecord,
  type NewDataRequest,
} from "@/modules/consent-service/models/consent.model";

const oid = (id: string) => new Types.ObjectId(id);

export const consentRepository = {
  // ---------------- consent ----------------

  latestConsent: async (elderId: string, purpose: ConsentPurpose): Promise<ConsentRecord | null> =>
    ConsentRecordModel.findOne({ elderId: oid(elderId), purpose }).sort({ createdAt: -1, _id: -1 }).lean<ConsentRecord>(),

  consentHistory: async (elderId: string): Promise<ConsentRecord[]> =>
    ConsentRecordModel.find({ elderId: oid(elderId) }).sort({ createdAt: -1, _id: -1 }).limit(100).lean<ConsentRecord[]>(),

  addConsent: async (data: NewConsentRecord): Promise<ConsentRecord> => {
    const doc = await ConsentRecordModel.create(data);
    return doc.toObject() as ConsentRecord;
  },

  // ---------------- data requests ----------------

  createRequest: async (data: NewDataRequest): Promise<DataRequest> => {
    const doc = await DataRequestModel.create(data);
    return doc.toObject() as DataRequest;
  },

  findRequest: async (id: string): Promise<DataRequest | null> => DataRequestModel.findById(id).lean<DataRequest>(),

  findOpenDeletion: async (elderId: string): Promise<DataRequest | null> =>
    DataRequestModel.findOne({ elderId: oid(elderId), type: "deletion", status: { $in: ["requested", "reviewed"] } }).lean<DataRequest>(),

  requestsForElder: async (elderId: string): Promise<DataRequest[]> =>
    DataRequestModel.find({ elderId: oid(elderId) }).sort({ createdAt: -1 }).limit(50).lean<DataRequest[]>(),

  findRequestPage: async (
    where: Record<string, unknown>,
    skip: number,
    limit: number,
  ): Promise<[DataRequest[], number]> =>
    Promise.all([
      DataRequestModel.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<DataRequest[]>(),
      DataRequestModel.countDocuments(where),
    ]),

  /** Compare-and-set on status, so two reviewers cannot both decide. */
  transitionRequest: async (
    id: string,
    from: DataRequestStatus[],
    patch: Partial<NewDataRequest>,
  ): Promise<DataRequest | null> =>
    DataRequestModel.findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: patch }, { new: true }).lean<DataRequest>(),

  /** After erasure the request no longer names the elder. */
  relabelElderRequests: async (elderId: string, label: string): Promise<void> => {
    await DataRequestModel.updateMany({ elderId: oid(elderId) }, { $set: { elderLabel: label } });
  },
};
