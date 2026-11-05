/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * The default escalation ladder per severity, from docs/README.md section 2.
 *
 * These live in code rather than only in a seed, so the ladder exists on a
 * fresh database with no setup step: the service uses a stored policy when an
 * admin has saved one, and falls back to these otherwise. An emergency must
 * never fail to escalate because nobody ran the seed.
 *
 * `afterSeconds` is measured from when the emergency was RAISED. For
 * `critical`: coordinators at 2 min, contacts at 5 min, external at 10 min.
 */

import type {
  EmergencySeverity,
  EscalationTargetType,
} from "@/modules/emergency-service/models/emergency.model";

export type PolicyLevel = {
  level: number;
  targets: EscalationTargetType[];
  afterSeconds: number;
};

const minutes = (n: number) => n * 60;

export const DEFAULT_ESCALATION_POLICIES: Record<EmergencySeverity, PolicyLevel[]> = {
  critical: [
    { level: 0, targets: ["care_circle", "caregiver"], afterSeconds: 0 },
    { level: 1, targets: ["coordinator"], afterSeconds: minutes(2) },
    { level: 2, targets: ["coordinator", "emergency_contact"], afterSeconds: minutes(5) },
    { level: 3, targets: ["external"], afterSeconds: minutes(10) },
  ],
  high: [
    { level: 0, targets: ["care_circle", "caregiver"], afterSeconds: 0 },
    { level: 1, targets: ["coordinator"], afterSeconds: minutes(5) },
    { level: 2, targets: ["emergency_contact"], afterSeconds: minutes(15) },
  ],
  medium: [
    { level: 0, targets: ["care_circle"], afterSeconds: 0 },
    { level: 1, targets: ["coordinator"], afterSeconds: minutes(15) },
  ],
  low: [{ level: 0, targets: ["care_circle"], afterSeconds: 0 }],
};
