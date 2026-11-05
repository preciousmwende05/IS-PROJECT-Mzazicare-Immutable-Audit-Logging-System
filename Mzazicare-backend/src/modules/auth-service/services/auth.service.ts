/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * EVERY business rule for authentication lives here. The controller is thin,
 * the repository touches the DB, and this file decides. No express types
 * appear in this file — a function here can be called from a controller, a
 * worker, or a test without an HTTP server.
 *
 * The security rules enforced in this file:
 *   - never reveal which factor failed (unknown phone vs wrong password)
 *   - equalise timing so account existence cannot be probed
 *   - one-time, short-lived, hashed OTPs
 *   - lock after repeated failures, never ban
 *   - a password reset logs out every other device
 *   - an unverified or suspended account gets no tokens
 *
 * All persistence goes through `authRepository` (the team's single repository
 * object), including the OTP methods it exposes (createOtp, findValidOtp,
 * markOtpConsumed, incrementOtpAttempts, deleteActiveOtp).
 */

import { createHash, randomInt } from "node:crypto";

import bcrypt from "bcryptjs";

import { publish } from "@/shared/events/bus";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  LockedError,
  NotFoundError,
  UnauthorizedError,
} from "@/shared/errors";
import { cutOffAccessTokens } from "@/shared/middleware/auth.middleware";
import { smsQueue } from "@/shared/queues";
import { addMinutes } from "@/shared/utils/date.util";
import { authRepository } from "@/modules/auth-service/repository/auth.repository";
import { tokenService, type TokenPair } from "@/modules/auth-service/services/token.service";
import {
  type OtpPurpose,
  type User,
  type UserRole,
  type UserStatus,
} from "@/modules/auth-service/models/auth.model";

// ---------------------------------------------------------------------------
// Policy constants — tuned values live at the top so they are easy to review
// ---------------------------------------------------------------------------
const BCRYPT_COST = 12; // deliberate slowness; ~100ms+ per hash/compare
const OTP_TTL_MINUTES = 10; // how long a code stays valid
const MAX_OTP_ATTEMPTS = 5; // wrong guesses before a code is burnt
const MAX_LOGIN_ATTEMPTS = 5; // failures before the account locks
const LOCK_DURATION_MINUTES = 15; // how long the lock lasts

/**
 * A pre-computed bcrypt hash of a throwaway password.
 * Compared against whenever a login comes in for an UNKNOWN phone. Without
 * this, an unknown phone returns in ~0ms while a real one takes ~100ms — the
 * response-time difference is a phone-number oracle. With it, both paths burn
 * the same CPU time.
 */
const DUMMY_HASH = bcrypt.hashSync("timing-attack-dummy-password", BCRYPT_COST);

/**
 * generateOtp — create a fresh 6-digit code and its hash.
 * HOW IT WORKS:
 *   1. `randomInt(0, 1_000_000)` picks an integer in [0, 999999].
 *   2. `.toString().padStart(6, "0")` pads it to exactly six digits, so "42"
 *      becomes "000042" — the code is always the same length.
 *   3. `createHash("sha256").update(code).digest("hex")` hashes it.
 * Returns BOTH the plaintext (to SMS to the user — shown exactly once, then
 * discarded) and the hash (the only thing we persist).
 */
const generateOtp = (): { code: string; codeHash: string } => {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = createHash("sha256").update(code).digest("hex");
  return { code, codeHash };
};

/**
 * hashCode — hash a submitted code the SAME way generateOtp hashed the stored
 * one, so the two hashes can be compared with ===.
 */
const hashCode = (code: string): string => createHash("sha256").update(code).digest("hex");

/**
 * otpMessage — build the SMS body.
 * HOW IT WORKS: picks a human label by purpose (verification vs password
 * reset) and appends the code and expiry. The message is the ONLY place the
 * plaintext code is put into the SMS job payload.
 */
const otpMessage = (purpose: OtpPurpose, code: string): string =>
  `${purpose === "phone_verification" ? "MzaziCare verification code" : "MzaziCare password reset code"}: ${code}. Expires in ${OTP_TTL_MINUTES} minutes. Do not share it.`;

/**
 * issueOtp — generate, persist and deliver a code for a user and purpose.
 * HOW IT WORKS:
 *   1. generateOtp() produces the plaintext + hash.
 *   2. authRepository.createOtp persists ONLY the hash, with an expiresAt 10
 *      minutes in the future and attempts = 0.
 *   3. We enqueue an SMS job carrying the PLAINTEXT code. Note the queue: the
 *      actual SMS sending is slow, external work owned by notification-service
 *      (U-CS 76) — we never block the request on it. If the queue is down the
 *      code still exists and can be re-sent via /resend-otp.
 */
