/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import type { Role } from "@/shared/types";
import type {
  LocationPing,
  VerificationFlag,
  Visit,
  VisitStatus,
} from "@/modules/visit-service/models/visit.model";

type Coordinates = { latitude: number; longitude: number };

const coordinatesOf = (point: { coordinates: number[] } | null | undefined): Coordinates => ({
  longitude: point?.coordinates?.[0] ?? 0,
  latitude: point?.coordinates?.[1] ?? 0,
});

// Family view

export type VisitFamilyView = {
  id: string;
  bookingId: string;
  elderId: string;
  caregiverId: string;
  status: VisitStatus;
  scheduledFor: string;
  expectedDurationMinutes: number;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  actualDurationMinutes: number | null;
  disputeReason: string | null;
};

export const serializeFamilyVisit = (visit: Visit): VisitFamilyView => ({
  id: String(visit._id),
  bookingId: String(visit.bookingId),
  elderId: String(visit.elderId),
  caregiverId: String(visit.caregiverId),
  status: visit.status,
  scheduledFor: visit.scheduledFor.toISOString(),
  expectedDurationMinutes: visit.expectedDurationMinutes,
  checkedInAt: visit.checkInAt?.toISOString() ?? null,
  checkedOutAt: visit.checkOutAt?.toISOString() ?? null,
  actualDurationMinutes: visit.actualDurationMinutes ?? null,
  disputeReason: visit.disputeReason ?? null,
});

// Coordinator view

export type VisitCheckView = {
  at: string;
  location: Coordinates | null;
  distanceMeters: number | null;
  verified: boolean;
};

export type VisitCoordinatorView = VisitFamilyView & {
  geofenceRadiusMeters: number;
  expectedLocation: Coordinates;
  checkIn: VisitCheckView | null;
  checkOut: VisitCheckView | null;
  verificationFlags: VerificationFlag[];
  createdAt: string;
  updatedAt: string;
};

export const serializeCoordinatorVisit = (visit: Visit): VisitCoordinatorView => ({
  ...serializeFamilyVisit(visit),
  geofenceRadiusMeters: visit.geofenceRadiusMeters,
  expectedLocation: coordinatesOf(visit.expectedLocation),
  checkIn: visit.checkInAt
    ? {
        at: visit.checkInAt.toISOString(),
        location: visit.checkInLocation ? coordinatesOf(visit.checkInLocation) : null,
        distanceMeters: visit.checkInDistanceMeters ?? null,
        verified: visit.checkInVerified,
      }
    : null,
  checkOut: visit.checkOutAt
    ? {
        at: visit.checkOutAt.toISOString(),
        location: visit.checkOutLocation ? coordinatesOf(visit.checkOutLocation) : null,
        distanceMeters: visit.checkOutDistanceMeters ?? null,
        verified: visit.checkOutVerified,
      }
    : null,
  verificationFlags: [...visit.verificationFlags],
  createdAt: visit.createdAt.toISOString(),
  updatedAt: visit.updatedAt.toISOString(),
});

// Live tracking view

export type VisitTrackView = {
  visitId: string;
  status: VisitStatus;
  position:
    | (Coordinates & { accuracyMeters: number | null; recordedAt: string; receivedAt: string })
    | null;
};

export const serializeVisitTrack = ({
  visit,
  lastPing,
}: {
  visit: Visit;
  lastPing: LocationPing | null;
}): VisitTrackView => ({
  visitId: String(visit._id),
  status: visit.status,
  position: lastPing
    ? {
        ...coordinatesOf(lastPing.location),
        accuracyMeters: lastPing.accuracyMeters ?? null,
        recordedAt: lastPing.recordedAt.toISOString(),
        receivedAt: lastPing.receivedAt.toISOString(),
      }
    : null,
});

export const serializeVisitFor = (
  visit: Visit,
  role: Role,
): VisitFamilyView | VisitCoordinatorView =>
  role === "coordinator" || role === "admin"
    ? serializeCoordinatorVisit(visit)
    : serializeFamilyVisit(visit);
