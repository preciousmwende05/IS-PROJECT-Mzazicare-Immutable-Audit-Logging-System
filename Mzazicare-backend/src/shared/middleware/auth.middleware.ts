import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "@/shared/config/env";
import { redis } from "@/shared/config/redis";
import { UnauthorizedError } from "@/shared/errors";
import type { Role } from "@/shared/types";

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  jti?: string;
  iat?: number;
}

/**
 * Tokens issued before a user's cut-off are refused. Set on deactivation,
 * suspension and role change, so the change takes effect immediately instead
 * of when the 15-minute access token expires. Kept for a day — far longer
 * than any access token lives.
 */
const CUTOFF_PREFIX = "auth:cutoff:";
const CUTOFF_TTL_SECONDS = 24 * 60 * 60;

export async function cutOffAccessTokens(userId: string): Promise<void> {
  const nowSeconds = Math.ceil(Date.now() / 1000);
  await redis.set(`${CUTOFF_PREFIX}${userId}`, String(nowSeconds), "EX", CUTOFF_TTL_SECONDS);
}

/**
 * Verifies the bearer token and populates req.user.
 *
 * Owned by auth-service (U-CS 67). Other modules consume it and must not
 * reimplement token parsing — if you need a new claim, ask that team.
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new UnauthorizedError("Missing bearer token"));

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET) as AccessTokenPayload;
  } catch {
    return next(new UnauthorizedError("Invalid or expired token"));
  }

  try {
    const cutoff = await redis.get(`${CUTOFF_PREFIX}${payload.sub}`);
    if (cutoff && (payload.iat ?? 0) < Number(cutoff)) {
      return next(new UnauthorizedError("Your session has ended. Please sign in again."));
    }
  } catch {
    // Fail closed: if we cannot check, we do not let the request through.
    return next(new UnauthorizedError("Session check unavailable"));
  }

  req.user = { id: payload.sub, role: payload.role };
  return next();
}

/** Attaches req.user when a token is present, but lets anonymous callers through. */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) return next();
  return authMiddleware(req, res, next);
}
