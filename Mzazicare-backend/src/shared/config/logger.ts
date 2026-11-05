import winston from "winston";

import { env } from "@/shared/config/env";

const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    env.NODE_ENV === "production"
      ? winston.format.json()
      : winston.format.printf(
          ({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`,
        ),
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
