import AfricasTalking from "africastalking";

import { env } from "@/shared/config/env";
import logger from "@/shared/config/logger";

export interface SmsMessage {
  to: string; // E.164, from normalizeKenyanPhone()
  body: string;
}

/**
 * Modules depend on this interface, never on a vendor SDK. That is what makes
 * a service unit-testable: swap in a fake and assert on it.
 */
export interface SmsService {
  send(message: SmsMessage): Promise<{ id: string }>;
}

const consoleSms: SmsService = {
  send: async ({ to, body }) => {
    logger.info(`[sms:dev] -> ${to}: ${body}`);
    return { id: `dev-${Date.now()}` };
  },
};

// 100 Processed, 101 Sent, 102 Queued
const AT_ACCEPTED = new Set([100, 101, 102]);

let atClient: ReturnType<typeof AfricasTalking> | null = null;

const africasTalkingSms: SmsService = {
  send: async ({ to, body }) => {
    atClient ??= AfricasTalking({ apiKey: env.SMS_API_KEY!, username: env.SMS_USERNAME! });
    const res = await atClient.SMS.send({
      to,
      message: body,
      ...(env.SMS_SENDER_ID ? { from: env.SMS_SENDER_ID } : {}),
    });
    const recipient = res.SMSMessageData?.Recipients?.[0];
    if (!recipient || !AT_ACCEPTED.has(recipient.statusCode)) {
      throw new Error(`Africa's Talking rejected the SMS: ${recipient?.status ?? res.SMSMessageData?.Message ?? "no recipient"}`);
    }
    return { id: recipient.messageId };
  },
};

export const smsConfigured = Boolean(env.SMS_API_KEY && env.SMS_USERNAME);

export const smsService: SmsService =
  env.SMS_API_KEY && env.SMS_USERNAME ? africasTalkingSms : consoleSms;
