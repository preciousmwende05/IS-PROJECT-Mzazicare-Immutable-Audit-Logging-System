/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Tokens, and only tokens. Kept out of auth.service so that the signing,
 * rotation and revocation rules are testable in isolation.
 *
 * The refresh-token design in a nutshell:
 *   - The access token is a short-lived JWT (15 min) verified purely from its
 *     signature — no database lookup. That makes it fast but NOT revocable.
 *   - The refresh token is a longer-lived JWT (30 days) whose **jti** (token
 *     id) is ALSO stored in Redis. Being in Redis is what makes it revocable:
 *     delete the key and the token dies.
 *   - Refresh tokens rotate: every use mints a NEW token and deletes the old
 *     one, so a token is valid exactly once. Presenting it twice = reuse
 *     detection = probably stolen.
 */

import { randomUUID } from "node:crypto";

import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";

import { env } from "@/shared/config/env";
import { redis } from "@/shared/config/redis";
import { UnauthorizedError } from "@/shared/errors";
import type { Role } from "@/shared/types";

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

// What an ACCESS token carries. `sub` is the user id (the JWT-standard claim
// for "subject"), `role` is baked in so authMiddleware can check permissions
// without a database round-trip. No `jti` — access tokens are not tracked.
export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: Role;
}

// What a REFRESH token carries. It adds `jti` — the unique id that links the
// token to its Redis record. This is the handle we revoke by.
export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  role: Role;
  jti: string;
}

// The pair handed to the client, plus the jti so the service can revoke it.
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  jti: string;
}

// ---------------------------------------------------------------------------
// Redis key layout
// ---------------------------------------------------------------------------
//   auth:refresh:<jti>  →  userId          (one record per live refresh token)
//   auth:sessions:<userId> → set of jtis    (all live tokens for one user)
// The second key exists so "revoke EVERYTHING for this user" is one smembers
// call instead of scanning the whole key space.
const REFRESH_PREFIX = "auth:refresh:";
const SESSIONS_PREFIX = "auth:sessions:";

/**
 * parseTtlSeconds — turn a TTL string like "15m" or "30d" into seconds.
 * HOW IT WORKS:
 *   1. A regex captures the number and the unit: /^(\d+)([smhd])$/.
 *   2. If it does NOT match, we fall back to 30 days. The fallback matters:
 *      returning 0 would make Redis set the key with "expire immediately",
 *      silently killing every session — a far worse failure than a slightly
 *      long default.
 *   3. The unit map converts to seconds and the number multiplies it.
 * Redis needs seconds for its EX (expiry) option, but the config speaks in
 * human units — this bridge keeps both readable.
 */
const parseTtlSeconds = (ttl: string): number => {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 30 * 86_400; // unparseable TTL falls back to 30 days rather than expiring instantly
  const value = Number(match[1]);
  const unitSeconds = { s: 1, m: 60, h: 3_600, d: 86_400 }[match[2]!]!;
  return value * unitSeconds;
};

// The refresh lifetime in seconds — computed once at startup, not per request.
const REFRESH_TTL_SECONDS = parseTtlSeconds(env.JWT_REFRESH_TTL);

/**
 * signAccessToken — mint an access token for a user.
 * HOW IT WORKS: jwt.sign with the payload { sub, role } and the access
 * secret, with `expiresIn` from config (default "15m"). The secret is a
 * DIFFERENT key from the refresh secret — if one leaks, the other tokens are
 * still safe. Expiry is encoded into the token itself, so verifying the
 * signature is enough to know it is still valid.
 */
const signAccessToken = (userId: string, role: Role): string =>
  jwt.sign({ sub: String(userId), role }, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
  });

