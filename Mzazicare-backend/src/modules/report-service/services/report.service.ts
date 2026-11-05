/**
 * U-CS 74 — Care Visit Reporting & Feedback System
 * Owner(s): Marsa Fatuma Omar
 *
 * Every business rule for the care log lives here. No express types in this
 * file: it must be callable from a worker or a seed script.
 *
 * Who may do what (the visit's own access rules are reused, not copied):
 *   write  — the visit's assigned caregiver, once they have checked in, once.
 *   read   — anyone visitService lets see the visit: the assigned caregiver,
 *            the elder's care circle, staff.
 *   list   — an elder's logs: staff, or a member of that elder's care circle.
 */

import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";
import { publish } from "@/shared/events/bus";
import logger from "@/shared/config/logger";
import { recordAuditEvent } from "@/shared/middleware/audit.middleware";
import type { AuthUser, Paginated } from "@/shared/types";
import { buildPage } from "@/shared/utils/pagination.util";
import { Types } from "mongoose";
import { elderService } from "@/modules/elder-service/services/elder.service";
import { visitService } from "@/modules/visit-service/services/visit.service";
import type { VisitReport } from "@/modules/report-service/models/report.model";
import { reportRepository } from "@/modules/report-service/repository/report.repository";
import type { CreateCareLogInput } from "@/modules/report-service/validation/report.validation";

type Actor = AuthUser;

/** A care log can be written from check-in onwards (during or after the visit). */
const WRITABLE_VISIT_STATUSES = ["checked_in", "in_progress", "checked_out", "completed"];

const isStaff = (actor: Actor) => actor.role === "admin" || actor.role === "coordinator";
const isFamily = (actor: Actor) => actor.role === "family" || actor.role === "elder";

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

export const reportService = {
  /** The caregiver records what happened: notes, and blood pressure / mood / meals if measured. */
  createCareLog: async (visitId: string, input: CreateCareLogInput, actor: Actor): Promise<VisitReport> => {
    if (actor.role !== "caregiver") {
      throw new ForbiddenError("Only the visit's assigned caregiver can write the care log");
    }
    // 404 unless this caregiver is assigned to the visit (visit-service's rule).
    const visit = await visitService.getById(visitId, actor);
    if (!WRITABLE_VISIT_STATUSES.includes(visit.status)) {
      throw new ConflictError("Check in to the visit before writing the care log");
    }
    if (await reportRepository.findByVisit(visitId)) {
      throw new ConflictError("A care log was already submitted for this visit. Care logs cannot be changed.");
    }

    const hasBp = input.bloodPressureSystolic !== undefined && input.bloodPressureDiastolic !== undefined;
    let report: VisitReport;
    try {
      report = await reportRepository.create({
        visitId: visit._id,
        bookingId: visit.bookingId,
        elderId: visit.elderId,
        caregiverId: visit.caregiverId,
        authorUserId: new Types.ObjectId(actor.id),
        notes: input.notes,
        vitals: hasBp
          ? { bloodPressureSystolic: input.bloodPressureSystolic, bloodPressureDiastolic: input.bloodPressureDiastolic }
          : null,
        mood: input.mood ?? null,
        meals: input.meals ?? null,
        submittedAt: new Date(),
        acknowledgedAt: null,
        acknowledgedBy: null,
      } as never);
    } catch (err) {
      // Two submits racing: the unique index on visitId decides.
      if (isDuplicateKey(err)) throw new ConflictError("A care log was already submitted for this visit.");
      throw err;
    }

    // Tells the family a log is ready (notification-service listens). The log is
    // saved either way; a missed notification must not lose a care record.
    try {
      await publish("visit_report.submitted", { reportId: String(report._id), visitId });
    } catch (err) {
      logger.error(`[report] visit_report.submitted not published for ${visitId}: ${(err as Error).message}`);
    }
    return report;
  },

  /** The care log for one visit, or null if none yet. A family read is stamped as acknowledged. */
  getCareLog: async (visitId: string, actor: Actor): Promise<VisitReport | null> => {
    await visitService.getById(visitId, actor); // same visibility as the visit itself
    const report = await reportRepository.findByVisit(visitId);
    if (report && isFamily(actor) && !report.acknowledgedAt) {
      return (await reportRepository.acknowledge(report._id, actor.id)) ?? report;
    }
    return report;
  },

  /** An elder's care logs, newest first. */
  listForElder: async (
    elderId: string,
    query: { page: number; limit: number },
    actor: Actor,
  ): Promise<Paginated<VisitReport>> => {
    if (!isStaff(actor) && !(await elderService.isInCareCircle(elderId, actor.id))) {
      // Same as elder-service: 404 so the elder's existence is not confirmed,
      // but the refusal is recorded.
      recordAuditEvent({
        action: "access.denied",
        actorId: actor.id,
        actorRole: actor.role,
        outcome: "failure",
        statusCode: 404,
        subject: { elderId, reason: "not in care circle (care logs)" },
      });
      throw new NotFoundError("Elder");
    }
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await reportRepository.findPageForElder(elderId, skip, query.limit);
    return buildPage(items, total, query.page, query.limit);
  },
};
