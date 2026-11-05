/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { text, type Template } from "@/modules/notification-service/templates/template";

export const systemTemplates: Record<string, Template> = {
  // not critical, or a failed alert would trigger another
  "delivery.dead": {
    category: "system",
    priority: "high",
    channels: ["in_app", "push"],
    render: (data) => ({
      title: "Critical alert not delivered",
      body: `A critical ${text(data.channel) ? `${text(data.channel)} ` : ""}notification failed after all retries: ${text(data.error, "unknown error")}. Contact the recipient another way.`,
      sms: "MzaziCare: a critical alert could not be delivered. Check the operations dashboard.",
    }),
  },

  // U-CS 78 → admins and auditors: the anomaly detector (policy rules or the
  // Isolation Forest) flagged a 15-minute window of someone's activity.
  "audit.anomaly.detected": {
    category: "system",
    priority: "high",
    channels: ["in_app"],
    render: (data) => ({
      title: "Unusual activity flagged",
      body: `${text(data.who, "An account")} (${text(data.role, "unknown role")}): ${text(data.summary, "activity outside the normal pattern")}. Review it in the Audit log.`,
      sms: "MzaziCare: unusual account activity was flagged. Review it in the Audit log.",
    }),
  },

  // U-CS 78 → admins and auditors: the scheduled hash-chain check failed.
  "audit.chain.failed": {
    category: "system",
    priority: "critical",
    channels: ["in_app"],
    render: (data) => ({
      title: "Audit chain verification FAILED",
      body: `The audit log failed its integrity check${text(data.brokenAt) ? ` at entry ${text(data.brokenAt)}` : ""}. Entries may have been altered. Investigate immediately and do not rely on the log until it is resolved.`,
      sms: "MzaziCare: the audit log FAILED its integrity check. Investigate now.",
    }),
  },
};
