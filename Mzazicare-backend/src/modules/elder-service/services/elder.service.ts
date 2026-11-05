/**
 * U-CS 68 — Digital Elder Profile & Care Data System
 * Owner(s): Ian Omwenga, Mepani Bhavin Ramesh
 */



import { publish } from "@/shared/events/bus";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { recordAuditEvent } from "@/shared/middleware/audit.middleware";
import type { AuthUser, Paginated, Role } from "@/shared/types";
import { toGeoPoint } from "@/shared/utils/geo.util";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import type { Elder, NewElder } from "@/modules/elder-service/models/elder.model";
import { elderRepository } from "@/modules/elder-service/repository/elder.repository";
import type {
  CreateElderInput,
  UpdateElderInput,
} from "@/modules/elder-service/validation/elder.validation";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import {
  caregiverPort,
  type ElderSummary,
} from "@/modules/booking-service/services/booking.dependencies";
import { ElderCareDataService } from "@/modules/elder-service/services/elder-care-data.services";
import { isCarePlanSharedWithCaregivers } from "@/modules/elder-service/services/consent.hook";

type GeoPoint = ElderSummary["homeLocation"];

type Actor = AuthUser;

const isStaff = (role: Role) => role === "admin" || role === "coordinator";

/**
 * A hidden refusal: the caller is told "not found" (so the elder's existence
 * is not confirmed), but the audit log records the truth as access.denied.
 * This is the snooping signal for anomaly detection and "who accessed my data".
 */
const recordHiddenDenial = (elderId: string, actor: Actor, reason: string): void =>
  recordAuditEvent({
    action: "access.denied",
    actorId: actor.id,
    actorRole: actor.role,
    outcome: "failure",
    statusCode: 404,
    subject: { elderId, reason },
  });

// 404, never 403, outside the circle: a 403 would confirm the elder exists.
const assertCanRead = async (elderId: string, actor: Actor): Promise<Elder> => {
  const elder = await elderRepository.findById(elderId);
  if (!elder) throw new NotFoundError("Elder");
  if (isStaff(actor.role)) return elder;
  if (!(await elderRepository.findCircleMember(elderId, actor.id))) {
    recordHiddenDenial(elderId, actor, "not in care circle");
    throw new NotFoundError("Elder");
  }
  return elder;
};

// Viewers can already see the elder, so they get the honest 403; outsiders still get 404.
const assertCanWrite = async (elderId: string, actor: Actor): Promise<void> => {
  const member = await elderRepository.findCircleMember(elderId, actor.id);
  if (!member) {
    if (await elderRepository.findById(elderId)) recordHiddenDenial(elderId, actor, "not in care circle (write)");
    throw new NotFoundError("Elder");
  }
  if (member.accessLevel === "viewer") {
    throw new ForbiddenError("Only an editor or owner can change this elder");
  }
};

