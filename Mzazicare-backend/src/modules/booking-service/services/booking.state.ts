/**
 * U-CS 71 — Care Service Booking & Scheduling System
 * Owner(s): Lavin Larry Seme, Arop Mary Abiong
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The booking lifecycle, in one place. Build this first and the rest of the
 * module falls out of it.
 *
 *   [*] --> requested            family submits
 *   requested   --> matching     the matcher runs
 *   matching    --> offered      offers sent to N caregivers
 *   matching    --> unassigned   no eligible caregiver
 *   offered     --> confirmed    the FIRST caregiver to accept wins
 *   offered     --> matching     all declined or expired, retry
 *   unassigned  --> matching     a coordinator retries or widens
 *   confirmed   --> in_progress  visit-service checked them in
 *   in_progress --> completed    visit-service checked them out
 *   confirmed   --> no_show      the caregiver never checked in
 *   any pre-visit state --> cancelled
 *
 * EVERY status change in this module goes through `transition()`. There are no
 * exceptions, and that is the whole point: an illegal move is refused by one
 * function instead of by nine scattered `if (status === …)` checks that each
 * have to be right.
 *
 * ============================================================================
 * WHY THE TRANSITION IS A CONDITIONAL UPDATE, NOT A CHECK-THEN-WRITE
 * ============================================================================
 * `transition()` does not read the booking, decide, and then write. It sends
 * ONE update whose filter contains the statuses it is legal to move from. So:
 *
 *   - two caregivers accepting at the same instant → one update applies, the
 *     other filter no longer matches and returns null;
 *   - an event handler retried after it already succeeded → null, so its
 *     side effects do not run twice;
 *   - a family cancelling while the matcher is mid-flight → whichever lands
 *     first wins, and the loser is told, instead of both "succeeding" and
 *     leaving a cancelled booking with fresh offers against it.
 *
 * A `null` return therefore means "the booking was not in a state this move
 * is legal from". It is normal, expected, and the caller must handle it.
 */

import type { FilterQuery } from "mongoose";

import { ConflictError } from "@/shared/errors";
import {
  BOOKING_STATUSES,
  TERMINAL_STATUSES,
  type Booking,
  type BookingStatus,
  type NewBooking,
} from "@/modules/booking-service/models/booking.model";
import { bookingRepository } from "@/modules/booking-service/repository/booking.repository";

/**
 * The state machine. Read it as "from this status, the only legal next
 * statuses are these".
 *
 * Note what is absent. `completed`, `cancelled` and `no_show` have empty
 * lists: a finished booking is immutable, so there is no path out and no way
 * to "un-cancel" one. `in_progress` may only complete — a visit that has
 * started cannot be cancelled out from under the caregiver standing in
 * someone's living room; that is a visit-service concern (a report of what
 * actually happened), not a scheduling one.
 */
