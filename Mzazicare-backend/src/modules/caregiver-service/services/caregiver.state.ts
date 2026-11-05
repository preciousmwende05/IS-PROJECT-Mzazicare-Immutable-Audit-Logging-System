import type { CaregiverStatus } from "@/modules/caregiver-service/models/caregiver.model";

/**
 * The approval lifecycle in one place. Every status change in the module goes
 * through canTransition(), so draft -> approved is impossible by any route.
 */
export const ALLOWED_TRANSITIONS: Record<CaregiverStatus, readonly CaregiverStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["approved", "rejected", "more_info"],
  more_info: ["submitted"],
  rejected: ["draft"],
  approved: ["suspended", "expired"],
  suspended: ["approved"],
  expired: ["submitted"],
};

export const canTransition = (from: CaregiverStatus, to: CaregiverStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);