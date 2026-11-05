/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { accountTemplates } from "@/modules/notification-service/templates/account";
import { billingTemplates } from "@/modules/notification-service/templates/billing";
import { bookingTemplates } from "@/modules/notification-service/templates/booking";
import { caregiverTemplates } from "@/modules/notification-service/templates/caregiver";
import { emergencyTemplates } from "@/modules/notification-service/templates/emergency";
import { systemTemplates } from "@/modules/notification-service/templates/system";
import { visitTemplates } from "@/modules/notification-service/templates/visit";
import type { Template } from "@/modules/notification-service/templates/template";

export const templates: Record<string, Template> = {
  ...accountTemplates,
  ...caregiverTemplates,
  ...bookingTemplates,
  ...visitTemplates,
  ...billingTemplates,
  ...emergencyTemplates,
  ...systemTemplates,
};

export const getTemplate = (key: string): Template | undefined => templates[key];

export type {
  Template,
  TemplateData,
  Rendered,
} from "@/modules/notification-service/templates/template";