export const tokenService = {
  /**
   * issue — create a fresh token pair and register the refresh jti in Redis.
   * HOW IT WORKS:
   *   1. Generate a new random `jti` (v4 UUID — unguessable, unique).
   *   2. Sign the refresh token embedding that jti. We do NOT pass an expiresIn
   *      that we then have to reconcile with Redis; the TTL strings come from
   *      the same env config, and REFRESH_TTL_SECONDS mirrors it for Redis.
   *   3. `redis.set(auth:refresh:<jti>, userId, "EX", ttl)` — the record that
   *      makes the token revocable. It auto-expires after the refresh lifetime.
   *   4. `redis.sadd(auth:sessions:<userId>, jti)` tracks the token in the
   *      user's session set, and we refresh that set's own TTL so it stays
   *      alive as long as its freshest member.
   *   5. Sign the access token (independent, short-lived) and return everything.
   */
  issue: async (userId: string, role: Role): Promise<TokenPair> => {
    const jti = randomUUID();
    const refreshToken = jwt.sign({ sub: String(userId), role, jti }, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_TTL as SignOptions["expiresIn"],
    });

    await redis.set(`${REFRESH_PREFIX}${jti}`, String(userId), "EX", REFRESH_TTL_SECONDS);
    await redis.sadd(`${SESSIONS_PREFIX}${userId}`, jti);
    // Keep the session set alive as long as its freshest token.
    await redis.expire(`${SESSIONS_PREFIX}${userId}`, REFRESH_TTL_SECONDS);

    return { accessToken: signAccessToken(userId, role), refreshToken, jti };
  },

  /**
   * verifyRefresh — check a refresh token's SIGNATURE only.
   * HOW IT WORKS:
   *   1. jwt.verify rejects expired, malformed or wrong-secret tokens by
   *      throwing — we convert any throw into an UnauthorizedError (401).
   *   2. We then demand sub AND jti exist; a well-formed token always has
   *      both, so their absence means something forged.
   *   3. IMPORTANT: this does NOT prove the token is still live — the jti
   *      might already be revoked. Liveness is the Redis check in rotate().
   *   4. If verification fails, we deliberately DO NOT say why ("expired" vs
   *      "tampered") — the client only needs to know it must log in again.
   */
  verifyRefresh: (refreshToken: string): RefreshTokenPayload => {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
      if (!payload.sub || !payload.jti) throw new Error("missing sub/jti");
      return payload;
    } catch {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }
  },

  /**
   * rotate — exchange a used refresh token for a fresh pair (with reuse check).
   * HOW IT WORKS:
   *   1. Signature-verify the incoming token and extract its jti.
   *   2. Look up `auth:refresh:<jti>`. If the key is missing OR the stored
   *      userId doesn't match the caller, the token was revoked or reused —
   *      this is where a stolen token gets caught (it was already rotated
   *      away). Throw.
   *   3. Revoke the OLD jti (delete its Redis key and drop it from the user's
   *      session set). This makes the token single-use.
   *   4. issue() a brand-new pair with a new jti and return it.
   * Net effect: after every /refresh, exactly one refresh token remains valid.
   */
  rotate: async (refreshToken: string, userId: string, role: Role): Promise<TokenPair> => {
    const payload = tokenService.verifyRefresh(refreshToken);
    const stored = await redis.get(`${REFRESH_PREFIX}${payload.jti}`);
    if (!stored || stored !== String(userId)) {
      throw new UnauthorizedError("Refresh token has been revoked");
    }

    await tokenService.revoke(payload.jti, String(userId));
    return tokenService.issue(userId, role);
  },

  /**
   * revoke — kill ONE refresh token (used by logout and by rotation).
   * HOW IT WORKS: two Redis calls:
   *   1. `del auth:refresh:<jti>` — removes the token's liveness record, so a
   *      future rotate() finds nothing and rejects it.
   *   2. `srem auth:sessions:<userId> jti` — removes the jti from the user's
   *      session set so revokeAllFor() won't try to delete it again.
   * This is idempotent: revoking an already-revoked jti is a harmless no-op.
   */
  revoke: async (jti: string, userId: string): Promise<void> => {
    await redis.del(`${REFRESH_PREFIX}${jti}`);
    await redis.srem(`${SESSIONS_PREFIX}${userId}`, jti);
  },

  /**
   * revokeAllFor — kill every session a user has (password reset, suspension).
   * HOW IT WORKS:
   *   1. `smembers auth:sessions:<userId>` lists all live jtis for the user.
   *   2. Delete each `auth:refresh:<jti>` key in one batch `del` call.
   *   3. Delete the session set itself.
   * This is what makes "a password reset logs out every other device" a real
   * guarantee instead of a promise — every refresh token stops working at once,
   * so every device must log in again.
   */
  revokeAllFor: async (userId: string): Promise<void> => {
    const jtis = await redis.smembers(`${SESSIONS_PREFIX}${userId}`);
    if (jtis.length) await redis.del(...jtis.map((j) => `${REFRESH_PREFIX}${j}`));
    await redis.del(`${SESSIONS_PREFIX}${userId}`);
  },
};