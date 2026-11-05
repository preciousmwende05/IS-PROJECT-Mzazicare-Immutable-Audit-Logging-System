/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 */

import { Types } from "mongoose";

import {
  VisitReportModel,
  type VisitReport,
  type NewVisitReport,
} from "@/modules/report-service/models/report.model";

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 */
export const reportRepository = {
  findById: async (id: string): Promise<VisitReport | null> =>
    VisitReportModel.findById(id).lean<VisitReport>(),

  findByVisit: async (visitId: string): Promise<VisitReport | null> =>
    VisitReportModel.findOne({ visitId: new Types.ObjectId(visitId) }).lean<VisitReport>(),

  create: async (data: NewVisitReport): Promise<VisitReport> => {
    const doc = await VisitReportModel.create(data);
    return doc.toObject() as VisitReport;
  },

  /** Newest first, one page, for one elder. */
  findPageForElder: async (elderId: string, skip: number, limit: number): Promise<[VisitReport[], number]> => {
    const where = { elderId: new Types.ObjectId(elderId) };
    return Promise.all([
      VisitReportModel.find(where).sort({ submittedAt: -1 }).skip(skip).limit(limit).lean<VisitReport[]>(),
      VisitReportModel.countDocuments(where),
    ]);
  },

  /** Stamp the first family read; later reads leave it unchanged. */
  acknowledge: async (id: Types.ObjectId, userId: string): Promise<VisitReport | null> =>
    VisitReportModel.findOneAndUpdate(
      { _id: id, acknowledgedAt: null },
      { $set: { acknowledgedAt: new Date(), acknowledgedBy: new Types.ObjectId(userId) } },
      { new: true },
    ).lean<VisitReport>(),
};
