/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { on, type EventMeta } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { notificationsQueue } from "@/shared/queues";
import type { EventIntakeJob } from "@/modules/notification-service/services/intake.service";
import { SUBSCRIBED_EVENTS } from "@/modules/notification-service/services/recipient.service";

const enqueue = async (event: DomainEvent, { eventId }: EventMeta) => {
  const job: EventIntakeJob = { event, eventId };
  await notificationsQueue.add("event", job, { jobId: `event_${eventId}` });
};

for (const type of SUBSCRIBED_EVENTS) on(type, enqueue);
