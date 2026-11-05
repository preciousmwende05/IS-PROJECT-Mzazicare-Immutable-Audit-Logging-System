/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The questions this module cannot answer for itself, written down as typed
 * contracts ("ports"), plus the one way it hands work to another module:
 *
 *   "May this user raise or see an alert for this elder?"       → U-CS 68 elder-service
 *   "Who is in this elder's care circle, and who are the
 *    emergency contacts?"                                       → U-CS 68 elder-service
 *   "Which caregiver is on site with this elder right now?"
 *   "Which elder is this booking for?"                          → U-CS 71 booking-service
 *   "Which elder is this visit for?"                            → U-CS 73 visit-service
 *   "Which users are coordinators?"                             → U-CS 67 auth-service
 *   "Deliver this alert."                                       → U-CS 76 notification-service
 *
 * Same pattern as booking-service/services/booking.dependencies.ts: each port
 * calls the owning module's SERVICE (never its repository or models), and
 * checks at runtime that the method exists. Modules that have not shipped a
 * method yet make the port throw DependencyUnavailableError (503), and the
 * callers in this module decide what that means. The moment the other team
 * ships the method, it is used, with no change here.
 *
 * ============================================================================
 * FAILURE POLICY (the important part)
 * ============================================================================
 *  - RAISING an alert fails OPEN. If we cannot check a caregiver's link to
 *    the elder, the alert is still created, flagged `raiserVerified: false`.
 *    A missed emergency costs more than a false alarm.
 *  - SILENCING or READING fails CLOSED. Acknowledging stops the ladder, so an
 *    unverifiable user may not do it; the ladder keeps climbing instead.
 *  - A recipient lookup that fails becomes an empty step with a `note` on the
 *    escalation trail. It never stops the ladder.
 */

import { AppError } from "@/shared/errors";
import { notificationsQueue } from "@/shared/queues";
import type { AuthUser, GeoPoint, Role } from "@/shared/types";
import { authService } from "@/modules/auth-service/services/auth.service";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import { elderService } from "@/modules/elder-service/services/elder.service";
import { visitService } from "@/modules/visit-service/services/visit.service";

/** 503: the request was fine; a collaborating module cannot answer yet. */
export class DependencyUnavailableError extends AppError {
  constructor(module: string, capability: string) {
    super(503, `${module} cannot answer "${capability}" yet`, "DEPENDENCY_UNAVAILABLE", {
      module,
      capability,
    });
  }
}

// ---------------------------------------------------------------------------
// elder-service (U-CS 68)
// ---------------------------------------------------------------------------

export type ElderSummary = {
  id: string;
  /** `[lng, lat]`. Used as the emergency location when the device sent none. */
  homeLocation: GeoPoint | null;
};

export type ElderAccess =
  | { decision: "allowed"; elder: ElderSummary }
  | { decision: "denied" }
  /** A dependency could not answer. Callers choose fail-open or fail-closed. */
  | { decision: "unknown"; reason: string };

/**
 * What the escalation ladder needs to know about an elder, with no user in
 * the loop (the escalation worker has no request and no actor).
 *
 * REQUESTED FROM elder-service: `elderService.getEmergencyBrief(elderId)`.
 * Until it exists, care-circle and emergency-contact targets are recorded as
 * unresolved on the trail, and coordinators remain the safety net.
 */
export type ElderEmergencyBrief = {
  elderId: string;
  /** For the alert text, e.g. "Mary Wanjiru". */
  displayName: string | null;
  /** User ids of ACCEPTED care-circle members. */
  careCircleUserIds: string[];
  /** Ordered by priority, 1 = call first. Phones in E.164. */
  emergencyContacts: { id: string; name: string; phone: string; priority: number }[];
  /**
   * elder-service's judgement (e.g. from care-plan mobility: wheelchair or
   * bedbound). Decides whether a missed visit raises an alert. null = unknown.
   */
  isHighDependency: boolean | null;
};

export type ElderPort = {
  checkAccess(elderId: string, actor: AuthUser): Promise<ElderAccess>;
  /** null when the elder does not exist. Throws DependencyUnavailableError when not built. */
  getEmergencyBrief(elderId: string): Promise<ElderEmergencyBrief | null>;
};

// ---------------------------------------------------------------------------
// auth-service (U-CS 67)
// ---------------------------------------------------------------------------

/** REQUESTED FROM auth-service: `authService.listActiveUserIdsByRole(role)`. */
export type UserDirectoryPort = {
  listActiveUserIdsByRole(role: Role): Promise<string[]>;
};

// ---------------------------------------------------------------------------
// booking-service (U-CS 71)
// ---------------------------------------------------------------------------

/**
 * REQUESTED FROM booking-service: `bookingService.getOnSiteCaregiverUserIds(elderId)`,
 * the USER ids (not caregiver profile ids) of caregivers checked in with the elder now.
 */
export type BookingPort = {
  getOnSiteCaregiverUserIds(elderId: string): Promise<string[]>;
  /** null when the booking does not exist. Uses bookingService.getById, which exists today. */
  getElderIdForBooking(bookingId: string): Promise<string | null>;
};

// ---------------------------------------------------------------------------
// visit-service (U-CS 73)
// ---------------------------------------------------------------------------

/** REQUESTED FROM visit-service: `visitService.getElderIdForVisit(visitId)`. */
export type VisitPort = {
  /** null when the visit does not exist. */
  getElderIdForVisit(visitId: string): Promise<string | null>;
};

// ---------------------------------------------------------------------------
// notification-service (U-CS 76)
// ---------------------------------------------------------------------------