export const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  requested: ["matching", "cancelled"],
  matching: ["offered", "unassigned", "cancelled"],
  offered: ["confirmed", "matching", "cancelled"],
  unassigned: ["matching", "cancelled"],
  // `matching` is here, and it is the one entry the module spec's own ALLOWED
  // snippet leaves out. Two documented flows require it: a caregiver
  // cancelling a confirmed booking re-enters matching rather than cancelling
  // it (§4.3 — the family loses nothing and owes nothing), and
  // `caregiver.suspended` releases their future confirmed bookings back into
  // matching (§4.4). Without this edge both flows would have to bypass
  // `transition()`, and then the state machine would no longer be the one
  // place the lifecycle is written down.
  confirmed: ["in_progress", "cancelled", "no_show", "matching"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/**
 * SOURCES_OF — the inverse of ALLOWED: "which statuses may move INTO this
 * one?".
 * WHY IT EXISTS: a conditional update needs the FROM set in its filter, but
 * the state machine is naturally written the other way round. Deriving the
 * inverse once, here, means the two can never disagree — add a transition to
 * ALLOWED and the guard that enforces it updates itself.
 */
export const SOURCES_OF: Record<BookingStatus, readonly BookingStatus[]> = BOOKING_STATUSES.reduce(
  (acc, target) => {
    acc[target] = BOOKING_STATUSES.filter((from) => ALLOWED[from].includes(target));
    return acc;
  },
  {} as Record<BookingStatus, BookingStatus[]>,
);

export const isTerminal = (status: BookingStatus): boolean =>
  (TERMINAL_STATUSES as readonly BookingStatus[]).includes(status);

/**
 * TIMESTAMP_OF — the field each arrival stamps.
 * Keeping this beside the machine is what stops "confirmed but confirmedAt is
 * null" rows appearing: you cannot reach a status without going through
 * `transition()`, and `transition()` always stamps.
 */
const TIMESTAMP_OF: Partial<Record<BookingStatus, keyof NewBooking>> = {
  confirmed: "confirmedAt",
  in_progress: "startedAt",
  completed: "completedAt",
  cancelled: "cancelledAt",
};

export type TransitionOptions = {
  /**
   * Narrow the legal FROM set further than the state machine does. Used where
   * a move is legal in general but not for this caller — a coordinator's
   * force-assign may confirm from `matching`, but `accept` must only ever
   * confirm from `offered`.
   */
  from?: readonly BookingStatus[];
  /** Fields to write alongside the status. */
  patch?: Partial<NewBooking>;
  /**
   * Extra conditions the booking must still satisfy for the move to apply.
   * Folded into the same filter as the status guard, so the whole check stays
   * one atomic operation. The matcher claims work with `{ matchAttempts: n }`.
   */
  guard?: FilterQuery<Booking>;
};

/**
 * transition — move a booking, atomically, or return null.
 * HOW IT WORKS:
 *   1. Work out the legal FROM set: the caller's narrowing if given,
 *      otherwise every status the machine says may reach `to`.
 *   2. Stamp the arrival time for this status unless the caller already
 *      supplied it.
 *   3. Hand the whole thing to the repository as ONE conditional update.
 * Returns the updated booking, or null if it was not in a legal FROM state.
 */
export const transition = async (
  bookingId: string,
  to: BookingStatus,
  options: TransitionOptions = {},
): Promise<Booking | null> => {
  const from = options.from ?? SOURCES_OF[to];
  if (!from.length) return null;

  const stampField = TIMESTAMP_OF[to];
  const patch: Partial<NewBooking> = { status: to, ...options.patch };
  if (stampField && !(stampField in patch)) {
    Object.assign(patch, { [stampField]: new Date() });
  }

  return bookingRepository.transitionIfStatus(bookingId, from, patch, options.guard);
};

/**
 * transitionOrThrow — the same move, for a request a human is waiting on.
 * HOW IT WORKS: on a null return it re-reads the booking so the error can say
 * something useful — "a completed booking cannot be cancelled" beats "update
 * failed". The re-read costs one query on the FAILURE path only, which is the
 * right place to spend it.
 *
 * The 409 is deliberate: the request was well-formed (so not a 422) and the
 * caller may be allowed to do this at another time (so not a 403). It
 * conflicts with the state the booking is in right now.
 */
export const transitionOrThrow = async (
  bookingId: string,
  to: BookingStatus,
  options: TransitionOptions = {},
): Promise<Booking> => {
  const updated = await transition(bookingId, to, options);
  if (updated) return updated;

  const current = await bookingRepository.findById(bookingId);
  if (!current) throw new ConflictError("Booking no longer exists");

  if (current.status === to) {
    throw new ConflictError(`Booking is already ${to}`);
  }
  if (isTerminal(current.status)) {
    throw new ConflictError(`A ${current.status} booking can no longer be changed`);
  }
  throw new ConflictError(`Cannot move a ${current.status} booking to ${to}`);
};

/**
 * assertMutable — refuse to touch a finished booking.
 * Used by the edit paths (notes, reschedule) which change fields OTHER than
 * status and so would otherwise bypass the state machine entirely. This is
 * the "a completed or cancelled booking is immutable" rule, enforced once.
 */
/**
 * applyIfStatus — an edit that does NOT change the status, but must still
 * only apply while the booking is in one of these states.
 * WHY IT EXISTS: rescheduling and note edits change fields other than
 * `status`, so they would otherwise sidestep the state machine's discipline
 * entirely and become read-then-write races. Routing them through the same
 * conditional update keeps one rule for the whole module: nothing about a
 * booking is written without stating the states in which that write is legal.
 */
export const applyIfStatus = async (
  bookingId: string,
  from: readonly BookingStatus[],
  patch: Partial<NewBooking>,
): Promise<Booking | null> => bookingRepository.transitionIfStatus(bookingId, from, patch);

export const assertMutable = (booking: Booking): void => {
  if (isTerminal(booking.status)) {
    throw new ConflictError(`A ${booking.status} booking can no longer be changed`);
  }
};