const issueOtp = async (user: User, purpose: OtpPurpose): Promise<void> => {
  const { code, codeHash } = generateOtp();
  await authRepository.createOtp({
    userId: user._id,
    codeHash,
    purpose,
    expiresAt: addMinutes(new Date(), OTP_TTL_MINUTES),
    attempts: 0,
  });
  // Slow, external work — the SMS worker (U-CS 76) drains this queue.
  await smsQueue.add("send-otp", { to: user.phone, purpose, body: otpMessage(purpose, code) });
};

/**
 * checkOtp — verify a submitted code against a stored hash, with brute-force
 * protection.
 * HOW IT WORKS:
 *   1. Hash the submitted code and compare to the stored hash.
 *   2. On a mismatch: `incrementOtpAttempts` atomically ticks the counter and
 *      returns the updated row. If that row has reached MAX_OTP_ATTEMPTS,
 *      consume (burn) the code so even the correct digits are now useless.
 *      Return false.
 *   3. On a match: return true (the CALLER consumes the code — see verifyPhone
 *      and resetPassword — so consumption is one decision, not two).
 * Returns a boolean; the caller decides what error to surface.
 */
const checkOtp = async (otpId: string, code: string, storedHash: string): Promise<boolean> => {
  if (hashCode(code) !== storedHash) {
    const updated = await authRepository.incrementOtpAttempts(otpId);
    if (updated && updated.attempts >= MAX_OTP_ATTEMPTS) {
      await authRepository.markOtpConsumed(otpId);
    }
    return false;
  }
  return true;
};

/**
 * recordFailedLogin — count a wrong password and lock the account if needed.
 * HOW IT WORKS:
 *   1. Compute `next` = current failed attempts + 1.
 *   2. If `next` has reached MAX_LOGIN_ATTEMPTS, set lockedUntil = now + 15 min;
 *      otherwise clear lockedUntil (null). We always persist both fields so the
 *      row reflects the latest state.
 *   3. Only called when the password was wrong AND the user exists (an unknown
 *      phone cannot be locked — there is nothing to lock).
 */
const recordFailedLogin = async (user: User): Promise<void> => {
  const next = (user.failedLoginAttempts ?? 0) + 1;
  await authRepository.update(String(user._id), {
    failedLoginAttempts: next,
    lockedUntil: next >= MAX_LOGIN_ATTEMPTS ? addMinutes(new Date(), LOCK_DURATION_MINUTES) : null,
  });
};

// ---------------------------------------------------------------------------
// Typed inputs — the controller hands these to the service. They are plain
// values (no req/res), which is what keeps the service callable from anywhere.
// ---------------------------------------------------------------------------
export type RegisterInput = { phone: string; name: string; password: string; role: UserRole };
export type LoginInput = { phone: string; password: string };
export type ListUsersQuery = { role?: UserRole; status?: UserStatus; q?: string; page: number; limit: number };
export type UpdateMeInput = { name?: string; email?: string };

/**
 * The service object. Every method is a pure business step: validate what
 * must be true, act, publish a fact, return the result. Errors are thrown as
 * AppError subclasses and translated to HTTP statuses by error.middleware.
 */
