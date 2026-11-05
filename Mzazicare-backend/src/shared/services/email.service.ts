import { env } from "@/shared/config/env";
import logger from "@/shared/config/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<{ id: string }>;
}

const consoleEmail: EmailService = {
  send: async ({ to, subject }) => {
    logger.info(`[email:dev] -> ${to}: ${subject}`);
    return { id: `dev-${Date.now()}` };
  },
};

const smtpEmail: EmailService = {
  send: async () => {
    // TODO(notification-service, U-CS 76): send via nodemailer using env.SMTP_URL.
    throw new Error("smtpEmail.send not implemented");
  },
};

export const emailService: EmailService = env.SMTP_URL ? smtpEmail : consoleEmail;
