/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type { Template } from "@/modules/notification-service/templates/template";

export const visitTemplates: Record<string, Template> = {
  "visit.checked_in": {
    category: "visit",
    priority: "low",
    channels: ["in_app"],
    render: () => ({
      title: "Caregiver arrived",
      body: "Your caregiver has checked in for today's visit.",
      sms: "MzaziCare: your caregiver has checked in.",
    }),
  },

  "visit.checked_out": {
    category: "visit",
    priority: "normal",
    channels: ["in_app", "push"],
    render: (data) => ({
      title: "Visit finished",
      body: `The caregiver checked out${Number(data.durationMinutes) > 0 ? ` after ${data.durationMinutes} minutes` : ""}.`,
      sms: "MzaziCare: today's visit has finished.",
    }),
  },

  "visit.missed": {
    category: "visit",
    priority: "critical",
    render: () => ({
      title: "Visit missed",
      body: "A caregiver did not check in for a scheduled visit. The elder may be without care.",
      sms: "MzaziCare: a scheduled visit was missed. Check the operations dashboard now.",
    }),
  },

  "visit_report.submitted": {
    category: "visit",
    priority: "normal",
    channels: ["in_app", "push"],
    render: () => ({
      title: "Visit report ready",
      body: "The caregiver has submitted a report for today's visit.",
      sms: "MzaziCare: a new visit report is ready in the app.",
    }),
  },
};
