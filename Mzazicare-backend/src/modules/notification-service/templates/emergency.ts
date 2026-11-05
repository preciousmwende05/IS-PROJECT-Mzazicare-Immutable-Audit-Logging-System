/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { text, type Template } from "@/modules/notification-service/templates/template";

const passThrough: Template["render"] = (data) => {
  const title = text(data.title, "Emergency alert");
  const body = text(data.body, "An emergency needs attention. Open MzaziCare now.");
  return { title, body, sms: `MzaziCare: ${title}. ${body}`.slice(0, 300) };
};

export const emergencyTemplates: Record<string, Template> = {
  "emergency.alert": { category: "emergency", priority: "critical", render: passThrough },
  "emergency.update": { category: "emergency", priority: "critical", render: passThrough },
};
