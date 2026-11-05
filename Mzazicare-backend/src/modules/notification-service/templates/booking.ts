/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import {
  kesFromCents,
  onTime,
  text,
  when,
  type Template,
} from "@/modules/notification-service/templates/template";

export const bookingTemplates: Record<string, Template> = {
  "booking.requested": {
    category: "booking",
    priority: "normal",
    channels: ["in_app", "push"],
    render: (data) => ({
      title: "Booking received",
      body: `We received your booking${onTime(data.scheduledFor)} and are finding a caregiver.`,
      sms: `MzaziCare: booking received${onTime(data.scheduledFor)}. Finding a caregiver.`,
    }),
  },

  "booking.offer": {
    category: "booking",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: (data) => ({
      title: "New job offer",
      body: `A visit${onTime(data.scheduledFor)} is available. Accept it before ${when(data.expiresAt) || "the offer expires"}.`,
      sms: `MzaziCare: new job offer${onTime(data.scheduledFor)}. Open the app to accept.`,
    }),
  },

  "booking.confirmed.family": {
    category: "booking",
    priority: "normal",
    channels: ["in_app", "push"],
    render: (data) => ({
      title: "Caregiver confirmed",
      body: `A caregiver has accepted your booking${onTime(data.scheduledFor)}.`,
      sms: `MzaziCare: your booking${onTime(data.scheduledFor)} is confirmed.`,
    }),
  },

  "booking.confirmed.caregiver": {
    category: "booking",
    priority: "normal",
    channels: ["in_app", "push"],
    render: (data) => ({
      title: "Job confirmed",
      body: `You're booked${onTime(data.scheduledFor)}. Check the app for the address and care notes.`,
      sms: `MzaziCare: you're booked${onTime(data.scheduledFor)}.`,
    }),
  },

  "booking.assigned": {
    category: "booking",
    priority: "normal",
    channels: ["in_app", "push"],
    render: () => ({
      title: "Caregiver assigned",
      body: "A coordinator has assigned a caregiver to this booking.",
      sms: "MzaziCare: a caregiver has been assigned to your booking.",
    }),
  },

  "booking.unassigned": {
    category: "booking",
    priority: "high",
    channels: ["in_app", "push"],
    render: (data) => ({
      title: "Booking needs a caregiver",
      body: `No caregiver could be matched for the visit${onTime(data.scheduledFor)}. ${text(data.reason)}`.trim(),
      sms: `MzaziCare: a booking${onTime(data.scheduledFor)} needs manual assignment.`,
    }),
  },

  "booking.reassigning": {
    category: "booking",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: (data) => ({
      title: "Finding a new caregiver",
      body: `The caregiver for your visit${onTime(data.scheduledFor)} is no longer available. We are finding a replacement.`,
      sms: `MzaziCare: your caregiver for the visit${onTime(data.scheduledFor)} changed. Finding a replacement.`,
    }),
  },

  "booking.rescheduled": {
    category: "booking",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: (data) => ({
      title: "Booking rescheduled",
      body: `The visit has been rescheduled${onTime(data.scheduledFor).replace(" on", " to")}.`,
      sms: `MzaziCare: a booking was rescheduled${onTime(data.scheduledFor).replace(" on", " to")}.`,
    }),
  },

  "booking.cancelled": {
    category: "booking",
    priority: "high",
    channels: ["in_app", "push", "sms"],
    render: (data) => {
      const fee =
        Number(data.feeCents) > 0
          ? ` A cancellation fee of ${kesFromCents(data.feeCents)} applies.`
          : "";
      const reason = text(data.reason) ? ` ${text(data.reason)}.` : "";
      return {
        title: "Booking cancelled",
        body: `A booking was cancelled.${reason}${fee}`,
        sms: "MzaziCare: a booking was cancelled. Open the app for details.",
      };
    },
  },
};