export const authService = {
  /**
   * register — create a pending account and send a verification OTP.
   * HOW IT WORKS:
   *   1. Reject a duplicate phone (409). We check in the DB; the unique index
   *      is the backstop if two requests race.
   *   2. bcrypt.hash the password at cost 12 — we never see or store the
   *      plaintext after this line.
   *   3. Persist the user with status "pending_verification". Crucially NO
   *      tokens are issued yet — the account is not trusted until the phone
   *      is proven.
   *   4. Send the OTP by SMS (issueOtp).
   *   5. Return the user; the controller serializes it with 201.
   */
  register: async (input: RegisterInput): Promise<User> => {
    if (await authRepository.findByPhone(input.phone)) {
      throw new ConflictError("This phone number is already registered");
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    const user = await authRepository.create({
      phone: input.phone,
      name: input.name,
      passwordHash,
      role: input.role,
      status: "pending_verification",
      failedLoginAttempts: 0,
    });

    await issueOtp(user, "phone_verification");
    return user;
  },

  /**
   * verifyPhone — redeem the OTP, activate the account, issue the first tokens.
   * HOW IT WORKS:
   *   1. Load the user by phone. If missing, throw the SAME generic message as
   *      an invalid code — we never confirm whether the phone is registered.
   *   2. Find the single active phone_verification code. None → generic error.
   *   3. checkOtp verifies the digits (and burns the code after 5 misses).
   *      Wrong → generic error again, with the attempt counter ticking up.
   *   4. Right → consume the code (single-use), then update the user to
   *      `active` with phoneVerifiedAt set.
   *   5. Publish `user.registered` so the rest of the system learns of the new
   *      active account (notification sends a welcome, audit records it).
   *   6. issue() the first token pair and return user + tokens. This is the
   *      ONLY moment an account transitions from "pending" to "usable".
   */
  verifyPhone: async (phone: string, code: string): Promise<User & TokenPair> => {
    const user = await authRepository.findByPhone(phone);
    if (!user) throw new BadRequestError("Invalid or expired verification code");

    const otp = await authRepository.findValidOtp(String(user._id), "phone_verification");
    if (!otp) throw new BadRequestError("Invalid or expired verification code");

    if (!(await checkOtp(String(otp._id), code, otp.codeHash))) {
      throw new BadRequestError("Invalid or expired verification code");
    }

    await authRepository.markOtpConsumed(String(otp._id));
    const activated = await authRepository.update(String(user._id), {
      phoneVerifiedAt: new Date(),
      status: "active",
    });
    if (!activated) throw new NotFoundError("User");

    await publish("user.registered", {
      userId: String(activated._id),
      role: activated.role,
      phone: activated.phone,
    });

    const pair = await tokenService.issue(String(activated._id), activated.role);
    return { ...activated, ...pair };
  },

  /**
   * resendOtp — issue a fresh code for a user who never got / lost the first.
   * HOW IT WORKS:
   *   1. Look up the user. If they DON'T exist, return silently (void) — the
   *      endpoint still answers 200 at the controller, so probing a phone
   *      cannot tell registered from unregistered.
   *   2. deleteActiveOtp() removes any existing live code for this purpose —
   *      "one active OTP per purpose" is enforced by replacement.
   *   3. issueOtp() generates and delivers the new code.
   */
  resendOtp: async (phone: string, purpose: OtpPurpose): Promise<void> => {
    // Never reveal whether the account exists.
    const user = await authRepository.findByPhone(phone);
    if (!user) return;

    await authRepository.deleteActiveOtp(String(user._id), purpose);
    await issueOtp(user, purpose);
  },

  /**
   * login — verify credentials and issue a token pair.
   * HOW IT WORKS (order matters, it IS the security):
   *   1. Load the user WITH the password hash (`true` selects the hash).
   *   2. bcrypt.compare the submitted password against the real hash, or the
   *      DUMMY_HASH if the phone is unknown — one compare either way, same
   *      cost, no timing leak.
   *   3. If the user is missing OR the password is wrong: record the failed
   *      attempt (if the user exists) and throw the IDENTICAL 401. The caller
   *      can never tell which part failed.
   *   4. If lockedUntil is in the future → 423. This check comes AFTER the
   *      credential check so a locked account only reveals itself to someone
   *      who already knows the password.
   *   5. If status is not "active" (pending/suspended/deactivated) → 403.
   *   6. On success: reset the failure counters, stamp lastLoginAt.
   *   7. issue() a fresh token pair and publish user.logged_in.
   */
  login: async (input: LoginInput): Promise<User & TokenPair> => {
    const user = await authRepository.findByPhone(input.phone, true);

    // Same message for an unknown phone and a wrong password — never reveal
    // which one failed, and burn the same bcrypt time for both.
    const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      if (user) await recordFailedLogin(user);
      throw new UnauthorizedError("Invalid credentials");
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new LockedError();
    }

    if (user.status !== "active") {
      throw new ForbiddenError("Account is not active");
    }

    const updated = await authRepository.update(String(user._id), {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    if (!updated) throw new NotFoundError("User");

    const pair = await tokenService.issue(String(updated._id), updated.role);
    await publish("user.logged_in", {
      userId: String(updated._id),
      at: new Date().toISOString(),
    });

    return { ...updated, ...pair };
  },

  /**
   * refresh — exchange a still-valid refresh token for a new pair.
   * HOW IT WORKS:
   *   1. Signature-verify the token and extract sub/jti (throws 401 if bad).
   *   2. Load the user. We check the account BEFORE rotating, so a suspended
   *      or deleted user's old token can never mint a fresh pair.
   *   3. rotate() checks the jti is still live in Redis, revokes the old jti
   *      and issues a brand-new pair. Reusing the same token a second time
   *      finds the jti gone → 401 (the reuse-detection guarantee).
   * Note the user returned here is freshly read from the DB, but the ROLE
   * baked into the new tokens comes from the old token's payload — a role
   * change only takes effect after a real login.
   */
  refresh: async (refreshToken: string): Promise<User & TokenPair> => {
    const payload = tokenService.verifyRefresh(refreshToken);
    const user = await authRepository.findById(payload.sub);
    if (!user || user.status !== "active") {
      throw new UnauthorizedError("Account is not active");
    }

    // Rotate only after the user checks pass, so we never mint a pair for a
    // dead account.
    const pair = await tokenService.rotate(refreshToken, payload.sub, payload.role);
    return { ...user, ...pair };
  },

  /**
   * logout — blacklist the presented refresh token.
   * HOW IT WORKS:
   *   1. Try to signature-verify the token. A stale or malformed token simply
   *      means there is nothing worth revoking — we swallow the error rather
   *      than 401 a logout (logging out should never fail loudly).
   *   2. Guard: only revoke if the token belongs to the authenticated caller
   *      (sub matches userId) — we won't revoke someone else's session even if
   *      handed their token.
   *   3. tokenService.revoke deletes the jti's Redis key; the access token is
   *      left to expire naturally in 15 minutes (it is not revocable).
   */
  logout: async (refreshToken: string, userId: string): Promise<void> => {
    // A stale or malformed token means there is simply nothing to blacklist.
    try {
      const payload = tokenService.verifyRefresh(refreshToken);
      if (payload.sub !== userId) return;
      await tokenService.revoke(payload.jti, userId);
    } catch {
      /* nothing to revoke */
    }
  },

  /**
   * getMe — fetch the current user's profile.
   * HOW IT WORKS: loads by the id from the VERIFIED access token (req.user.id)
   * and 404s if the account no longer exists. There is no business logic here —
   * the controller serializes the result into a UserView.
   */
  getMe: async (userId: string): Promise<User> => {
    const user = await authRepository.findById(userId);
    if (!user) throw new NotFoundError("User");
    return user;
  },

  /**
   * Every active user with a role. notification-service uses it for role-wide
   * alerts ("all coordinators", "all admins and auditors"); emergency-service
   * for its escalation ladder. Without it those notifications had no recipients.
   */
  listActiveUserIdsByRole: (role: UserRole): Promise<string[]> => authRepository.findActiveIdsByRole(role),

  /**
   * For other modules that show WHO did something (e.g. "who accessed my
   * data"): id -> { name, role }. Names and roles only; never phone or email.
   */
  getDisplayNames: async (ids: string[]): Promise<Map<string, { name: string; role: string }>> => {
    const valid = [...new Set(ids)].filter((id) => /^[a-f\d]{24}$/i.test(id));
    if (!valid.length) return new Map();
    const rows = await authRepository.findProfilesByIds(valid);
    return new Map(rows.map((u) => [String(u._id), { name: u.name, role: u.role }]));
  },

  /**
   * updateMe — edit the caller's own name and/or email.
   * HOW IT WORKS:
   *   1. Load the current user (404 if gone).
   *   2. If an email is being set AND it differs from the current one, check
   *      nobody else already holds it (409). We compare `_id` so a user
   *      re-submitting their own email passes.
   *   3. Build a patch with ONLY the provided fields — undefined fields are
   *      skipped, so an absent name never wipes the stored one.
   *   4. Persist and return. Note: role/phone/status are NOT in the input type,
   *      so a caller cannot self-escalate or change their identity here.
   */
  updateMe: async (userId: string, input: UpdateMeInput): Promise<User> => {
    const current = await authRepository.findById(userId);
    if (!current) throw new NotFoundError("User");

    if (input.email !== undefined && input.email !== current.email && input.email) {
      const taken = await authRepository.findByEmail(input.email);
      if (taken && String(taken._id) !== userId) {
        throw new ConflictError("That email is already in use");
      }
    }

    const patch: Partial<{ name: string; email: string }> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email;

    const updated = await authRepository.update(userId, patch);
    if (!updated) throw new NotFoundError("User");
    return updated;
  },

  /**
   * changePassword — replace the password after proving the current one.
   * HOW IT WORKS:
   *   1. Load the user WITH the hash (findById(id, true)) — we must read the
   *      secret to compare against it.
   *   2. bcrypt.compare the submitted current password; wrong → 401 (same
   *      message as a bad login, so we don't confirm or deny who owns the
   *      account).
   *   3. Hash the new password and persist it.
   *   4. revokeAllFor() kills every refresh token — this change logs out all
   *      other devices, not just this one. Otherwise a leaked password keeps
   *      working on other sessions indefinitely.
   *   5. Publish user.password.changed so notification/audit can react.
   */
  changePassword: async (
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    const user = await authRepository.findById(userId, true);
    if (!user) throw new NotFoundError("User");

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("Current password is incorrect");
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await authRepository.update(userId, { passwordHash });

    // A password change must log out every other device.
    await tokenService.revokeAllFor(userId);
    await publish("user.password.changed", { userId });
  },

  /**
   * forgotPassword — start a password reset.
   * HOW IT WORKS: identical shape to resendOtp but for the password_reset
   * purpose, and it is SPECIFICALLY designed to always look successful:
   *   - unknown phone → return silently (the controller still answers 200 with
   *     "if that account exists, a code has been sent").
   *   - known phone → invalidate any old reset code and send a fresh one.
   * An attacker cannot use this endpoint to harvest registered phone numbers.
   */
  forgotPassword: async (phone: string): Promise<void> => {
    // Always succeeds — enumeration must not be possible.
    const user = await authRepository.findByPhone(phone);
    if (!user) return;

    await authRepository.deleteActiveOtp(String(user._id), "password_reset");
    await issueOtp(user, "password_reset");
  },

  /**
   * resetPassword — complete a reset with the code from the SMS.
   * HOW IT WORKS (mirrors verifyPhone but ends with a password write):
   *   1. Load the user; missing → generic "invalid reset code" 400.
   *   2. Find the active password_reset OTP; missing → same generic error.
   *   3. checkOtp verifies the digits (burning after 5 wrong tries).
   *   4. Consume the code, hash the new password, persist it, and clear any
   *      failure counters/lock.
   *   5. revokeAllFor() — the reset must log out every device (same rule as
   *      changePassword).
   *   6. Publish user.password.changed.
   */
  resetPassword: async (phone: string, code: string, newPassword: string): Promise<void> => {
    const user = await authRepository.findByPhone(phone);
    if (!user) throw new BadRequestError("Invalid or expired reset code");

    const otp = await authRepository.findValidOtp(String(user._id), "password_reset");
    if (!otp) throw new BadRequestError("Invalid or expired reset code");

    if (!(await checkOtp(String(otp._id), code, otp.codeHash))) {
      throw new BadRequestError("Invalid or expired reset code");
    }

    await authRepository.markOtpConsumed(String(otp._id));

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await authRepository.update(String(user._id), {
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    await tokenService.revokeAllFor(String(user._id));
    await publish("user.password.changed", { userId: String(user._id) });
  },

  /** Admin directory. `q` matches name (any case) or phone. */
  listUsers: async (query: ListUsersQuery) => {
    const where: Record<string, unknown> = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.q) {
      const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      where.$or = [{ name: { $regex: safe, $options: "i" } }, { phone: { $regex: safe } }];
    }
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await authRepository.findPage(where, skip, query.limit);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) || 1 };
  },

  /**
   * updateRole — an admin changes someone's role. Their sessions are ended so
   * the new role applies at their next sign-in, not 15 minutes later.
   */
  updateRole: async (userId: string, role: UserRole, actorId: string): Promise<User> => {
    if (userId === actorId) throw new ForbiddenError("You cannot change your own role");
    const user = await authRepository.update(userId, { role });
    if (!user) throw new NotFoundError("User");
    await tokenService.revokeAllFor(userId);
    await cutOffAccessTokens(userId);
    return user;
  },

  /**
   * updateStatus — an admin changes an account's lifecycle state. Suspending
   * or deactivating ends every session immediately (refresh AND access tokens).
   * An admin cannot change their own status (no accidental self-lockout).
   */
  updateStatus: async (userId: string, status: UserStatus, actorId: string): Promise<User> => {
    if (userId === actorId) throw new ForbiddenError("You cannot change your own account status");
    const user = await authRepository.update(userId, { status });
    if (!user) throw new NotFoundError("User");

    if (status === "suspended" || status === "deactivated") {
      await tokenService.revokeAllFor(userId);
      await cutOffAccessTokens(userId);
    }
    return user;
  },
};