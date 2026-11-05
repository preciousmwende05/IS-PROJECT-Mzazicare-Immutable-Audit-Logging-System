/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * Which ladder applies to a severity: the one an admin saved, or the default.
 */

import logger from "@/shared/config/logger";
import type {
  EmergencySeverity,
  EscalationTargetType,
} from "@/modules/emergency-service/models/emergency.model";
import {
  DEFAULT_ESCALATION_POLICIES,
  type PolicyLevel,
} from "@/modules/emergency-service/models/escalation-policy.defaults";
import { emergencyRepository } from "@/modules/emergency-service/repository/emergency.repository";

export type ResolvedPolicy = {
  severity: EmergencySeverity;
  levels: PolicyLevel[];
  isDefault: boolean;
  updatedBy: unknown;
  updatedAt: Date | null;
};

const defaultFor = (severity: EmergencySeverity): ResolvedPolicy => ({
  severity,
  levels: DEFAULT_ESCALATION_POLICIES[severity],
  isDefault: true,
  updatedBy: null,
  updatedAt: null,
});

export const escalationPolicy = {
  /**
   * The ladder in force for a severity. If the stored policy cannot be read,
   * the default is used: an emergency must never fail to escalate because of
   * a configuration lookup.
   */
  forSeverity: async (severity: EmergencySeverity): Promise<ResolvedPolicy> => {
    try {
      const stored = await emergencyRepository.findPolicy(severity);
      if (!stored || stored.levels.length === 0) return defaultFor(severity);
      return {
        severity,
        levels: stored.levels.map((l) => ({
          level: l.level,
          targets: [...l.targets] as EscalationTargetType[],
          afterSeconds: l.afterSeconds,
        })),
        isDefault: false,
        updatedBy: stored.updatedBy,
        updatedAt: stored.updatedAt,
      };
    } catch (err) {
      logger.error(
        `[emergency] could not read ${severity} policy, using default: ${(err as Error).message}`,
      );
      return defaultFor(severity);
    }
  },

  levelAt: async (severity: EmergencySeverity, level: number): Promise<PolicyLevel | null> => {
    const { levels } = await escalationPolicy.forSeverity(severity);
    return levels.find((l) => l.level === level) ?? null;
  },
};
