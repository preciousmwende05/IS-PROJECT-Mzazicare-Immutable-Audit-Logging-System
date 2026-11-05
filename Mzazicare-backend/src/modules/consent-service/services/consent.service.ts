/**
 * Consent & Data Rights (Kenya Data Protection Act, 2019).
 *
 * Who may do what, per elder:
 *   see consent            any accepted care-circle member, staff
 *   change consent         the elder, or a family owner/editor (guardian)
 *   who accessed my data   family/elder members of the circle, admin
 *   download data          the family owner, or the elder
 *   request deletion       the family owner, or the elder
 *   review / decide        admin only (route guard)
 * Outsiders get 404 (the elder's existence is not confirmed) and the attempt
 * is recorded as access.denied, as everywhere else.
 */

import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";
import { recordAuditEvent } from "@/shared/middleware/audit.middleware";
import type { AuthUser, Paginated } from "@/shared/types";
import { buildPage } from "@/shared/utils/pagination.util";
import { Types } from "mongoose";
import { auditService } from "@/modules/audit-service/services/audit.service";
import { authService } from "@/modules/auth-service/services/auth.service";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import { serializeBooking } from "@/modules/booking-service/views/booking.view";
import { elderService } from "@/modules/elder-service/services/elder.service";
import {
  serializeCareCircleMember,
  serializeCarePlan,
  serializeElder,
  serializeEmergencyContact,
} from "@/modules/elder-service/views/elder.view";
import { reportService } from "@/modules/report-service/services/report.service";
import { serializeCareLog } from "@/modules/report-service/views/report.view";
import type { DataRequest } from "@/modules/consent-service/models/consent.model";
import { consentRepository } from "@/modules/consent-service/repository/consent.repository";
import type { DecideInput, ListRequestsQuery, SetConsentInput } from "@/modules/consent-service/validation/consent.validation";
import {
  requestUserIds,
  serializeAccessEntry,
  serializeConsent,
  serializeDataRequest,
  type AccessLogEntryView,
  type ConsentView,
  type DataRequestView,
} from "@/modules/consent-service/views/consent.view";

type Actor = AuthUser;
type Standing = "staff" | "elder" | "owner" | "editor" | "viewer";

const PURPOSE = "careplan_sharing" as const;
const TERMINAL_BOOKING = new Set(["cancelled", "completed", "no_show"]);
const shortRef = (id: string) => `EL-${id.slice(-5).toUpperCase()}`;

/**
 * The caller's standing for one elder. Outsiders: recorded and 404.
 * Staff = admin/coordinator (they may look, never decide for the family).
 */
const standingFor = async (elderId: string, actor: Actor): Promise<Standing> => {
  const exists = await elderService.getById(elderId);
  if (!exists) throw new NotFoundError("Elder");
  if (actor.role === "admin" || actor.role === "coordinator") return "staff";
  const member = await elderService.getMembership(elderId, actor.id);
  if (!member) {
    recordAuditEvent({
      action: "access.denied",
      actorId: actor.id,
      actorRole: actor.role,
      outcome: "failure",
      statusCode: 404,
      subject: { elderId, reason: "not in care circle (privacy)" },
    });
    throw new NotFoundError("Elder");
  }
  return actor.role === "elder" ? "elder" : member.accessLevel;
};

const requireStanding = (standing: Standing, allowed: Standing[], what: string) => {
  if (!allowed.includes(standing)) throw new ForbiddenError(`Only ${what}`);
};

const elderLabel = async (elderId: string): Promise<string> => {
  const record = await elderService.getRecordForExport(elderId);
  const e = record?.elder;
  return e ? `${e.firstName} ${e.lastName} (${shortRef(elderId)})` : shortRef(elderId);
};

const withNames = async (rows: DataRequest[]): Promise<DataRequestView[]> => {
  const names = await authService.getDisplayNames(requestUserIds(rows));
  return rows.map((r) => serializeDataRequest(r, names));
};

