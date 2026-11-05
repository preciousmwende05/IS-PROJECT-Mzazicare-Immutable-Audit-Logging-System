/**
 * U-CS 68 — "may caregivers see this elder's care plan?"
 *
 * The answer belongs to consent-service (the elder's or guardian's consent),
 * but the check runs here, where care plans are read. consent-service registers
 * its answer at boot (src/server.ts); until it does, sharing is allowed, which
 * is how the platform behaved before consent existed.
 *
 * A separate file so elder.service.ts and elder-care-data.services.ts can both
 * import it without importing each other.
 */

type SharingCheck = (elderId: string) => Promise<boolean>;

let check: SharingCheck = async () => true;

export const registerCarePlanSharingCheck = (fn: SharingCheck): void => {
  check = fn;
};

export const isCarePlanSharedWithCaregivers = (elderId: string): Promise<boolean> => check(elderId);
