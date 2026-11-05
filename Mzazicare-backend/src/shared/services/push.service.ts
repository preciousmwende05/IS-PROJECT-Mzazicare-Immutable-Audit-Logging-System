import logger from "@/shared/config/logger";

export interface PushMessage {
  deviceTokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushService {
  send(message: PushMessage): Promise<{ delivered: number; invalidTokens: string[] }>;
}

const consolePush: PushService = {
  send: async ({ deviceTokens, title }) => {
    logger.info(`[push:dev] -> ${deviceTokens.length} device(s): ${title}`);
    return { delivered: deviceTokens.length, invalidTokens: [] };
  },
};

// TODO(notification-service, U-CS 76): add an FCM implementation, selected by env.
export const pushService: PushService = consolePush;
