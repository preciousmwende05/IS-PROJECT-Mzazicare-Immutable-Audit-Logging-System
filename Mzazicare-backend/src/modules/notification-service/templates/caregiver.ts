/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { text, type Template } from "@/modules/notification-service/templates/template";

export const caregiverTemplates: Record<string, Template> = {
  "caregiver.kyc.submitted": {
    category: "kyc",
    priority: "normal",
    channels: ["in_app"],
    render: () => ({
      title: "New caregiver application",
      body: "A caregiver has submitted their documents for review.",
      sms: "MzaziCare: a new caregiver application is waiting for review.",
    }),
  },

  "caregiver.approved": {
    category: "kyc",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: () => ({
      title: "You're approved",
      body: "Your caregiver application has been approved. You can now receive bookings.",
      sms: "MzaziCare: your caregiver application is approved. You can now receive bookings.",
    }),
  },

  // reason stays out of the SMS
  "caregiver.rejected": {
    category: "kyc",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: (data) => ({
      title: "Application not approved",
      body: `Your caregiver application was not approved. Reason: ${text(data.reason, "not given")}`,
      sms: "MzaziCare: your caregiver application was not approved. Open the app for details.",
    }),
  },

  "caregiver.suspended": {
    category: "kyc",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: (data) => ({
      title: "Your account is suspended",
      body: `You can no longer receive bookings. Reason: ${text(data.reason, "not given")}`,
      sms: "MzaziCare: your caregiver account is suspended. Open the app for details.",
    }),
  },

  "payout.released": {
    category: "billing",
    priority: "normal",
    channels: ["in_app", "sms"],
    render: () => ({
      title: "Payout sent",
      body: "Your payout has been released to your account.",
      sms: "MzaziCare: your payout has been released.",
    }),
  },
};
