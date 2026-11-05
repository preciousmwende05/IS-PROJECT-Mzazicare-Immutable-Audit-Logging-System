import app from "@/app";
import { env } from "@/shared/config/env";
import logger from "@/shared/config/logger";
import { connectDatabase, disconnectDatabase } from "@/db/index";
import { startEventWorker } from "@/shared/events/bus";
import { storageService } from "@/shared/services/storage.service";

// Queue workers — each module's own background drain.

import { startCaregiverWorker } from "@/modules/caregiver-service/workers/caregiver.worker";
import { startBookingWorker } from "@/modules/booking-service/workers/booking.worker";
import { startEmergencyWorker } from "@/modules/emergency-service/workers/emergency.worker";
import { startVisitWorker } from "@/modules/visit-service/workers/visit.worker";
import { startBillingWorker } from "@/modules/billing-service/workers/billing.worker";
import { startNotificationWorker } from "@/modules/notification-service/workers/notification.worker";
import { startAuditWorker } from "@/modules/audit-service/workers/audit.worker";

// Event subscribers — imported for their side effects, so every on() in these
// files is registered before the event worker starts draining.
import "@/shared/events/handlers/cache.handlers";
import "@/modules/auth-service/consumers/auth.handlers";
import "@/modules/caregiver-service/consumers/caregiver.handlers";
import "@/modules/booking-service/consumers/booking.handlers";
import "@/modules/emergency-service/consumers/emergency.handlers";
import "@/modules/visit-service/consumers/visit.handlers";
import "@/modules/report-service/consumers/report.handlers";
import "@/modules/billing-service/consumers/billing.handlers";
import "@/modules/notification-service/consumers/notification.handlers";
import "@/modules/operations-service/consumers/operations.handlers";
import "@/modules/audit-service/consumers/audit.handlers";

// Cross-module wiring — visit-service stores caregiver and elder ids, but a
// token only carries a user id. These directories translate between them.
import { visitService } from "@/modules/visit-service/services/visit.service";
import { caregiverService } from "@/modules/caregiver-service/services/caregiver.service";
import { elderService } from "@/modules/elder-service/services/elder.service";
import { registerCarePlanSharingCheck } from "@/modules/elder-service/services/consent.hook";
import { consentService } from "@/modules/consent-service/services/consent.service";

visitService.registerCaregiverDirectory({
  caregiverIdForUser: (userId) => caregiverService.getCaregiverIdForUser(userId),
});
visitService.registerFamilyDirectory({
  elderIdsForUser: (userId) => elderService.listElderIdsForUser(userId),
});

// Consent (Kenya DPA): elder-service asks consent-service whether a caregiver
// may see a care plan.
registerCarePlanSharingCheck((elderId) => consentService.isCarePlanShared(elderId));

async function bootstrap() {
  await connectDatabase();
  await storageService.ensureBucket();

  startEventWorker();
  startBookingWorker();
  startCaregiverWorker();
  startEmergencyWorker();
  startVisitWorker();
  startBillingWorker();
  startNotificationWorker();
  startAuditWorker();

  const server = app.listen(env.PORT, () => {
    logger.info(`[server] MzaziCare API listening on :${env.PORT}${env.API_PREFIX}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`[server] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.error(`[server] failed to start: ${err}`);
  process.exit(1);
});
