/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * Mounted at /v1/emergencies.
 *
 * Middleware order is ALWAYS:
 *   authMiddleware -> requireRole -> validate -> audit -> controller
 *
 * Raising routes also carry emergencyRateLimit, never the tight auth limiter:
 * a panic button pressed ten times must get through.
 *
 * Specific paths (/panic, /policies, /elders/...) are declared before "/:id"
 * so they are never mistaken for an id.
 */

import { Router } from "express";

import { audit } from "@/shared/middleware/audit.middleware";
import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { emergencyRateLimit } from "@/shared/middleware/rate-limit.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { emergencyController } from "@/modules/emergency-service/controllers/emergency.controller";
import { emergencyValidation } from "@/modules/emergency-service/validation/emergency.validation";

export const emergencyRoutes = Router();

const byId = (req: { params: Record<string, string | undefined> }) => ({
  emergencyId: req.params.id,
});

emergencyRoutes.post(
  "/panic",
  emergencyRateLimit,
  authMiddleware,
  requireRole("elder"),
  validate(emergencyValidation.panic),
  audit("emergency.panic", (req) => ({ elderId: req.body.elderId })),
  emergencyController.panic,
);

emergencyRoutes.post(
  "/",
  emergencyRateLimit,
  authMiddleware,
  requireRole("elder", "family", "caregiver"),
  validate(emergencyValidation.raise),
  audit("emergency.raised", (req) => ({ elderId: req.body.elderId, type: req.body.type })),
  emergencyController.raise,
);

emergencyRoutes.get(
  "/",
  authMiddleware,
  requireRole("coordinator", "admin"),
  validate(emergencyValidation.list),
  emergencyController.list,
);

emergencyRoutes.get(
  "/policies",
  authMiddleware,
  requireRole("admin"),
  emergencyController.listPolicies,
);

emergencyRoutes.put(
  "/policies",
  authMiddleware,
  requireRole("admin"),
  validate(emergencyValidation.updatePolicy),
  audit("emergency.policy.updated", (req) => ({ severity: req.body.severity })),
  emergencyController.updatePolicy,
);

emergencyRoutes.get(
  "/elders/:elderId/history",
  authMiddleware,
  validate(emergencyValidation.history),
  emergencyController.history,
);

emergencyRoutes.get(
  "/:id",
  authMiddleware,
  validate(emergencyValidation.byId),
  emergencyController.getById,
);

emergencyRoutes.post(
  "/:id/acknowledge",
  authMiddleware,
  requireRole("family", "caregiver", "coordinator", "admin"),
  validate(emergencyValidation.byId),
  audit("emergency.acknowledged", byId),
  emergencyController.acknowledge,
);

emergencyRoutes.post(
  "/:id/respond",
  authMiddleware,
  validate(emergencyValidation.byId),
  audit("emergency.responding", byId),
  emergencyController.respond,
);

emergencyRoutes.post(
  "/:id/resolve",
  authMiddleware,
  validate(emergencyValidation.resolve),
  audit("emergency.resolved", byId),
  emergencyController.resolve,
);

emergencyRoutes.post(
  "/:id/false-alarm",
  authMiddleware,
  validate(emergencyValidation.falseAlarm),
  audit("emergency.false_alarm", byId),
  emergencyController.falseAlarm,
);

emergencyRoutes.post(
  "/:id/escalate",
  authMiddleware,
  requireRole("coordinator", "admin"),
  validate(emergencyValidation.escalate),
  audit("emergency.manually_escalated", byId),
  emergencyController.escalate,
);
