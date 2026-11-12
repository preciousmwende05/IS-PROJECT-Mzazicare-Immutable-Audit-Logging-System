import nodemailer, { type Transporter } from "nodemailer";

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

/**
 * Development stand-in when SMTP_URL is not set: writes the message to the
 * log, the same way the SMS stub does, so a verification code can still be
 * read from `docker compose logs api`. Never used once SMTP_URL is set.
 */
const consoleEmail: EmailService = {
  send: async ({ to, subject, text }) => {
    logger.info(`[email:dev] -> ${to}: ${subject}${text ? ` | ${text}` : ""}`);
    return { id: `dev-${Date.now()}` };
  },
};

/**
 * The sender address. SMTP_FROM wins; otherwise the SMTP login is used, which
 * is what Gmail requires anyway (it rewrites any other From address).
 */
export const senderAddress = (smtpUrl: string, from?: string): string => {
  if (from) return from;
  try {
    const user = decodeURIComponent(new URL(smtpUrl).username);
    return user ? `MzaziCare <${user}>` : "MzaziCare";
  } catch {
    return "MzaziCare";
  }
};

/**
 * Any SMTP provider, chosen only by SMTP_URL, so moving from Gmail to Brevo
 * (or anything else) is a config change, not a code change:
 *
 *   Gmail  smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
 *   Brevo  smtp://LOGIN:SMTP_KEY@smtp-relay.brevo.com:587
 *
 * The transport is created once and reused (it pools the connection).
 */
export const createSmtpEmail = (smtpUrl: string, from?: string): EmailService => {
  let transport: Transporter | null = null;
  const sender = senderAddress(smtpUrl, from);
  return {
    send: async ({ to, subject, html, text }) => {
      transport ??= nodemailer.createTransport(smtpUrl);
      const info = await transport.sendMail({ from: sender, to, subject, html, text });
      return { id: String(info.messageId ?? `smtp-${Date.now()}`) };
    },
  };
};

export const emailConfigured = Boolean(env.SMTP_URL);

export const emailService: EmailService = env.SMTP_URL
  ? createSmtpEmail(env.SMTP_URL, env.SMTP_FROM)
  : consoleEmail;
