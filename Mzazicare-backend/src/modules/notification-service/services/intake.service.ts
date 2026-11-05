/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type { Job } from "bullmq";

import logger from "@/shared/config/logger";
import type { DomainEvent } from "@/shared/events/types";
import type { NotificationRequest } from "@/shared/notifications";
import type { EmergencyNotification } from "@/modules/emergency-service/services/emergency.dependencies";
import { notificationService } from "@/modules/notification-service/services/notification.service";
import {
  recipientService,
  SUBSCRIBED_EVENTS,
  type SubscribedEvent,
} from "@/modules/notification-service/services/recipient.service";

export type EventIntakeJob = { event: DomainEvent; eventId: string };

const isSubscribed = (event: DomainEvent): event is SubscribedEvent =>
  (SUBSCRIBED_EVENTS as readonly string[]).includes(event.type);

const isEmergency = (data: unknown): data is EmergencyNotification =>
  typeof (data as EmergencyNotification)?.kind === "string" &&
  (data as EmergencyNotification).kind.startsWith("emergency.");

const isRequest = (data: unknown): data is NotificationRequest =>
  typeof (data as NotificationRequest)?.template === "string" &&
  typeof (data as NotificationRequest)?.audience === "object";

export const intakeService = {
  handle: async (job: Job): Promise<void> => {
    const source = `${job.queueName}:${job.id}`;

    if (job.name === "event") {
      const { event, eventId } = job.data as EventIntakeJob;
      if (!isSubscribed(event)) return;
      const route = await recipientService.forEvent(event);
      await notificationService.dispatch({ ...route, source: `event:${event.type}:${eventId}` });
      return;
    }

    if (isEmergency(job.data)) {
      const alert = job.data;
      await notificationService.dispatch({
        templateKey: alert.kind,
        userIds: alert.userIds,
        data: {
          emergencyId: alert.emergencyId,
          elderId: alert.elderId,
          severity: alert.severity,
          level: alert.level,
          title: alert.title,
          body: alert.body,
        },
        source,
      });
      for (const contact of alert.phones) {
        await notificationService.sendDirectSms({
          source,
          phone: contact.phone,
          text: `MzaziCare: ${alert.title}. ${alert.body}`.slice(0, 300),
          priority: "critical",
        });
      }
      return;
    }

    if (isRequest(job.data)) {
      const request = job.data;
      await notificationService.dispatch({
        templateKey: request.template,
        userIds: await recipientService.forAudience(request.audience),
        data: request.data,
        source,
        minPriority: request.urgency === "high" ? "high" : undefined,
      });
      return;
    }

    logger.warn(`[notification] unrecognised job "${job.name}" on ${job.queueName}, skipped`);
  },
};
