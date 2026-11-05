/**
 * U-CS 76 — Care Coordination Notification System
 * Owner(s): UNASSIGNED
 */

import { randomBytes } from "node:crypto";

import type { Response } from "express";
import type Redis from "ioredis";

import logger from "@/shared/config/logger";
import { redis } from "@/shared/config/redis";
import type { Notification } from "@/modules/notification-service/models/notification.model";
import { serializeNotification } from "@/modules/notification-service/views/notification.view";

const CHANNEL = "notifications:in-app";
const TICKET_TTL_SECONDS = 30;
const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_USER = 5;

type StreamEvent = "notification" | "unread-count";
type Message = { userId: string; event: StreamEvent; data: unknown; id?: string };

const streams = new Map<string, Set<Response>>();
let subscriber: Redis | null = null;

const ticketKey = (ticket: string) => `notifications:sse-ticket:${ticket}`;

const write = (res: Response, event: StreamEvent, data: unknown, id?: string) => {
  res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const ensureSubscribed = () => {
  if (subscriber) return;
  subscriber = redis.duplicate();
  subscriber.on("error", (err) => logger.error(`[notification] sse subscriber: ${err.message}`));
  subscriber.on("message", (_channel, raw: string) => {
    const msg = JSON.parse(raw) as Message;
    for (const res of streams.get(msg.userId) ?? []) write(res, msg.event, msg.data, msg.id);
  });
  subscriber
    .subscribe(CHANNEL)
    .catch((err: unknown) =>
      logger.error(`[notification] sse subscribe failed: ${(err as Error).message}`),
    );
};

const publish = (msg: Message) =>
  redis
    .publish(CHANNEL, JSON.stringify(msg))
    .catch((err: unknown) =>
      logger.warn(`[notification] sse publish failed: ${(err as Error).message}`),
    );

const closeAll = () => {
  for (const set of streams.values()) for (const res of set) res.end();
  streams.clear();
};

// server.close() waits for open streams
process.once("SIGTERM", closeAll);
process.once("SIGINT", closeAll);

export const realtimeService = {
  createTicket: async (userId: string) => {
    const ticket = randomBytes(24).toString("base64url");
    await redis.set(ticketKey(ticket), userId, "EX", TICKET_TTL_SECONDS);
    return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
  },

  redeemTicket: (ticket: string): Promise<string | null> => redis.getdel(ticketKey(ticket)),

  open: (userId: string, res: Response, backlog: Notification[], unread: number) => {
    ensureSubscribed();

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 5000\n\n");

    for (const n of backlog) write(res, "notification", serializeNotification(n), String(n._id));
    write(res, "unread-count", { count: unread });

    const set = streams.get(userId) ?? new Set<Response>();
    if (set.size >= MAX_STREAMS_PER_USER) {
      const oldest = set.values().next().value;
      if (oldest) {
        oldest.end();
        set.delete(oldest);
      }
    }
    set.add(res);
    streams.set(userId, set);

    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    res.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (!set.size) streams.delete(userId);
    });
  },

  pushNotification: (notification: Notification) =>
    publish({
      userId: String(notification.userId),
      event: "notification",
      data: serializeNotification(notification),
      id: String(notification._id),
    }),

  pushUnreadCount: (userId: string, count: number) =>
    publish({ userId, event: "unread-count", data: { count } }),
};
