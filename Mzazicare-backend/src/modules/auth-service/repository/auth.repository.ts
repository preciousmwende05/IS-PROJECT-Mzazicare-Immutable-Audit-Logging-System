/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The ONLY layer allowed to touch the database. Repositories answer data
 * questions ("find me this row", "write this row") and NOTHING else — no
 * throwing of business errors, no policy, no events, no bcrypt.
 *
 * That single-responsibility rule is what lets the service layer be pure
 * logic. If storage changes (Mongo → Postgres), only this file changes.
 *
 * NOTE: the User and OtpCode data access methods live in ONE repository object
 * here (authRepository) — the OTP methods are prefixed to make their purpose
 * obvious (createOtp, findValidOtp, markOtpConsumed, …).
 */

import type { Types } from "mongoose";
import {
  UserModel,
  OtpCodeModel,
  type User,
  type NewUser,
  type OtpCode,
  type NewOtpCode,
  type OtpPurpose,
} from "@/modules/auth-service/models/auth.model";

/**
 * The only layer allowed to touch the database. Repositories answer data
 * questions ("find these rows"); they never decide anything.
 */
export type FindUserOptions =
  | boolean
  | {
      withPassword?: boolean;
      includePassword?: boolean;
    };

/**
 * shouldSelectPassword — normalise the two ways a caller can ask for the hash.
 * HOW IT WORKS:
 *   - pass `true` → select the hash
 *   - pass `{ withPassword: true }` or `{ includePassword: true }` → also true
 *   - anything else (false, undefined, an empty options object) → false
 * This gives callers a short form (findByPhone(phone, true)) and a verbose,
 * self-documenting form, both converging on the same behaviour.
 */
const shouldSelectPassword = (options?: FindUserOptions): boolean => {
  if (typeof options === "boolean") {
    return options;
  }
  return Boolean(options?.withPassword ?? options?.includePassword);
};

