/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, ok, paginated } from "@/shared/utils/response.util";
import { notificationService } from "@/modules/notification-service/services/notification.service";
import {
  serializeDeliveryAttempt,
  serializeNotification,
  serializePreferences,
} from "@/modules/notification-service/views/notification.view";

const userId = (req: Request) => req.user!.id;
const param = (req: Request, name: string) => String(req.params[name]);

export const notificationController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as { page: number; limit: number; unread: boolean };
    const page = await notificationService.listMine(userId(req), query);
    return paginated(res, { ...page, items: page.items.map(serializeNotification) });
  }),

  unreadCount: asyncHandler(async (req: Request, res: Response) => {
    return ok(res, { count: await notificationService.unreadCount(userId(req)) });
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const notification = await notificationService.markRead(userId(req), param(req, "id"));
    return ok(res, serializeNotification(notification));
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    return ok(res, { updated: await notificationService.markAllRead(userId(req)) });
  }),

  streamTicket: asyncHandler(async (req: Request, res: Response) => {
    return created(res, await notificationService.createStreamTicket(userId(req)));
  }),

  stream: asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as { ticket: string; lastEventId?: string };
    const lastEventId = req.get("Last-Event-ID") ?? query.lastEventId;
    await notificationService.openStream(query.ticket, lastEventId, res);
  }),

  getPreferences: asyncHandler(async (req: Request, res: Response) => {
    return ok(res, serializePreferences(await notificationService.getPreferences(userId(req))));
  }),

  updatePreferences: asyncHandler(async (req: Request, res: Response) => {
    return ok(
      res,
      serializePreferences(await notificationService.updatePreferences(userId(req), req.body)),
    );
  }),

  registerDevice: asyncHandler(async (req: Request, res: Response) => {
    await notificationService.registerDevice(userId(req), req.body.token, req.body.platform);
    return created(res, { registered: true });
  }),

  unregisterDevice: asyncHandler(async (req: Request, res: Response) => {
    await notificationService.unregisterDevice(userId(req), param(req, "token"));
    return ok(res, { deleted: true });
  }),

  getDelivery: asyncHandler(async (req: Request, res: Response) => {
    const { notification, attempts } = await notificationService.getDelivery(param(req, "id"));
    return ok(res, {
      notification: serializeNotification(notification),
      attempts: attempts.map(serializeDeliveryAttempt),
    });
  }),

  listDead: asyncHandler(async (req: Request, res: Response) => {
    const page = await notificationService.listDead(req.query);
    return paginated(res, { ...page, items: page.items.map(serializeDeliveryAttempt) });
  }),
};