/**
 * The job this module puts on the shared `notifications` queue. This is the
 * contract notification-service drains.
 *
 * `overridesPreferences` is always true: quiet hours and notification
 * preferences do not apply to emergencies.
 */
export type EmergencyNotification = {
  kind: "emergency.alert" | "emergency.update";
  emergencyId: string;
  elderId: string;
  severity: string;
  /** The ladder level for an alert; null for an update. */
  level: number | null;
  userIds: string[];
  phones: { name: string; phone: string }[];
  title: string;
  body: string;
  overridesPreferences: true;
};

export type NotificationPort = {
  send(notification: EmergencyNotification): Promise<void>;
};

export type EmergencyDependencies = {
  elder: ElderPort;
  users: UserDirectoryPort;
  booking: BookingPort;
  visits: VisitPort;
  notifications: NotificationPort;
};

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

/** The casts stay in this file. Every call site goes through a typed port. */
const sibling = <T>(service: object): Partial<T> => service as unknown as Partial<T>;

const statusOf = (err: unknown): number | undefined =>
  err instanceof AppError ? err.statusCode : undefined;

const isGeoPoint = (value: unknown): value is GeoPoint => {
  const coords = (value as { coordinates?: unknown } | null)?.coordinates;
  return Array.isArray(coords) && coords.length === 2 && coords.every((n) => typeof n === "number");
};

const toSummary = (elder: { _id: unknown; homeLocation?: unknown }): ElderSummary => ({
  id: String(elder._id),
  homeLocation: isGeoPoint(elder.homeLocation)
    ? { type: "Point", coordinates: elder.homeLocation.coordinates }
    : null,
});

const defaultElderPort: ElderPort = {
  checkAccess: async (elderId, actor) => {
    try {
      if (actor.role === "caregiver") {
        // Allowed only while booked with this elder. Throws 503 until
        // caregiver-service (U-CS 69) can map a user to a caregiver profile.
        const brief = await elderService.getCaregiverBrief(elderId, actor);
        return { decision: "allowed", elder: toSummary(brief.elder) };
      }
      // Staff, or an accepted member of the elder's care circle.
      const elder = await elderService.getForActor(elderId, actor);
      return { decision: "allowed", elder: toSummary(elder) };
    } catch (err) {
      const status = statusOf(err);
      if (status === 404 || status === 403) return { decision: "denied" };
      if (status === 503) {
        return { decision: "unknown", reason: (err as Error).message };
      }
      throw err;
    }
  },

  getEmergencyBrief: async (elderId) => {
    const api = sibling<{ getEmergencyBrief(id: string): Promise<ElderEmergencyBrief | null> }>(
      elderService,
    );
    if (typeof api.getEmergencyBrief !== "function") {
      throw new DependencyUnavailableError("elder-service", "getEmergencyBrief");
    }
    return api.getEmergencyBrief.call(elderService, elderId);
  },
};

const defaultUserDirectory: UserDirectoryPort = {
  listActiveUserIdsByRole: async (role) => {
    const api = sibling<{ listActiveUserIdsByRole(r: Role): Promise<string[]> }>(authService);
    if (typeof api.listActiveUserIdsByRole !== "function") {
      throw new DependencyUnavailableError("auth-service", "listActiveUserIdsByRole");
    }
    return api.listActiveUserIdsByRole.call(authService, role);
  },
};

const defaultBookingPort: BookingPort = {
  getOnSiteCaregiverUserIds: async (elderId) => {
    const api = sibling<{ getOnSiteCaregiverUserIds(id: string): Promise<string[]> }>(
      bookingService,
    );
    if (typeof api.getOnSiteCaregiverUserIds !== "function") {
      throw new DependencyUnavailableError("booking-service", "getOnSiteCaregiverUserIds");
    }
    return api.getOnSiteCaregiverUserIds.call(bookingService, elderId);
  },

  getElderIdForBooking: async (bookingId) => {
    const booking = await bookingService.getById(bookingId);
    return booking ? String(booking.elderId) : null;
  },
};

const defaultVisitPort: VisitPort = {
  getElderIdForVisit: async (visitId) => {
    const api = sibling<{ getElderIdForVisit(id: string): Promise<string | null> }>(visitService);
    if (typeof api.getElderIdForVisit !== "function") {
      throw new DependencyUnavailableError("visit-service", "getElderIdForVisit");
    }
    return api.getElderIdForVisit.call(visitService, visitId);
  },
};

/**
 * Enqueue and return. Never wait for delivery.
 *
 * NOTE for notification-service: the spec calls for a PRIORITY lane. In
 * BullMQ, jobs without a priority are served before prioritised ones, so a
 * priority number on the shared queue would not help. The right fix is a
 * dedicated queue in shared/queues (needs team agreement); switching to it is
 * a one-line change here.
 */
const defaultNotifications: NotificationPort = {
  send: async (notification) => {
    await notificationsQueue.add(notification.kind, notification);
  },
};

// ---------------------------------------------------------------------------
// Resolution (tests may override any port)
// ---------------------------------------------------------------------------

const overrides: Partial<EmergencyDependencies> = {};

export const registerEmergencyDependencies = (deps: Partial<EmergencyDependencies>): void => {
  Object.assign(overrides, deps);
};

export const resetEmergencyDependencies = (): void => {
  for (const key of Object.keys(overrides) as (keyof EmergencyDependencies)[]) {
    delete overrides[key];
  }
};

export const emergencyDeps = (): EmergencyDependencies => ({
  elder: overrides.elder ?? defaultElderPort,
  users: overrides.users ?? defaultUserDirectory,
  booking: overrides.booking ?? defaultBookingPort,
  visits: overrides.visits ?? defaultVisitPort,
  notifications: overrides.notifications ?? defaultNotifications,
});
