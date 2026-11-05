import logger from "@/shared/config/logger";
import { connectDatabase, disconnectDatabase } from "@/db/index";

/**
 * Development seed data. Run with `npm run db:seed`.
 *
 * Each team adds a `seed<Module>()` in its own module and calls it below, in
 * dependency order — users before elders, elders before bookings.
 */
async function seed() {
  await connectDatabase();

  // await seedUsers();       // U-CS 67
  // await seedElders();      // U-CS 68
  // await seedCaregivers();  // U-CS 69
  // await seedServices();    // U-CS 70

  logger.info("[seed] complete");
  await disconnectDatabase();
  process.exit(0);
}

seed().catch((err) => {
  logger.error(`[seed] failed: ${err}`);
  process.exit(1);
});
