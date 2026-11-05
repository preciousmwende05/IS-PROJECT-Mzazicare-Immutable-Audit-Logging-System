/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The three questions this module cannot answer for itself, written down as
 * typed contracts:
 *
 *   "May this user act for this elder, and where does the elder live?"  → U-CS 68
 *   "Is this service bookable, at what price, needing which skills?"    → U-CS 70
 *   "Who is approved, skilled and available to take this job?"          → U-CS 69
 *
 * booking-service must never answer these by reading another module's
 * collection. It asks the owning module's SERVICE — and this file is where
 * "asks" is defined, so the rest of the module depends on a small interface
 * instead of on three other teams' internals.
 *
 * ============================================================================
 * HOW A PORT IS RESOLVED (three steps, first hit wins)
 * ============================================================================
 *  1. An explicit override registered via `registerBookingDependencies()`.
 *     Tests use this, and so can src/server.ts if a team prefers wiring to be
 *     visible at boot.
 *  2. The owning module's exported service object, IF it exposes the method.
 *     The check is a runtime `typeof … === "function"`, so booking-service
 *     compiles and runs today against modules that are still scaffolds, and
 *     starts using the real implementation the moment that team ships the
 *     method — with no change here and no boot wiring.
 *  3. Nothing: a 503. An endpoint that depends on an unbuilt module says so
 *     honestly rather than guessing. In particular, "may this user act for
 *     this elder?" NEVER falls open — an unavailable elder-service means the
 *     request is refused, not permitted.
 *
 * The casts in `sibling()` are deliberate and confined to this file. The
 * sibling service's real signature is that team's business; ours is the
 * contract documented below. If the two ever disagree structurally, the
 * runtime guard here is the seam that contains the damage — which is exactly
 * why every call site goes through a port and not through their service.
 */

import { AppError } from "@/shared/errors";
import type { GeoPoint } from "@/shared/types";
import { elderService } from "@/modules/elder-service/services/elder.service";
import { catalogService } from "@/modules/catalog-service/services/catalog.service";
import { caregiverService } from "@/modules/caregiver-service/services/caregiver.service";

/**
 * 503, not 500. The request was well-formed and the caller did nothing wrong;
 * a collaborating module simply cannot answer yet. That distinction matters to
 * whoever is reading the logs at 2am, and to a client deciding whether to
 * retry.
 */
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

/** The slice of an elder a booking needs. Nothing medical belongs here. */
export type ElderSummary = {
  id: string;
  /** `[lng, lat]`. Copied onto the booking at creation and never re-read. */
  homeLocation: GeoPoint;
  /** County or estate, passed to the matcher as the service area. */
  area?: string | null;
  status?: string | null;
};

export type ElderPort = {
  /** null when the elder does not exist. */
  getById(elderId: string): Promise<ElderSummary | null>;
  /**
   * Is this user in the elder's care circle (any access level)?
   * A false answer becomes a 404, never a 403 — see elder-service's access
   * model: confirming the record exists is itself a leak.
   */
  isInCareCircle(elderId: string, userId: string): Promise<boolean>;
  /** Every elder this user may act for. Used to scope list and calendar. */
  listElderIdsForUser(userId: string): Promise<string[]>;
};

// ---------------------------------------------------------------------------
// catalog-service (U-CS 70)
// ---------------------------------------------------------------------------

export type PricingUnit = "per_hour" | "per_visit" | "per_day";

/** What `catalogService.getBookable` returns — null if not published. */
export type BookableService = {
  id: string;
  basePriceCents: number;
  pricingUnit: PricingUnit;
  minimumDurationMinutes: number;
  requiredSkills: string[];
};

export type CatalogPort = {
  getBookable(serviceId: string): Promise<BookableService | null>;
};

// ---------------------------------------------------------------------------
// caregiver-service (U-CS 69)
// ---------------------------------------------------------------------------

/** What the matcher needs to know about a candidate in order to rank them. */
export type AssignableCaregiver = {
  id: string;
  userId?: string | null;
  baseLocation?: GeoPoint | null;
  ratingAverage?: number | null;
};

export type MatchCriteria = {
  requiredSkills: string[];
  near: GeoPoint;
  area?: string | null;
  scheduledFor: Date;
  durationMinutes: number;
  limit: number;
};

export type CaregiverPort = {
  /**
   * Approved AND available candidates only. booking-service filters further
   * (clashes, ranking) but never re-checks approval — that is U-CS 69's
   * judgement and its collection, not ours.
   */
  findAssignable(criteria: MatchCriteria): Promise<AssignableCaregiver[]>;
  /** The gate for a coordinator's force-assign. */
  isAssignable(caregiverId: string): Promise<boolean>;
  /** Maps the logged-in user to their caregiver profile id, or null. */
  getCaregiverIdForUser(userId: string): Promise<string | null>;
  /**
   * Optional. "Does this caregiver's weekly availability cover this window?"
   * Used when a family reschedules a booking that is already confirmed: the
   * assigned caregiver may simply not work at the new hour. An absent
   * implementation means "unknown", and the reschedule then relies on the
   * clash check alone — see `tryIsAvailableAt`.
   */
  isAvailableAt?(caregiverId: string, at: Date, durationMinutes: number): Promise<boolean>;
  /**
   * Optional. Lets caregiver-service count a late release against a
   * caregiver's reliability. Absent implementations are fine — the booking
   * flow must never fail because a statistic could not be recorded.
   */
  recordReliabilityEvent?(
    caregiverId: string,
    event: "late_release" | "declined_offer" | "no_show",
    context?: Record<string, unknown>,
  ): Promise<void>;
};

