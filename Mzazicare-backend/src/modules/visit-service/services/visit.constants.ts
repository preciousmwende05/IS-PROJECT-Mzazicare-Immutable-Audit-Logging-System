/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

export const MAX_PLAUSIBLE_DISTANCE_METERS = 1000;

/** How long after `scheduledFor` a caregiver may still arrive before the visit is missed. */
export const MISSED_GRACE_MINUTES = 30;

/** How often the missed-visit sweep runs. */
export const MISSED_SWEEP_EVERY_MS = 10 * 60_000;

/** One sweep looks at this many visits at a time, for at most this many rounds. */
export const MISSED_SWEEP_BATCH_SIZE = 100;
export const MISSED_SWEEP_MAX_BATCHES = 10;

/** A check-in this long after `scheduledFor` is flagged `late_checkin`. */
export const LATE_CHECKIN_MINUTES = 15;

/** A visit shorter than this share of its expected duration is flagged `short_visit`. */
export const SHORT_VISIT_RATIO = 0.5;

/** This many pings in a row outside the fence count as a breach. */
export const BREACH_CONSECUTIVE_PINGS = 2;

/** How early before `scheduledFor` an offline check-in may be stamped. */
export const OFFLINE_EARLIEST_MINUTES_BEFORE = 60;
