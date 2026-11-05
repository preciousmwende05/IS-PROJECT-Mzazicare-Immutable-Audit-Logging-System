import logger from "@/shared/config/logger";
import { notificationsQueue } from "@/shared/queues";
import type { Role } from "@/shared/types";

export type NotificationAudience = {
  userIds?: string[];
  caregiverIds?: string[];
  roles?: Role[];
};

export type NotificationRequest = {
  template: string;
  audience: NotificationAudience;
  data: Record<string, unknown>;
  urgency?: "normal" | "high";
};

export type NotifyOptions = {
  dedupeKey?: string;
};

// BullMQ job ids cannot contain ":" or be plain integers.
const toJobId = (key: string) => `n_${key.replace(/:/g, "_")}`;

export const notify = async (
  request: NotificationRequest,
  options: NotifyOptions = {},
): Promise<void> => {
  const hasAudience =
    !!request.audience.userIds?.length ||
    !!request.audience.caregiverIds?.length ||
    !!request.audience.roles?.length;
  if (!hasAudience) {
    logger.warn(`[notify] ${request.template}: empty audience, nothing queued`);
    return;
  }
  try {
    await notificationsQueue.add(
      request.template,
      request,
      options.dedupeKey ? { jobId: toJobId(options.dedupeKey) } : undefined,
    );
  } catch (err) {
    logger.error(`[notify] could not queue ${request.template}: ${(err as Error).message}`);
  }
};
