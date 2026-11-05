/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type { Template } from "@/modules/notification-service/templates/template";

export const accountTemplates: Record<string, Template> = {
  "user.registered": {
    category: "account",
    priority: "low",
    channels: ["in_app"],
    render: () => ({
      title: "Welcome to MzaziCare",
      body: "Your account is active. Complete your profile to get started.",
      sms: "Welcome to MzaziCare. Your account is active.",
    }),
  },

  "user.password.changed": {
    category: "account",
    priority: "high",
    channels: ["in_app", "sms"],
    render: () => ({
      title: "Your password was changed",
      body: "Your MzaziCare password was just changed. If this was not you, reset it immediately and contact support.",
      sms: "MzaziCare: your password was changed. Not you? Reset it now and contact support.",
    }),
  },
};
