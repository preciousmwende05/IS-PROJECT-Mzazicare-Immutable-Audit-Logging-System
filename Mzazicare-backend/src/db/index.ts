import mongoose from "mongoose";

import { env } from "@/shared/config/env";
import logger from "@/shared/config/logger";

/**
 * Model files (`modules/<x>-service/models/*.model.ts`) register themselves on
 * this connection when they are first imported. Repositories are the only
 * layer that touches them.
 */
export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
  logger.info("[db] connected");
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  logger.info("[db] disconnected");
}

export { mongoose };
