/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 */

import type { VisitReport } from "@/modules/report-service/models/report.model";

/**
 * The shape the API returns. Views exist so that a document can never leak a
 * field by accident — add a field here deliberately or the client never sees it.
 */
export type CareLogView = {
  id: string;
  visitId: string;
  bookingId: string;
  elderId: string;
  caregiverId: string;
  notes: string;
  bloodPressure: { systolic: number; diastolic: number } | null;
  mood: string | null;
  meals: string | null;
  submittedAt: string;
  acknowledgedAt: string | null;
};

export const serializeCareLog = (r: VisitReport): CareLogView => ({
  id: String(r._id),
  visitId: String(r.visitId),
  bookingId: String(r.bookingId),
  elderId: String(r.elderId),
  caregiverId: String(r.caregiverId),
  notes: r.notes,
  bloodPressure:
    r.vitals?.bloodPressureSystolic != null && r.vitals?.bloodPressureDiastolic != null
      ? { systolic: r.vitals.bloodPressureSystolic, diastolic: r.vitals.bloodPressureDiastolic }
      : null,
  mood: r.mood ?? null,
  meals: r.meals ?? null,
  submittedAt: new Date(r.submittedAt).toISOString(),
  acknowledgedAt: r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : null,
});
