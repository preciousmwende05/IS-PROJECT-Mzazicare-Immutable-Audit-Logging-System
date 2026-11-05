/**
 * U-CS 69 — Caregiver KYC & Approval Workflow System
 * Owner(s): Sharlet Kirui
 */

/**
 * How U-CS 69 reacts to the rest of the system.
 *
 * src/server.ts imports this file for its side effects, so every `on()` here
 * is registered at boot.
 *
 * These handlers do no work themselves. Each one only appends the event to
 * the caregiver module's own queue (caregiver.consumer.ts), where events are
 * processed one at a time in the order they arrived. Two reasons:
 *  - The shared bus runs jobs in parallel, so it cannot keep order. A rating
 *    needs the visit's caregiver, which is only known once the earlier
 *    visit.checked_in has been processed.
 *  - Enqueueing is a single Redis write. A throw here would make the bus
 *    retry every OTHER module's handler for the same event too.
 *
 * Processing must still be IDEMPOTENT: the bus can deliver an event twice.
 * recordRating and recordNoShow record each event key and ignore a repeat;
 * recordVisit is an upsert.
 */

import { on } from "@/shared/events/bus";
import { enqueueCaregiverEvent } from "@/modules/caregiver-service/consumers/caregiver.consumer";

on("visit.checked_in", enqueueCaregiverEvent);
on("visit.missed", enqueueCaregiverEvent);
on("feedback.submitted", enqueueCaregiverEvent);
