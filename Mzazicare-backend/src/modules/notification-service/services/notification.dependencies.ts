/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import logger from "@/shared/config/logger";
import { AppError } from "@/shared/errors";
import type { Role } from "@/shared/types";
import { authService } from "@/modules/auth-service/services/auth.service";
import { billingService } from "@/modules/billing-service/services/billing.service";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import { caregiverService } from "@/modules/caregiver-service/services/caregiver.service";
import { elderService } from "@/modules/elder-service/services/elder.service";
import { visitService } from "@/modules/visit-service/services/visit.service";

export type UserContact = { userId: string; name: string; phone: string | null; active: boolean };
export type BookingParties = { elderId: string; requestedBy: string; caregiverId: string | null };

export type NotificationDependencies = {
  getUserContact(userId: string): Promise<UserContact | null>;
  listUserIdsByRole(role: Role): Promise<string[]>;
  getCaregiverUserId(caregiverId: string): Promise<string | null>;
  getBookingParties(bookingId: string): Promise<BookingParties | null>;
  listCareCircleUserIds(elderId: string): Promise<string[]>;
  getElderIdForVisit(visitId: string): Promise<string | null>;
  getInvoicePayerUserId(invoiceId: string): Promise<string | null>;
};

const sibling = <T>(service: object): Partial<T> => service as unknown as Partial<T>;

const isNotFound = (err: unknown) => err instanceof AppError && err.statusCode === 404;

const warned = new Set<string>();
const unavailable = (capability: string) => {
  if (warned.has(capability)) return;
  warned.add(capability);
  logger.warn(
    `[notification] ${capability} is not available yet; those recipients are skipped until it ships`,
  );
};

type AuthApi = {
  getMe(
    userId: string,
  ): Promise<{ _id: unknown; name?: string | null; phone?: string | null; status: string }>;
  listActiveUserIdsByRole(role: Role): Promise<string[]>;
};
type CaregiverApi = { getApplication(id: string): Promise<{ caregiver: { userId: unknown } }> };
type BookingApi = {
  getById(
    id: string,
  ): Promise<{ elderId: unknown; requestedBy: unknown; caregiverId?: unknown } | null>;
};
type ElderApi = {
  getEmergencyBrief(elderId: string): Promise<{ careCircleUserIds: string[] } | null>;
};
type VisitApi = { getElderIdForVisit(visitId: string): Promise<string | null> };
type BillingApi = { getInvoicePayerUserId(invoiceId: string): Promise<string | null> };

const auth = sibling<AuthApi>(authService);
const caregivers = sibling<CaregiverApi>(caregiverService);
const bookings = sibling<BookingApi>(bookingService);
const elders = sibling<ElderApi>(elderService);
const visits = sibling<VisitApi>(visitService);
const billing = sibling<BillingApi>(billingService);

const defaults: NotificationDependencies = {
  getUserContact: async (userId) => {
    if (typeof auth.getMe !== "function") return null;
    try {
      const user = await auth.getMe.call(authService, userId);
      return {
        userId: String(user._id),
        name: user.name ?? "",
        phone: user.phone ?? null,
        active: user.status === "active",
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  listUserIdsByRole: async (role) => {
    if (typeof auth.listActiveUserIdsByRole !== "function") {
      unavailable("authService.listActiveUserIdsByRole");
      return [];
    }
    return auth.listActiveUserIdsByRole.call(authService, role);
  },

  getCaregiverUserId: async (caregiverId) => {
    if (typeof caregivers.getApplication !== "function") return null;
    try {
      const { caregiver } = await caregivers.getApplication.call(caregiverService, caregiverId);
      return caregiver.userId ? String(caregiver.userId) : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  },

  getBookingParties: async (bookingId) => {
    if (typeof bookings.getById !== "function") return null;
    const booking = await bookings.getById.call(bookingService, bookingId);
    if (!booking) return null;
    return {
      elderId: String(booking.elderId),
      requestedBy: String(booking.requestedBy),
      caregiverId: booking.caregiverId ? String(booking.caregiverId) : null,
    };
  },

  listCareCircleUserIds: async (elderId) => {
    if (typeof elders.getEmergencyBrief !== "function") {
      unavailable("elderService.getEmergencyBrief (care circle)");
      return [];
    }
    const brief = await elders.getEmergencyBrief.call(elderService, elderId);
    return brief?.careCircleUserIds ?? [];
  },

  getElderIdForVisit: async (visitId) => {
    if (typeof visits.getElderIdForVisit !== "function") {
      unavailable("visitService.getElderIdForVisit");
      return null;
    }
    return visits.getElderIdForVisit.call(visitService, visitId);
  },

  getInvoicePayerUserId: async (invoiceId) => {
    if (typeof billing.getInvoicePayerUserId !== "function") {
      unavailable("billingService.getInvoicePayerUserId");
      return null;
    }
    return billing.getInvoicePayerUserId.call(billingService, invoiceId);
  },
};

const overrides: Partial<NotificationDependencies> = {};

export const registerNotificationDependencies = (deps: Partial<NotificationDependencies>): void => {
  Object.assign(overrides, deps);
};

export const resetNotificationDependencies = (): void => {
  for (const key of Object.keys(overrides) as (keyof NotificationDependencies)[])
    delete overrides[key];
};

export const deps: NotificationDependencies = new Proxy(defaults, {
  get: (target, key: keyof NotificationDependencies) => overrides[key] ?? target[key],
});
