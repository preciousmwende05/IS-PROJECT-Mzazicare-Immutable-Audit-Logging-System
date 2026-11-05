/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import {
  forAmount,
  kesFromCents,
  type Template,
} from "@/modules/notification-service/templates/template";

export const billingTemplates: Record<string, Template> = {
  "invoice.issued": {
    category: "billing",
    priority: "normal",
    channels: ["in_app", "sms"],
    render: (data) => ({
      title: "New invoice",
      body: `An invoice${forAmount(data.amountCents)} is ready.`,
      sms: `MzaziCare: new invoice${forAmount(data.amountCents)}. Pay in the app.`,
    }),
  },

  "payment.succeeded": {
    category: "billing",
    priority: "normal",
    channels: ["in_app", "sms"],
    render: (data) => ({
      title: "Payment received",
      body: `We received your payment${kesFromCents(data.amountCents) ? ` of ${kesFromCents(data.amountCents)}` : ""}. Thank you.`,
      sms: `MzaziCare: payment received${forAmount(data.amountCents).replace(" for", ":")}. Thank you.`,
    }),
  },

  "payment.failed": {
    category: "billing",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: () => ({
      title: "Payment failed",
      body: "Your payment did not go through. Please try again from the app.",
      sms: "MzaziCare: your payment did not go through. Please try again.",
    }),
  },
};
