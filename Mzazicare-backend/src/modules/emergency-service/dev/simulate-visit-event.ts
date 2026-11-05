/**
 * U-CS 72 — Priority Emergency Handling & Escalation System
 * Owner(s): Wyclef Wasike Tavasi
 *
 * DEVELOPMENT HELPER. Not imported by the app.
 *
 * Publishes a visit event exactly as visit-service (U-CS 73) will, so the
 * automatic alerts in consumers/emergency.handlers.ts can be tested before
 * visit-service exists. Run it inside the api container:
 *
 *   docker compose exec api pnpm exec tsx src/modules/emergency-service/dev/simulate-visit-event.ts missed <visitId> <bookingId>
 *   docker compose exec api pnpm exec tsx src/modules/emergency-service/dev/simulate-visit-event.ts breached <visitId> <distanceMeters>
 *
 * Ids must be 24-character hex strings.
 */

import logger from "@/shared/config/logger";
import { publish } from "@/shared/events/bus";

const [kind, visitId, arg] = process.argv.slice(2);

const main = async (): Promise<void> => {
  if (kind === "missed" && visitId && arg) {
    await publish("visit.missed", { visitId, bookingId: arg });
    logger.info(`[dev] published visit.missed for visit ${visitId}, booking ${arg}`);
  } else if (kind === "breached" && visitId && arg) {
    await publish("visit.geofence.breached", { visitId, distanceMeters: Number(arg) });
    logger.info(`[dev] published visit.geofence.breached for visit ${visitId}, ${arg} m`);
  } else {
    logger.error(
      "[dev] usage: simulate-visit-event.ts missed <visitId> <bookingId> | breached <visitId> <meters>",
    );
    process.exit(1);
  }
  process.exit(0);
};

void main();
