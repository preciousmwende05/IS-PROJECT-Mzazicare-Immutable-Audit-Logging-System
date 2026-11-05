/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import logger from "@/shared/config/logger";
import { NotFoundError, UnauthorizedError } from "@/shared/errors";
import { pushService } from "@/shared/services/push.service";
import { smsService } from "@/shared/services/sms.service";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import type { Paginated } from "@/shared/types";
import type { Response } from "express";
import type {
  DeliveryAttempt,
  DevicePlatform,
  Notification,
  NotificationPreference,
  Priority,
} from "@/modules/notification-service/models/notification.model";
import {
  deliveryAttemptRepository,
  deviceTokenRepository,
  notificationRepository,
  preferenceRepository,
} from "@/modules/notification-service/repository/notification.repository";
import { deps } from "@/modules/notification-service/services/notification.dependencies";
import {
  DEFAULT_PREFERENCES,
  higherPriority,
  planDelivery,
} from "@/modules/notification-service/services/delivery.policy";
import { enqueueDelivery } from "@/modules/notification-service/services/notification.queues";
import { realtimeService } from "@/modules/notification-service/services/realtime.service";
import { recipientService } from "@/modules/notification-service/services/recipient.service";
import { getTemplate, type TemplateData } from "@/modules/notification-service/templates";
import type { PreferencesInput } from "@/modules/notification-service/validation/notification.validation";

export type DispatchInput = {
  templateKey: string;
  userIds: string[];
  data: TemplateData;
  source: string;
  minPriority?: Priority;
};

const pushData = (notification: Notification): Record<string, string> => {
  const out: Record<string, string> = {
    notificationId: String(notification._id),
    templateKey: notification.templateKey,
  };
  for (const [key, value] of Object.entries(notification.data ?? {})) {
    if (value !== null && value !== undefined && typeof value !== "object")
      out[key] = String(value);
  }
  return out;
};

const preferencesFor = async (userId: string) => {
  const stored = await preferenceRepository.findByUser(userId);
  return stored ? { ...DEFAULT_PREFERENCES, ...stored } : DEFAULT_PREFERENCES;
};

