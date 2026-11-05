/**
 * The cross-module contract.
 *
 * A module publishes a fact about its own domain; other modules react. This
 * is how twelve teams integrate without importing each other's services.
 *
 * Rules
 *  1. Only the owning module (in brackets) publishes that event.
 *  2. Names are past tense — they state what happened, not what to do.
 *  3. Payloads carry ids and primitives, never Mongoose documents.
 *  4. Changing a payload shape is a breaking change: tell the other teams.
 */
export type DomainEvent =
  // auth-service (U-CS 67)
  | { type: "user.registered"; userId: string; role: string; phone: string }
  | { type: "user.logged_in"; userId: string; at: string }
  | { type: "user.password.changed"; userId: string }

  // elder-service (U-CS 68)
  | { type: "elder.created"; elderId: string; familyUserId: string }
  | { type: "elder.care_plan.updated"; elderId: string; updatedBy: string }

  // caregiver-service (U-CS 69)
  | { type: "caregiver.kyc.submitted"; caregiverId: string }
  | { type: "caregiver.approved"; caregiverId: string; approvedBy: string }
  | { type: "caregiver.rejected"; caregiverId: string; reason: string }
  | { type: "caregiver.suspended"; caregiverId: string; reason: string }

  // catalog-service (U-CS 70)
  | { type: "service.published"; serviceId: string }
  | { type: "service.price.changed"; serviceId: string; priceCents: number }

  // booking-service (U-CS 71)
  | {
      type: "booking.requested";
      bookingId: string;
      elderId: string;
      serviceId: string;
      scheduledFor: string;
    }
  // visit-service creates the visit from this event alone, so it carries
  // everything a visit needs (see visit-service validation/visit.events.ts).
  | {
      type: "booking.confirmed";
      bookingId: string;
      caregiverId: string;
      elderId: string;
      scheduledFor: string;
      durationMinutes: number;
      location: { type: "Point"; coordinates: [number, number] };
    }
  | { type: "booking.rescheduled"; bookingId: string; scheduledFor: string }
  // `cancellationFeeCents` is the fee the POLICY produced (0 is a real value:
  // "cancelled in good time, nothing owed"). billing-service invoices or
  // voids on it, so it travels with the event rather than being re-derived.
  | {
      type: "booking.cancelled";
      bookingId: string;
      cancelledBy: string;
      cancellationFeeCents: number;
      reason?: string;
    }

  // emergency-service (U-CS 72)
  | { type: "emergency.raised"; emergencyId: string; elderId: string; severity: string }
  | { type: "emergency.escalated"; emergencyId: string; level: number }
  | { type: "emergency.resolved"; emergencyId: string; resolvedBy: string }

  // visit-service (U-CS 73)
  | {
      type: "visit.checked_in";
      visitId: string;
      bookingId: string;
      caregiverId: string;
      verified: boolean;
    }
  | { type: "visit.checked_out"; visitId: string; durationMinutes: number }
  // The visit exists. booking-service stamps the visitId so the caregiver's app
  // can find the visit to check in to (before this, it learnt it only AT check-in).
  | { type: "visit.scheduled"; visitId: string; bookingId: string }
  | { type: "visit.geofence.breached"; visitId: string; distanceMeters: number }
  | { type: "visit.missed"; visitId: string; bookingId: string }

  // report-service (U-CS 74)
  | { type: "visit_report.submitted"; reportId: string; visitId: string }
  | { type: "feedback.submitted"; visitId: string; rating: number }

  // billing-service (U-CS 75)
  | { type: "invoice.issued"; invoiceId: string; bookingId: string; amountCents: number }
  | { type: "payment.succeeded"; paymentId: string; invoiceId: string; amountCents: number }
  | { type: "payment.failed"; invoiceId: string; reason: string }
  | { type: "payout.released"; caregiverId: string; amountCents: number }

  // audit-service (U-CS 78)
  | {
      type: "audit.recorded";
      action: string;
      actorId: string | null;
      actorRole: string;
      requestId?: string;
      ip?: string;
      userAgent?: string;
      subject: Record<string, unknown>;
      occurredAt: string;
      outcome?: "success" | "failure";
      statusCode?: number;
      /** The record the action is about (e.g. "elder" + its id). */
      targetType?: string;
      targetId?: string;
    }

  // shared
  | { type: "cache.invalidate"; resource: string };

export type EventType = DomainEvent["type"];
export type EventPayload<T extends EventType> = Extract<DomainEvent, { type: T }>;
