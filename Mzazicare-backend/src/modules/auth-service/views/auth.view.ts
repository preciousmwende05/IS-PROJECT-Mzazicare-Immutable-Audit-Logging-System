/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The "public face" of a User. Every endpoint that returns user data must pass
 * the document through a serializer in this file. A field reaches the client
 * ONLY if someone added it here on purpose.
 *
 * This is the module's second line of defense after `select: false`: even if
 * a buggy query DID fetch passwordHash, `serializeUser`'s return type has no
 * field for it — TypeScript makes leaking it a compile error, not a runtime
 * accident.
 */

import type { User } from "@/modules/auth-service/models/auth.model";

// ---------------------------------------------------------------------------
// UserView — the shape of a user as seen by the client
// ---------------------------------------------------------------------------
// Note what is NOT here: passwordHash, failedLoginAttempts, lockedUntil.
// Internal security state never leaves the server. Dates are strings (ISO),
// not Date objects, because JSON has no Date type — and Mongoose lean docs
// hold Dates, so we convert explicitly here.
export type UserView = {
  id: string;
  phone: string;
  email: string | null;
  name: string;
  role: User["role"];
  status: User["status"];
  phoneVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * serializeUser — map a raw User document to the safe public shape.
 * HOW IT WORKS:
 *   1. Every field is copied one-by-one into a fresh plain object. Nothing is
 *      spread from the document, so no hidden field can ride along.
 *   2. `_id` is an ObjectId; we String() it to produce a stable id string.
 *   3. Optional Dates (email, phoneVerifiedAt, lastLoginAt) are collapsed to
 *      either an ISO string or null — never `undefined`, which JSON.stringify
 *      would silently drop and make the frontend field "sometimes missing".
 *   4. The returned value is typed UserView, so forgetting a field — or
 *      accidentally including passwordHash — fails the build.
 */
export const serializeUser = (user: User): UserView => ({
  id: String(user._id),
  phone: user.phone,
  email: user.email ?? null,
  name: user.name,
  role: user.role,
  status: user.status,
  phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

// ---------------------------------------------------------------------------
// AuthView — what login / verify / refresh return
// ---------------------------------------------------------------------------
// The login, verify-phone and refresh endpoints all answer the same question:
// "here is who you are, and here are your tokens". One type keeps the three
// responses identical for the frontend.
export type AuthView = {
  user: UserView;
  accessToken: string;
  refreshToken: string;
};

/**
 * serializeAuth — bundle a user with a fresh token pair.
 * HOW IT WORKS:
 *   Reuses serializeUser (so the user part can never drift from the /me
 *   response) and adds the two tokens next to it. The tokens are opaque
 *   strings — this file never inspects them; it just places them in the
 *   response envelope.
 */
export const serializeAuth = (
  user: User,
  accessToken: string,
  refreshToken: string,
): AuthView => ({
  user: serializeUser(user),
  accessToken,
  refreshToken,
});