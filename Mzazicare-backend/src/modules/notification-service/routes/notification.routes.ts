/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";
import { notificationController } from "@/modules/notification-service/controllers/notification.controller";
import { notificationValidation } from "@/modules/notification-service/validation/notification.validation";

export const notificationRoutes = Router();

notificationRoutes.get(
  "/",
  authMiddleware,
  validate(notificationValidation.list),
  notificationController.list,
);

notificationRoutes.get("/unread-count", authMiddleware, notificationController.unreadCount);

notificationRoutes.post("/stream-ticket", authMiddleware, notificationController.streamTicket);

notificationRoutes.get(
  "/stream",
  validate(notificationValidation.stream),
  notificationController.stream,
);

notificationRoutes.post("/read-all", authMiddleware, notificationController.markAllRead);

notificationRoutes.get("/preferences", authMiddleware, notificationController.getPreferences);

notificationRoutes.put(
  "/preferences",
  authMiddleware,
  validate(notificationValidation.updatePreferences),
  audit("notification.preferences.updated", (req) => ({ userId: req.user!.id })),
  notificationController.updatePreferences,
);

notificationRoutes.post(
  "/devices",
  authMiddleware,
  validate(notificationValidation.registerDevice),
  notificationController.registerDevice,
);

notificationRoutes.delete(
  "/devices/:token",
  authMiddleware,
  validate(notificationValidation.unregisterDevice),
  notificationController.unregisterDevice,
);

notificationRoutes.get(
  "/failed",
  authMiddleware,
  requireRole("admin"),
  validate(notificationValidation.page),
  notificationController.listDead,
);

notificationRoutes.get(
  "/delivery/:id",
  authMiddleware,
  requireRole("admin"),
  validate(notificationValidation.byId),
  notificationController.getDelivery,
);

notificationRoutes.post(
  "/:id/read",
  authMiddleware,
  validate(notificationValidation.byId),
  notificationController.markRead,
);