export const notificationService = {
  dispatch: async (input: DispatchInput): Promise<{ notified: number }> => {
    const template = getTemplate(input.templateKey);
    if (!template) {
      logger.error(
        `[notification] no template "${input.templateKey}", nothing sent (source ${input.source})`,
      );
      return { notified: 0 };
    }
    if (!input.userIds.length) {
      logger.info(
        `[notification] ${input.templateKey}: no recipients resolved (source ${input.source})`,
      );
      return { notified: 0 };
    }

    const priority = higherPriority(template.priority, input.minPriority);
    const rendered = template.render(input.data);
    let notified = 0;

    for (const userId of input.userIds) {
      const [preferences, hasPushDevice] = await Promise.all([
        preferencesFor(userId),
        deviceTokenRepository.hasAny(userId),
      ]);
      const plan = planDelivery({
        priority,
        category: template.category,
        templateChannels: template.channels,
        preferences,
        hasPushDevice,
        now: new Date(),
      });

      const { notification, created } = await notificationRepository.createOnce({
        userId,
        templateKey: input.templateKey,
        category: template.category,
        title: rendered.title,
        body: rendered.body,
        smsBody: rendered.sms,
        data: input.data,
        priority,
        channels: plan.channels,
        dedupeKey: `${input.source}:${userId}`,
      });
      if (created) {
        notified++;
        await realtimeService.pushNotification(notification);
        await realtimeService.pushUnreadCount(
          userId,
          await notificationRepository.countUnread(userId),
        );
      }

      for (const delivery of plan.deliveries) {
        const attempt = await deliveryAttemptRepository.createOnce({
          notificationId: String(notification._id),
          userId,
          channel: delivery.channel,
          priority,
          status: delivery.status,
          error: delivery.reason,
          scheduledFor: delivery.delayMs ? new Date(Date.now() + delivery.delayMs) : null,
          dedupeKey: `${String(notification._id)}:${delivery.channel}`,
        });
        if (attempt.status === "queued")
          await enqueueDelivery(String(attempt._id), priority, delivery.delayMs);
      }
    }
    return { notified };
  },

  sendDirectSms: async (input: {
    source: string;
    phone: string;
    text: string;
    priority: Priority;
  }) => {
    const attempt = await deliveryAttemptRepository.createOnce({
      notificationId: null,
      userId: null,
      channel: "sms",
      priority: input.priority,
      status: "queued",
      to: input.phone,
      text: input.text,
      dedupeKey: `${input.source}:phone:${input.phone}`,
    });
    if (attempt.status === "queued") await enqueueDelivery(String(attempt._id), input.priority, 0);
  },

  deliver: async (attemptId: string): Promise<void> => {
    const attempt = await deliveryAttemptRepository.findById(attemptId);
    if (!attempt || !["queued", "failed"].includes(attempt.status)) return;

    const id = String(attempt._id);
    const notification = attempt.notificationId
      ? await notificationRepository.findById(String(attempt.notificationId))
      : null;
    if (attempt.notificationId && !notification) {
      await deliveryAttemptRepository.setStatus(id, "suppressed", "notification no longer exists");
      return;
    }

    const contact = attempt.userId ? await deps.getUserContact(String(attempt.userId)) : null;
    if (attempt.userId && (!contact || !contact.active)) {
      await deliveryAttemptRepository.setStatus(
        id,
        "suppressed",
        "recipient missing or not active",
      );
      return;
    }

    try {
      if (attempt.channel === "sms") {
        const to = attempt.to ?? contact?.phone;
        const body = attempt.text ?? notification?.smsBody;
        if (!to || !body) {
          await deliveryAttemptRepository.setStatus(id, "suppressed", "no phone number");
          return;
        }
        const { id: providerId } = await smsService.send({ to, body });
        await deliveryAttemptRepository.recordSent(id, providerId);
        return;
      }

      const tokens = await deviceTokenRepository.tokensForUser(String(attempt.userId));
      if (!tokens.length || !notification) {
        await deliveryAttemptRepository.setStatus(id, "suppressed", "no registered device");
        return;
      }
      const result = await pushService.send({
        deviceTokens: tokens,
        title: notification.title,
        body: notification.body,
        data: pushData(notification),
      });
      if (result.invalidTokens.length) await deviceTokenRepository.removeMany(result.invalidTokens);
      if (result.delivered === 0) {
        await deliveryAttemptRepository.setStatus(
          id,
          "suppressed",
          "every device token was invalid",
        );
        return;
      }
      await deliveryAttemptRepository.recordSent(id, null);
    } catch (err) {
      await deliveryAttemptRepository.recordFailure(id, (err as Error).message);
      throw err;
    }
  },

  markDead: async (attemptId: string, error: string): Promise<void> => {
    const attempt = await deliveryAttemptRepository.findById(attemptId);
    if (!attempt) return;
    await deliveryAttemptRepository.setStatus(attemptId, "dead", error);
    if (attempt.priority !== "critical") return;

    const operations = await recipientService.operations();
    if (!operations.length) {
      logger.error(
        `[notification] CRITICAL ${attempt.channel} delivery ${attemptId} is dead and no operations user could be resolved: ${error}`,
      );
      return;
    }
    await notificationService.dispatch({
      templateKey: "delivery.dead",
      userIds: operations,
      data: {
        attemptId,
        channel: attempt.channel,
        error,
        notificationId: attempt.notificationId ? String(attempt.notificationId) : null,
      },
      source: `dead:${attemptId}`,
    });
  },

  listMine: async (
    userId: string,
    query: { page?: unknown; limit?: unknown; unread?: boolean },
  ) => {
    const { page, limit, skip } = parsePagination(query);
    const [items, total] = await notificationRepository.findPageForUser(
      userId,
      !!query.unread,
      skip,
      limit,
    );
    return buildPage(items, total, page, limit);
  },

  unreadCount: (userId: string) => notificationRepository.countUnread(userId),

  markRead: async (userId: string, id: string): Promise<Notification> => {
    const updated = await notificationRepository.markRead(id, userId);
    if (!updated) throw new NotFoundError("Notification");
    await realtimeService.pushUnreadCount(userId, await notificationRepository.countUnread(userId));
    return updated;
  },

  markAllRead: async (userId: string) => {
    const updated = await notificationRepository.markAllRead(userId);
    await realtimeService.pushUnreadCount(userId, 0);
    return updated;
  },

  createStreamTicket: (userId: string) => realtimeService.createTicket(userId),

  openStream: async (ticket: string, lastEventId: string | undefined, res: Response) => {
    const userId = await realtimeService.redeemTicket(ticket);
    if (!userId) throw new UnauthorizedError("Invalid or expired stream ticket");
    const [backlog, unread] = await Promise.all([
      lastEventId ? notificationRepository.findForUserAfter(userId, lastEventId, 50) : [],
      notificationRepository.countUnread(userId),
    ]);
    realtimeService.open(userId, res, backlog, unread);
  },

  getPreferences: async (userId: string): Promise<Omit<NotificationPreference, "userId">> =>
    preferencesFor(userId),

  updatePreferences: async (userId: string, input: PreferencesInput) => {
    const patch: Partial<Omit<NotificationPreference, "userId">> = {};
    if (input.push !== undefined) patch.push = input.push;
    if (input.sms !== undefined) patch.sms = input.sms;
    if (input.mutedCategories !== undefined)
      patch.mutedCategories = [...new Set(input.mutedCategories)];
    if (input.quietHours !== undefined) {
      patch.quietHoursStart = input.quietHours?.start ?? null;
      patch.quietHoursEnd = input.quietHours?.end ?? null;
    }
    const saved = await preferenceRepository.upsert(userId, patch);
    return { ...DEFAULT_PREFERENCES, ...saved };
  },

  registerDevice: (userId: string, token: string, platform: DevicePlatform) =>
    deviceTokenRepository.upsert(userId, token, platform),

  unregisterDevice: async (userId: string, token: string) => {
    if (!(await deviceTokenRepository.removeForUser(userId, token)))
      throw new NotFoundError("Device");
  },

  getDelivery: async (
    notificationId: string,
  ): Promise<{ notification: Notification; attempts: DeliveryAttempt[] }> => {
    const notification = await notificationRepository.findById(notificationId);
    if (!notification) throw new NotFoundError("Notification");
    return {
      notification,
      attempts: await deliveryAttemptRepository.findByNotification(notificationId),
    };
  },

  listDead: async (query: {
    page?: unknown;
    limit?: unknown;
  }): Promise<Paginated<DeliveryAttempt>> => {
    const { page, limit, skip } = parsePagination(query);
    const [items, total] = await deliveryAttemptRepository.findPageByStatus("dead", skip, limit);
    return buildPage(items, total, page, limit);
  },
};