export const authRepository = {
  /**
   * findById — the most basic lookup, by id.
   * HOW IT WORKS: `findById` wraps `findOne({ _id: id })` and casts the string
   * to an ObjectId. `.lean<User>()` returns a plain object or null. With
   * `options` = true / { withPassword: true } it ALSO selects the hash — the
   * default (no options) keeps `passwordHash` hidden by the schema's
   * `select: false`, so a careless caller cannot accidentally read a secret.
   */
  findById: async (
    id: string | Types.ObjectId,
    options?: FindUserOptions,
  ): Promise<(User & { passwordHash?: string }) | null> => {
    const query = UserModel.findById(id);
    if (shouldSelectPassword(options)) {
      query.select("+passwordHash");
    }
    return query.lean<User & { passwordHash?: string }>();
  },

  /**
   * findByPhone — lookup by the login identifier (E.164).
   * HOW IT WORKS: finds by the exact normalised phone string. Same options
   * contract as findById — login passes `true` because it must run
   * bcrypt.compare; everything else uses the default (no hash).
   */
  findByPhone: async (
    phone: string,
    options?: FindUserOptions,
  ): Promise<(User & { passwordHash?: string }) | null> => {
    const query = UserModel.findOne({ phone });
    if (shouldSelectPassword(options)) {
      query.select("+passwordHash");
    }
    return query.lean<User & { passwordHash?: string }>();
  },

  /**
   * findByEmail — used by updateMe to enforce email uniqueness.
   * HOW IT WORKS: finds by the normalised email. The caller (service) decides
   * what to do when the result belongs to someone else; this method just
   * answers "who, if anyone, holds this email?".
   */
  findByEmail: async (email: string): Promise<User | null> =>
    UserModel.findOne({ email }).lean<User>(),

  /**
   * create — insert a new user.
   * HOW IT WORKS: `UserModel.create(data)` runs the schema's validation,
   * defaults and (unique) index checks, then returns a live document.
   * `doc.toObject()` converts it to a plain object and we cast to User so the
   * caller gets the same lean shape everywhere. A duplicate phone throws a
   * Mongo duplicate-key error (code 11000) here.
   */
  create: async (data: NewUser): Promise<User> => {
    const doc = await UserModel.create(data);
    return doc.toObject() as User;
  },

  /**
   * updateById — patch a user by id.
   * HOW IT WORKS: `findByIdAndUpdate` with `{ new: true }` returns the
   * document AFTER the update, or null if the id doesn't exist. The core of
   * update() below.
   */
  updateById: async (
    id: string | Types.ObjectId,
    patch: Partial<User>,
  ): Promise<User | null> => UserModel.findByIdAndUpdate(id, patch, { new: true }).lean<User>(),

  /**
   * update — string-id convenience wrapper over updateById.
   * Kept because most services hold ids as strings; the two names make the
   * accepted id type explicit at the call site.
   */
  update: async (id: string, patch: Partial<NewUser>): Promise<User | null> =>
    authRepository.updateById(id, patch),

  /** One page of users matching `where`, newest first, plus the total count. */
  findPage: async (
    where: Record<string, unknown>,
    skip: number,
    limit: number,
  ): Promise<[User[], number]> =>
    Promise.all([
      UserModel.find(where).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<User[]>(),
      UserModel.countDocuments(where),
    ]),

  /** Ids of every ACTIVE user holding a role (role-wide notifications). */
  findActiveIdsByRole: async (role: string): Promise<string[]> =>
    (await UserModel.find({ role, status: "active" }).select({ _id: 1 }).lean<{ _id: Types.ObjectId }[]>()).map(
      (u) => String(u._id),
    ),

  /** Name and role for a set of users (no secrets selected). */
  findProfilesByIds: async (ids: string[]): Promise<Pick<User, "_id" | "name" | "role">[]> =>
    UserModel.find({ _id: { $in: ids } })
      .select({ name: 1, role: 1 })
      .lean<Pick<User, "_id" | "name" | "role">[]>(),

  /**
   * delete — hard-delete a user. Rarely used (accounts are normally
   * "deactivated", not removed) but kept for cleanup tooling.
   */
  delete: async (id: string | Types.ObjectId): Promise<void> => {
    await UserModel.findByIdAndDelete(id);
  },

  // -------------------------------------------------------------------------
  // OTP data access
  // -------------------------------------------------------------------------

  /**
   * createOtp — persist a fresh OTP row.
   * HOW IT WORKS: inserts a NewOtpCode (codeHash, purpose, expiresAt,
   * attempts = 0). The plaintext code is never passed here — only its hash —
   * so the database layer literally cannot store the secret.
   */
  createOtp: async (data: NewOtpCode): Promise<OtpCode> => {
    const doc = await OtpCodeModel.create(data);
    return doc.toObject() as OtpCode;
  },

  /**
   * findValidOtp — the one code a user may still redeem for a purpose.
   * HOW IT WORKS: the query filters four conditions at once:
   *   - userId, purpose          → the right code for the right reason
   *   - consumedAt: null         → not yet used (single-use)
   *   - expiresAt: { $gt: now }  → not expired (the TTL index may not have
   *                                swept it yet, so we must filter too)
   *   - attempts: { $lt: 5 }     → not burnt out by wrong guesses
   * and `.sort({ createdAt: -1 })` picks the MOST RECENT of any survivors, so
   * a resend that left an old row behind cannot shadow the new code.
   */
  findValidOtp: async (
    userId: string | Types.ObjectId,
    purpose: OtpPurpose,
  ): Promise<OtpCode | null> =>
    OtpCodeModel.findOne({
      userId,
      purpose,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 },
    })
      .sort({ createdAt: -1 })
      .lean<OtpCode>(),

  /**
   * markOtpConsumed — burn a code so it can never be reused.
   * HOW IT WORKS: sets `consumedAt` to now. A consumed code fails the
   * `consumedAt: null` filter in findValidOtp, so replaying the same code is
   * rejected even if the attacker still knows the digits.
   */
  markOtpConsumed: async (otpId: string | Types.ObjectId): Promise<void> => {
    await OtpCodeModel.findByIdAndUpdate(otpId, { consumedAt: new Date() });
  },

  /**
   * incrementOtpAttempts — count a wrong guess against a code.
   * HOW IT WORKS: `$inc` atomically adds 1 to `attempts` (no read-modify-write
   * race) and returns the updated row. The caller reads `.attempts` from the
   * result to decide whether the limit was crossed — the repository just
   * increments; it does not enforce policy.
   */
  incrementOtpAttempts: async (
    otpId: string | Types.ObjectId,
  ): Promise<OtpCode | null> =>
    OtpCodeModel.findByIdAndUpdate(
      otpId,
      { $inc: { attempts: 1 } },
      { new: true },
    ).lean<OtpCode>(),

  /**
   * deleteActiveOtp — invalidate all live codes of one purpose.
   * HOW IT WORKS: `deleteMany` removes every UNCONSUMED code for this
   * user+purpose. Used by resend/forgot-password so that a new code replaces
   * the old one — only one active code per purpose can exist at a time.
   */
  deleteActiveOtp: async (
    userId: string | Types.ObjectId,
    purpose: OtpPurpose,
  ): Promise<void> => {
    await OtpCodeModel.deleteMany({ userId, purpose, consumedAt: null });
  },
};