export const elderService = {
  /** The creator becomes the circle's first owner. */
  create: async (input: CreateElderInput, actor: Actor): Promise<Elder> => {
    const { homeLocation, ...fields } = input;
    const elder = await elderRepository.create({
      ...fields,
      homeLocation: toGeoPoint(homeLocation.latitude, homeLocation.longitude),
      primaryContactUserId: actor.id as unknown as NewElder["primaryContactUserId"],
      status: "active",
    });

    try {
      await elderRepository.addCircleMember({
        elderId: elder._id,
        userId: elder.primaryContactUserId,
        accessLevel: "owner",
        invitedBy: elder.primaryContactUserId,
        acceptedAt: new Date(),
      });
    } catch (err) {
      // ponytail: standalone Mongo has no transactions; use session.withTransaction on a replica set.
      await elderRepository.delete(String(elder._id));
      throw err;
    }

    await publish("elder.created", { elderId: String(elder._id), familyUserId: actor.id });
    return elder;
  },

  /**
   * Families, elders and caregivers see the elders in their accepted care
   * circles. Staff (admin, coordinator) are in no circle but may open any
   * elder (see assertCanRead), so they list every elder. `q` searches name,
   * estate or county.
   */
  list: async (
    query: { page?: unknown; limit?: unknown; q?: string },
    actor: Actor,
  ): Promise<Paginated<Elder>> => {
    const { page, limit, skip } = parsePagination(query);
    const ids = isStaff(actor.role)
      ? null
      : (await elderRepository.findCirclesForUser(actor.id)).map((member) => member.elderId);
    const [items, total] = await elderRepository.findPageByIds(ids, skip, limit, query.q);
    return buildPage(items, total, page, limit);
  },

  getForActor: (elderId: string, actor: Actor): Promise<Elder> => assertCanRead(elderId, actor),

  update: async (elderId: string, input: UpdateElderInput, actor: Actor): Promise<Elder> => {
    await assertCanWrite(elderId, actor);
    const { homeLocation, ...fields } = input;
    const elder = await elderRepository.update(elderId, {
      ...fields,
      ...(homeLocation && {
        homeLocation: toGeoPoint(homeLocation.latitude, homeLocation.longitude),
      }),
    });
    if (!elder) throw new NotFoundError("Elder");
    return elder;
  },

  /** Only while this caregiver is booked with the elder; booking-service owns the window. */
  getCaregiverBrief: async (elderId: string, actor: Actor) => {
    // Throws 503 until caregiver-service (U-CS 69) can map a user to a caregiver profile.
    const caregiverId = await caregiverPort.getCaregiverIdForUser(actor.id);
    if (!caregiverId || !(await bookingService.hasActiveBookingFor(caregiverId, elderId))) {
      if (await elderRepository.findById(elderId)) recordHiddenDenial(elderId, actor, "no active booking with this elder");
      throw new NotFoundError("Elder");
    }
    const elder = await elderRepository.findById(elderId);
    if (!elder) throw new NotFoundError("Elder");
    // Consent: if the family has not agreed to share the care plan with
    // caregivers, the brief carries contacts but no care plan.
    const shared = await isCarePlanSharedWithCaregivers(elderId);
    const [carePlan, contacts] = await Promise.all([
      shared ? elderRepository.findCurrentCarePlan(elderId) : Promise.resolve(null),
      elderRepository.findEmergencyContacts(elderId),
    ]);
    return { elder, carePlan, contacts };
  },

  // -------------------------------------------------------------------------
  // Capabilities other modules call (booking-service ElderPort, visit-service
  // family directory). No access checks here: callers decide what to do with
  // the answer, and none of these return medical data.
  // -------------------------------------------------------------------------

  /** The non-medical slice of an elder a booking needs, or null. */
  getById: async (elderId: string) => {
    const elder = await elderRepository.findById(elderId);
    if (!elder) return null;
    return {
      id: String(elder._id),
      homeLocation: elder.homeLocation as GeoPoint,
      area: elder.address?.estate ?? elder.address?.county ?? null,
      status: elder.status ?? null,
    };
  },

  /** Accepted membership at any access level. Pending invitations do not count. */
  isInCareCircle: async (elderId: string, userId: string): Promise<boolean> =>
    !!(await elderRepository.findCircleMember(elderId, userId)),

  /** Every elder this user is an accepted circle member of. */
  listElderIdsForUser: async (userId: string): Promise<string[]> =>
    (await elderRepository.findCirclesForUser(userId)).map((member) => String(member.elderId)),

  /**
   * Who to tell, and how fragile the elder is. Used by notification-service
   * (care-circle recipients for "caregiver arrived", "visit completed", "care
   * log ready") and emergency-service (alert targets). Only accepted members;
   * high dependency comes from the care plan's mobility, null if unknown.
   */
  getEmergencyBrief: async (elderId: string) => {
    const elder = await elderRepository.findById(elderId);
    if (!elder) return null;
    const [members, contacts, plan] = await Promise.all([
      elderRepository.findCircleMembers(elderId),
      elderRepository.findEmergencyContacts(elderId),
      elderRepository.findCurrentCarePlan(elderId),
    ]);
    return {
      elderId: String(elder._id),
      displayName: `${elder.firstName} ${elder.lastName}`.trim() || null,
      careCircleUserIds: members.filter((m) => m.acceptedAt).map((m) => String(m.userId)),
      emergencyContacts: contacts.map((c) => ({
        id: String(c._id),
        name: c.name,
        phone: c.phone,
        priority: c.priority,
      })),
      isHighDependency: plan?.mobility ? plan.mobility === "wheelchair" || plan.mobility === "bedbound" : null,
    };
  },

  // -------------------------------------------------------------------------
  // Data rights (consent-service). The CALLER decides who may use these.
  // -------------------------------------------------------------------------

  /** The caller's accepted membership of an elder's circle, or null. */
  getMembership: async (elderId: string, userId: string) => {
    const member = await elderRepository.findCircleMember(elderId, userId);
    return member ? { accessLevel: member.accessLevel as "owner" | "editor" | "viewer" } : null;
  },

  /** Everything elder-service holds about an elder, for a data export. Null if unknown. */
  getRecordForExport: async (elderId: string) => {
    const elder = await elderRepository.findById(elderId);
    if (!elder) return null;
    const [carePlans, emergencyContacts, careCircle] = await Promise.all([
      elderRepository.findAllCarePlans(elderId),
      elderRepository.findEmergencyContacts(elderId),
      elderRepository.findCircleMembers(elderId),
    ]);
    return { elder, carePlans, emergencyContacts, careCircle };
  },

  /** Approved deletion request only (consent-service checks that). */
  eraseElderPersonalData: (elderId: string): Promise<void> => elderRepository.eraseElderPersonalData(elderId),
};

/** Care plan, emergency contacts and care circle (see elder-care-data.services.ts). */
export const elderCareDataService = new ElderCareDataService(elderRepository);
