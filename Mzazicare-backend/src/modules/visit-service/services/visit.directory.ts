/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import logger from "@/shared/config/logger";
import { AppError } from "@/shared/errors";

/**
 * A visit stores `caregiverId` (a Caregiver document id) and `elderId`, but the
 * verified token only carries a USER id
 *
 *   caregiver-service:  visitService.registerCaregiverDirectory({ caregiverIdForUser })
 *   elder-service:      visitService.registerFamilyDirectory({ elderIdsForUser })
 */

export type CaregiverDirectory = {
  /** The caregiver profile id of this user, or null when they have none. */
  caregiverIdForUser(userId: string): Promise<string | null>;
};

export type FamilyDirectory = {
  /** The elders this family or elder user may act for (their care circle). */
  elderIdsForUser(userId: string): Promise<string[]>;
};

let caregivers: CaregiverDirectory | null = null;
let families: FamilyDirectory | null = null;

export const registerCaregiverDirectory = (directory: CaregiverDirectory): void => {
  caregivers = directory;
  logger.info("[visit] caregiver directory registered");
};

export const registerFamilyDirectory = (directory: FamilyDirectory): void => {
  families = directory;
  logger.info("[visit] family directory registered");
};

const unavailable = (capability: string) =>
  new AppError(503, "Visit access cannot be checked right now", "DEPENDENCY_UNAVAILABLE", {
    module: "visit-service",
    capability,
  });

export const caregiverIdForUser = async (userId: string): Promise<string | null> => {
  if (!caregivers) throw unavailable("caregiver directory");
  const id = await caregivers.caregiverIdForUser(userId);
  return id ? String(id) : null;
};

export const elderIdsForUser = async (userId: string): Promise<string[]> => {
  if (!families) throw unavailable("family directory");
  return (await families.elderIdsForUser(userId)).map(String);
};
