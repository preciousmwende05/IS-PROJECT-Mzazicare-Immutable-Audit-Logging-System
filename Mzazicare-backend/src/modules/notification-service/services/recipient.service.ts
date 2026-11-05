/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type { DomainEvent } from "@/shared/events/types";
import type { Role } from "@/shared/types";
import type { NotificationAudience } from "@/shared/notifications";
import { deps } from "@/modules/notification-service/services/notification.dependencies";
import type { TemplateData } from "@/modules/notification-service/templates";

const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => !!id)),
];

const caregiverUser = async (caregiverId: string) =>
  unique([await deps.getCaregiverUserId(caregiverId)]);

const usersByRoles = async (roles: Role[]) =>
  unique((await Promise.all(roles.map(deps.listUserIdsByRole))).flat());

const familyOfBooking = async (bookingId: string) => {
  const booking = await deps.getBookingParties(bookingId);
  if (!booking) return [];
  return unique([booking.requestedBy, ...(await deps.listCareCircleUserIds(booking.elderId))]);
};

const careCircleOfVisit = async (visitId: string) => {
  const elderId = await deps.getElderIdForVisit(visitId);
  return elderId ? deps.listCareCircleUserIds(elderId) : [];
};

export type EventRoute = { templateKey: string; userIds: string[]; data: TemplateData };

// booking.* and emergency.* send their own notifications
export const SUBSCRIBED_EVENTS = [
  "user.registered",
  "user.password.changed",
  "caregiver.kyc.submitted",
  "caregiver.approved",
  "caregiver.rejected",
  "caregiver.suspended",
  "visit.checked_in",
  "visit.checked_out",
  "visit.missed",
  "visit_report.submitted",
  "invoice.issued",
  "payment.succeeded",
  "payment.failed",
  "payout.released",
] as const satisfies readonly DomainEvent["type"][];

export type SubscribedEvent = Extract<DomainEvent, { type: (typeof SUBSCRIBED_EVENTS)[number] }>;

export const recipientService = {
  forEvent: async (event: SubscribedEvent): Promise<EventRoute> => {
    const route = (userIds: string[], data: TemplateData = {}): EventRoute => ({
      templateKey: event.type,
      userIds: unique(userIds),
      data,
    });

    switch (event.type) {
      case "user.registered":
      case "user.password.changed":
        return route([event.userId]);

      case "caregiver.kyc.submitted":
        return route(await usersByRoles(["coordinator"]), { caregiverId: event.caregiverId });

      case "caregiver.approved":
        return route(await caregiverUser(event.caregiverId), { caregiverId: event.caregiverId });

      case "caregiver.rejected":
      case "caregiver.suspended":
        return route(await caregiverUser(event.caregiverId), {
          caregiverId: event.caregiverId,
          reason: event.reason,
        });

      case "visit.checked_in":
        return route(await familyOfBooking(event.bookingId), {
          visitId: event.visitId,
          bookingId: event.bookingId,
        });

      case "visit.checked_out":
        return route(await careCircleOfVisit(event.visitId), {
          visitId: event.visitId,
          durationMinutes: event.durationMinutes,
        });

      case "visit.missed":
        return route(await usersByRoles(["coordinator"]), {
          visitId: event.visitId,
          bookingId: event.bookingId,
        });

      case "visit_report.submitted":
        return route(await careCircleOfVisit(event.visitId), {
          reportId: event.reportId,
          visitId: event.visitId,
        });

      case "invoice.issued": {
        const payer = await deps.getInvoicePayerUserId(event.invoiceId);
        const userIds = payer
          ? [payer]
          : [(await deps.getBookingParties(event.bookingId))?.requestedBy];
        return route(unique(userIds), {
          invoiceId: event.invoiceId,
          bookingId: event.bookingId,
          amountCents: event.amountCents,
        });
      }

      case "payment.succeeded":
        return route(unique([await deps.getInvoicePayerUserId(event.invoiceId)]), {
          invoiceId: event.invoiceId,
          paymentId: event.paymentId,
          amountCents: event.amountCents,
        });

      case "payment.failed":
        return route(unique([await deps.getInvoicePayerUserId(event.invoiceId)]), {
          invoiceId: event.invoiceId,
        });

      case "payout.released":
        return route(await caregiverUser(event.caregiverId), { amountCents: event.amountCents });
    }
  },

  forAudience: async (audience: NotificationAudience): Promise<string[]> => {
    const caregiverUsers = await Promise.all(
      (audience.caregiverIds ?? []).map(deps.getCaregiverUserId),
    );
    const roleUsers = audience.roles?.length ? await usersByRoles(audience.roles) : [];
    return unique([...(audience.userIds ?? []), ...caregiverUsers, ...roleUsers]);
  },

  operations: () => usersByRoles(["admin", "coordinator"]),
};
