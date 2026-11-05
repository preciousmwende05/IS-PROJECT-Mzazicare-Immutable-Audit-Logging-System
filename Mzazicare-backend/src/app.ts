import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "@/shared/config/env";
import { auditAccessDenied } from "@/shared/middleware/audit.middleware";
import { loggerMiddleware } from "@/shared/middleware/logger.middleware";
import { rateLimitMiddleware } from "@/shared/middleware/rate-limit.middleware";
import { errorMiddleware } from "@/shared/middleware/error.middleware";
import { notFoundMiddleware } from "@/shared/middleware/not-found.middleware";

import { authRoutes } from "@/modules/auth-service/routes/auth.routes";
import { elderRoutes } from "@/modules/elder-service/routes/elder.routes";
import { caregiverRoutes } from "@/modules/caregiver-service/routes/caregiver.routes";
import { catalogRoutes } from "@/modules/catalog-service/routes/catalog.routes";
import { bookingRoutes } from "@/modules/booking-service/routes/booking.routes";
import { emergencyRoutes } from "@/modules/emergency-service/routes/emergency.routes";
import { visitRoutes } from "@/modules/visit-service/routes/visit.routes";
import { reportRoutes } from "@/modules/report-service/routes/report.routes";
import { billingRoutes } from "@/modules/billing-service/routes/billing.routes";
import { notificationRoutes } from "@/modules/notification-service/routes/notification.routes";
import { operationsRoutes } from "@/modules/operations-service/routes/operations.routes";
import { auditRoutes } from "@/modules/audit-service/routes/audit.routes";
import { consentRoutes } from "@/modules/consent-service/routes/consent.routes";

const isAllowedOrigin = (origin: string) =>
  env.allowedOrigins.includes(origin) ||
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-request-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(loggerMiddleware);
// U-CS 78: every 403 is recorded as access.denied (after the logger, so the
// entry carries the request id).
app.use(auditAccessDenied);
app.use(rateLimitMiddleware);

app.get("/", (_req, res) => res.json({ message: "MzaziCare API", status: "ok" }));

const v1 = express.Router();

v1.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// Each module mounts its own router. Routers declare their own auth — nothing
// here is protected by default, so read the route file before you trust it.
v1.use("/auth", authRoutes); // U-CS 67
v1.use("/elders", elderRoutes); // U-CS 68
v1.use("/caregivers", caregiverRoutes); // U-CS 69
v1.use("/services", catalogRoutes); // U-CS 70
v1.use("/bookings", bookingRoutes); // U-CS 71
v1.use("/emergencies", emergencyRoutes); // U-CS 72
v1.use("/visits", visitRoutes); // U-CS 73
v1.use("/reports", reportRoutes); // U-CS 74
v1.use("/billing", billingRoutes); // U-CS 75
v1.use("/notifications", notificationRoutes); // U-CS 76
v1.use("/operations", operationsRoutes); // U-CS 77
v1.use("/audit", auditRoutes); // U-CS 78
v1.use("/privacy", consentRoutes); // Consent & Data Rights (Kenya DPA)

app.use(env.API_PREFIX, v1);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
