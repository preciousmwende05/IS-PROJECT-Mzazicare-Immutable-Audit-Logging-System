import type { Role } from "@/shared/types";

/** Permission strings are `<module>:<action>`. Add yours as your module grows. */
export const PERMISSIONS = [
  "elders:read",
  "elders:write",
  "caregivers:approve",
  "bookings:create",
  "bookings:cancel",
  "bookings:assign",
  "emergency:escalate",
  "visits:checkin",
  "reports:submit",
  "billing:refund",
  "operations:view",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSIONS_BY_ROLE: Record<Role, Permission[]> = {
  family: ["elders:read", "elders:write", "bookings:create", "bookings:cancel"],
  elder: ["elders:read", "emergency:escalate"],
  caregiver: ["elders:read", "visits:checkin", "reports:submit"],
  coordinator: [
    "elders:read",
    "caregivers:approve",
    "bookings:assign",
    "emergency:escalate",
    "operations:view",
  ],
  admin: [...PERMISSIONS],
  auditor: ["audit:read"],
};