export const consentService = {
  // =========================================================================
  // Consent: "share my care plan with caregivers"
  // =========================================================================

  /** Registered with elder-service at boot: may caregivers see this care plan? */
  isCarePlanShared: async (elderId: string): Promise<boolean> => {
    const latest = await consentRepository.latestConsent(elderId, PURPOSE);
    return latest ? latest.granted : true; // not recorded yet: sharing continues
  },

  getConsent: async (elderId: string, actor: Actor): Promise<ConsentView> => {
    await standingFor(elderId, actor);
    const history = await consentRepository.consentHistory(elderId);
    const names = await authService.getDisplayNames(history.map((h) => String(h.recordedBy)));
    return serializeConsent(history, names);
  },

  setConsent: async (elderId: string, input: SetConsentInput, actor: Actor): Promise<ConsentView> => {
    const standing = await standingFor(elderId, actor);
    requireStanding(standing, ["elder", "owner", "editor"], "the elder or their guardian (a family owner or editor) can change consent");
    await consentRepository.addConsent({
      elderId: new Types.ObjectId(elderId),
      purpose: PURPOSE,
      granted: input.granted,
      recordedBy: new Types.ObjectId(actor.id),
      recordedAs: standing === "elder" ? "elder" : "guardian",
      note: input.note ?? null,
    });
    return consentService.getConsent(elderId, actor);
  },

  // =========================================================================
  // Who accessed my data (from the hash-chained audit log)
  // =========================================================================

  accessLog: async (
    elderId: string,
    query: { page: number; limit: number },
    actor: Actor,
  ): Promise<Paginated<AccessLogEntryView>> => {
    const standing = await standingFor(elderId, actor);
    if (standing === "staff" && actor.role !== "admin") {
      throw new ForbiddenError("Only the family, the elder or an administrator can see the access history");
    }
    if (actor.role === "caregiver") {
      throw new ForbiddenError("Only the family, the elder or an administrator can see the access history");
    }
    const page = await auditService.listForTarget("elder", elderId, query);
    const names = await authService.getDisplayNames(page.items.map((e) => String(e.actorId ?? "")));
    return { ...page, items: page.items.map((e) => serializeAccessEntry(e as never, names)) };
  },

  // =========================================================================
  // Download a copy of the elder's data
  // =========================================================================

  exportData: async (elderId: string, actor: Actor) => {
    const standing = await standingFor(elderId, actor);
    requireStanding(standing, ["elder", "owner"], "the elder or the family owner can download the elder's data");

    const label = await elderLabel(elderId);
    const request = await consentRepository.createRequest({
      elderId: new Types.ObjectId(elderId),
      elderLabel: label,
      type: "export",
      status: "completed",
      reason: null,
      requestedBy: new Types.ObjectId(actor.id),
      reviewedBy: null,
      reviewedAt: null,
      decision: "approved",
      decisionReason: "Data subject access request: copy provided immediately.",
      decidedBy: null,
      decidedAt: new Date(),
      completedAt: new Date(),
    });
    recordAuditEvent({
      action: "datarequest.submitted",
      actorId: actor.id,
      actorRole: actor.role,
      outcome: "success",
      subject: { elderId, type: "export", requestId: String(request._id) },
    });

    const record = await elderService.getRecordForExport(elderId);
    if (!record) throw new NotFoundError("Elder");
    const [bookings, careLogs, consentHistory, access] = await Promise.all([
      bookingService.list({ elderId, page: 1, limit: 100 } as never, actor),
      reportService.listForElder(elderId, { page: 1, limit: 100 }, actor),
      consentRepository.consentHistory(elderId),
      auditService.listForTarget("elder", elderId, { page: 1, limit: 100 }),
    ]);
    const names = await authService.getDisplayNames([
      ...record.careCircle.map((m) => String(m.userId)),
      ...consentHistory.map((c) => String(c.recordedBy)),
      ...access.items.map((e) => String(e.actorId ?? "")),
    ]);

    return {
      requestId: String(request._id),
      exportedAt: new Date().toISOString(),
      notice:
        "Copy of the personal data MzaziCare holds about this person, provided under the Kenya Data Protection Act, 2019 (right of access). Keep it safe.",
      elder: serializeElder(record.elder),
      carePlans: record.carePlans.map(serializeCarePlan),
      emergencyContacts: record.emergencyContacts.map(serializeEmergencyContact),
      careCircle: record.careCircle.map((m) => ({
        ...serializeCareCircleMember(m),
        name: names.get(String(m.userId))?.name ?? null,
      })),
      visits: bookings.items.map(serializeBooking),
      careLogs: careLogs.items.map(serializeCareLog),
      consentHistory: serializeConsent(consentHistory, names).history,
      accessHistory: access.items.map((e) => serializeAccessEntry(e as never, names)),
    };
  },

  // =========================================================================
  // Deletion: requested → reviewed → completed (erased) | refused
  // =========================================================================

  requestDeletion: async (elderId: string, reason: string, actor: Actor): Promise<DataRequestView> => {
    const standing = await standingFor(elderId, actor);
    requireStanding(standing, ["elder", "owner"], "the elder or the family owner can ask for deletion");
    if (await consentRepository.findOpenDeletion(elderId)) {
      throw new ConflictError("A deletion request for this elder is already being reviewed");
    }
    const request = await consentRepository.createRequest({
      elderId: new Types.ObjectId(elderId),
      elderLabel: await elderLabel(elderId),
      type: "deletion",
      status: "requested",
      reason,
      requestedBy: new Types.ObjectId(actor.id),
      reviewedBy: null,
      reviewedAt: null,
      decision: null,
      decisionReason: null,
      decidedBy: null,
      decidedAt: null,
      completedAt: null,
    });
    return (await withNames([request]))[0]!;
  },

  /** The family's own requests for an elder. */
  requestsForElder: async (elderId: string, actor: Actor): Promise<DataRequestView[]> => {
    const standing = await standingFor(elderId, actor);
    if (actor.role === "caregiver" || (standing === "staff" && actor.role !== "admin")) {
      throw new ForbiddenError("Only the family, the elder or an administrator can see data requests");
    }
    return withNames(await consentRepository.requestsForElder(elderId));
  },

  // ---------------- admin ----------------

  listRequests: async (query: ListRequestsQuery): Promise<Paginated<DataRequestView>> => {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await consentRepository.findRequestPage(where, skip, query.limit);
    return buildPage(await withNames(rows), total, query.page, query.limit);
  },

  /** One request plus the checks a reviewer needs before deciding. */
  getRequest: async (id: string, actor: Actor) => {
    const request = await consentRepository.findRequest(id);
    if (!request) throw new NotFoundError("Data request");
    const elderId = String(request.elderId);
    const [view] = await withNames([request]);
    const requester = await authService.getMe(String(request.requestedBy)).catch(() => null);
    const upcoming = await upcomingVisits(elderId, actor);
    const consent = await consentRepository.latestConsent(elderId, PURPOSE);
    return {
      ...view!,
      checks: {
        requesterVerified: !!requester?.phoneVerifiedAt && requester.status === "active",
        requesterStillInCircle: !!(await elderService.getMembership(elderId, String(request.requestedBy))),
        upcomingVisits: upcoming,
        careplanSharing: consent ? (consent.granted ? "granted" : "withdrawn") : "not_recorded",
      },
    };
  },

  review: async (id: string, actor: Actor): Promise<DataRequest> => {
    const updated = await consentRepository.transitionRequest(id, ["requested"], {
      status: "reviewed",
      reviewedBy: new Types.ObjectId(actor.id),
      reviewedAt: new Date(),
    });
    if (!updated) throw new ConflictError("Only a newly requested deletion can be marked as reviewed");
    return updated;
  },

  /**
   * Approve (erase now) or refuse, always with a reason sent to the requester.
   * Approval is refused while visits are still booked: cancel those first.
   */
  decide: async (id: string, input: DecideInput, actor: Actor): Promise<DataRequest> => {
    const request = await consentRepository.findRequest(id);
    if (!request || request.type !== "deletion") throw new NotFoundError("Deletion request");
    if (!["requested", "reviewed"].includes(request.status)) {
      throw new ConflictError(`This request is already ${request.status}`);
    }
    const elderId = String(request.elderId);
    const reviewStamp = request.reviewedAt
      ? {}
      : { reviewedBy: new Types.ObjectId(actor.id), reviewedAt: new Date() };

    if (input.decision === "refuse") {
      const refused = await consentRepository.transitionRequest(id, ["requested", "reviewed"], {
        ...reviewStamp,
        status: "refused",
        decision: "refused",
        decisionReason: input.reason,
        decidedBy: new Types.ObjectId(actor.id),
        decidedAt: new Date(),
      });
      if (!refused) throw new ConflictError("The request changed while deciding; reload and try again");
      return refused;
    }

    const upcoming = await upcomingVisits(elderId, actor);
    if (upcoming > 0) {
      throw new ConflictError(
        `This elder still has ${upcoming} upcoming visit(s). Cancel them before approving deletion.`,
      );
    }
    // Claim the request first so two admins cannot both erase.
    const claimed = await consentRepository.transitionRequest(id, ["requested", "reviewed"], {
      ...reviewStamp,
      status: "completed",
      decision: "approved",
      decisionReason: input.reason,
      decidedBy: new Types.ObjectId(actor.id),
      decidedAt: new Date(),
      completedAt: new Date(),
    });
    if (!claimed) throw new ConflictError("The request changed while deciding; reload and try again");

    await elderService.eraseElderPersonalData(elderId);
    await consentRepository.relabelElderRequests(elderId, `Erased record (${shortRef(elderId)})`);
    return (await consentRepository.findRequest(id)) ?? claimed;
  },
};

/** Visits still to happen for an elder (non-terminal, in the future). */
async function upcomingVisits(elderId: string, actor: Actor): Promise<number> {
  const staffActor: Actor = actor.role === "admin" ? actor : { ...actor, role: "admin" };
  const page = await bookingService.list({ elderId, page: 1, limit: 100 } as never, staffActor);
  const now = Date.now();
  return page.items.filter((b) => !TERMINAL_BOOKING.has(b.status) && new Date(b.endsAt ?? b.scheduledFor).getTime() > now).length;
}