export type BookingDependencies = {
  elder: ElderPort;
  catalog: CatalogPort;
  caregiver: CaregiverPort;
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const overrides: Partial<BookingDependencies> = {};

/**
 * registerBookingDependencies — install explicit implementations.
 * Call it from a test, or from src/server.ts if you want the wiring visible.
 * Partial on purpose: overriding elder-service in a test should not force you
 * to hand-roll the other two.
 */
export const registerBookingDependencies = (deps: Partial<BookingDependencies>): void => {
  Object.assign(overrides, deps);
};

/** Undo every override. Test teardown; never call this from product code. */
export const resetBookingDependencies = (): void => {
  for (const key of Object.keys(overrides) as (keyof BookingDependencies)[]) {
    delete overrides[key];
  }
};

/**
 * sibling — view another module's service through OUR contract.
 * HOW IT WORKS: the service object is widened to a partial of the port, so
 * every method is `Function | undefined` at compile time and must be
 * null-checked before use. That is what lets this file compile against a
 * module that has not been written yet, and it is also why the double cast is
 * safe: nothing here assumes the method exists.
 */
const sibling = <T>(service: object): Partial<T> => service as unknown as Partial<T>;

/**
 * capability — fetch one method from a port, or throw 503.
 * Order: override → sibling service → refuse. Returning the method rather
 * than the whole port keeps the failure precise: the error names the exact
 * capability that is missing, which is the first thing you want in the log.
 */
const capability = <P, K extends keyof P>(
  port: keyof BookingDependencies,
  moduleName: string,
  service: object,
  method: K,
): NonNullable<P[K]> => {
  const override = overrides[port] as P | undefined;
  const fromOverride = override?.[method];
  if (typeof fromOverride === "function") return fromOverride as NonNullable<P[K]>;

  const fromSibling = sibling<P>(service)[method];
  if (typeof fromSibling === "function") return fromSibling as NonNullable<P[K]>;

  throw new DependencyUnavailableError(moduleName, String(method));
};

/**
 * The ports the service layer actually calls. Each method resolves lazily, at
 * call time — so a module that ships mid-process is picked up without a
 * restart, and a capability that is never used can never fail at boot.
 */
export const elderPort: ElderPort = {
  getById: (elderId) =>
    capability<ElderPort, "getById">("elder", "elder-service", elderService, "getById")(elderId),

  isInCareCircle: (elderId, userId) =>
    capability<ElderPort, "isInCareCircle">(
      "elder",
      "elder-service",
      elderService,
      "isInCareCircle",
    )(elderId, userId),

  listElderIdsForUser: (userId) =>
    capability<ElderPort, "listElderIdsForUser">(
      "elder",
      "elder-service",
      elderService,
      "listElderIdsForUser",
    )(userId),
};

export const catalogPort: CatalogPort = {
  getBookable: (serviceId) =>
    capability<CatalogPort, "getBookable">(
      "catalog",
      "catalog-service",
      catalogService,
      "getBookable",
    )(serviceId),
};

export const caregiverPort: CaregiverPort = {
  findAssignable: (criteria) =>
    capability<CaregiverPort, "findAssignable">(
      "caregiver",
      "caregiver-service",
      caregiverService,
      "findAssignable",
    )(criteria),

  isAssignable: (caregiverId) =>
    capability<CaregiverPort, "isAssignable">(
      "caregiver",
      "caregiver-service",
      caregiverService,
      "isAssignable",
    )(caregiverId),

  getCaregiverIdForUser: (userId) =>
    capability<CaregiverPort, "getCaregiverIdForUser">(
      "caregiver",
      "caregiver-service",
      caregiverService,
      "getCaregiverIdForUser",
    )(userId),
};

/**
 * tryIsAvailableAt — ask about weekly availability, tolerating "don't know".
 * Returns true / false when caregiver-service can answer, and `null` when it
 * cannot. Three-valued on purpose: the caller must decide what to do with
 * ignorance, and silently coercing `null` to `true` ("assume they are free")
 * would quietly book someone outside their working hours.
 */
export const tryIsAvailableAt = async (
  caregiverId: string,
  at: Date,
  durationMinutes: number,
): Promise<boolean | null> => {
  const check =
    overrides.caregiver?.isAvailableAt ?? sibling<CaregiverPort>(caregiverService).isAvailableAt;
  if (typeof check !== "function") return null;
  return check(caregiverId, at, durationMinutes);
};

/**
 * recordReliabilityEvent — best effort, and deliberately not part of
 * `caregiverPort` above.
 * WHY: it is the one dependency whose absence must not change an outcome. A
 * caregiver releasing a job late is still released; we simply do not get to
 * note it. Resolving it through a try/catch keeps that decision in one place
 * instead of at every call site.
 */
export const tryRecordReliabilityEvent = async (
  caregiverId: string,
  event: "late_release" | "declined_offer" | "no_show",
  context?: Record<string, unknown>,
): Promise<void> => {
  const record =
    overrides.caregiver?.recordReliabilityEvent ??
    sibling<CaregiverPort>(caregiverService).recordReliabilityEvent;
  if (typeof record !== "function") return;
  await record(caregiverId, event, context);
};
