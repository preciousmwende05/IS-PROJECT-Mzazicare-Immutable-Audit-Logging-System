/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The ONLY place that knows how a User or an OtpCode looks in the database.
 * Mongoose schemas are the source of truth for the `users` and `otp_codes`
 * collections: what fields exist, what type each one is, which ones are
 * unique, which are indexed, and which have defaults.
 *
 * Think of this file as the "table definition" — services and repositories
 * never invent fields; they can only use the ones declared here.
 */

import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

// ---------------------------------------------------------------------------
// Enums as const tuples
// ---------------------------------------------------------------------------
// We declare each enum as an `as const` array AND derive a TypeScript type
// from it. Two reasons:
//   1. The array is reused in the schema (`enum: USER_ROLES`) so the database
//      validation and the TypeScript type can never drift apart.
//   2. `(typeof USER_ROLES)[number]` turns the array into the union type
//      "family" | "elder" | "caregiver" | "coordinator" | "admin".
// Change one place, and both the runtime schema and the compiler update.

export const USER_ROLES = ["family", "elder", "caregiver", "coordinator", "admin", "auditor"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = [
  "pending_verification", // just registered, phone not yet proven
  "active", // phone verified, can use the platform
  "suspended", // admin action — rejected on every request
  "deactivated", // user closed the account
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const OTP_PURPOSES = ["phone_verification", "password_reset", "login"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

// ---------------------------------------------------------------------------
// User schema  → collection `users`
// ---------------------------------------------------------------------------
const authSchema = new Schema(
  {
    // The real login identifier. Stored in E.164 form (+2547…). `unique: true`
    // creates a unique index so a duplicate phone is rejected by the database
    // as well as by our own service check. `trim` strips accidental whitespace.
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Optional email. Normalised (trimmed + lowercased) so "Ann@X.com " and
    // "ann@x.com" cannot create two accounts. Uniqueness is enforced by the
    // partial index declared below (only rows that HAVE a string email).
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
    },

    // The bcrypt hash (cost 12). `select: false` is the first line of defense:
    // Mongoose will NOT return this field in normal queries, so a careless
    // `findById` can never leak it. Only a deliberate `.select("+passwordHash")`
    // brings it back — the `+` prefix explicitly overrides the exclusion.
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Defaults to "family" — most registrations are families. Indexed because
    // admin screens filter by role.
    role: {
      type: String,
      enum: USER_ROLES,
      required: true,
      default: "family",
    },

    // The account lifecycle. New users start "pending_verification" and only
    // become "active" after the OTP is verified. Indexed because queries
    // filter on status often.
    status: {
      type: String,
      enum: USER_STATUSES,
      required: true,
      default: "pending_verification",
    },

    // Set when the phone OTP is verified. `default: null` keeps the field
    // present and typed — easier than "field may not exist".
    phoneVerifiedAt: {
      type: Date,
      default: null,
    },

    // Updated on every successful login. Useful for dashboards and "last seen".
    lastLoginAt: {
      type: Date,
      default: null,
    },

    // Brute-force protection. Every failed login increments this; it is reset
    // to 0 on success. Together with `lockedUntil` this implements
    // "lock, don't ban" (see auth.service login()).
    failedLoginAttempts: {
      type: Number,
      required: true,
      default: 0,
    },

    // When non-null and in the future, the account rejects logins with 423.
    // Set by auth.service after 5 consecutive failures.
    lockedUntil: {
      type: Date,
      default: null,
    },
  },
  // `timestamps: true` makes Mongoose maintain createdAt/updatedAt for us.
  // The collection name is explicit so renames never silently move data.
  { timestamps: true, collection: "users" },
);

// Index what you filter and sort on — the dashboard sorts new users by
// creation time.
authSchema.index({ createdAt: -1 });

// Email must be unique, but only among rows that HAVE an email. The partial
// filter expression is the equivalent of `sparse: true`: without it the unique
// index would treat every missing email as a duplicate of every other.
authSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { email: { $type: "string" } },
  },
);

// Status and role are frequent filter targets (admin screens, auth lookups).
authSchema.index({ status: 1 });
authSchema.index({ role: 1 });

export type User = InferSchemaType<typeof authSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

// NewUser is what you pass to create(). Timestamps are omitted because
// Mongoose sets them itself — Omit() enforces that at compile time.
export type NewUser = Omit<InferSchemaType<typeof authSchema>, "createdAt" | "updatedAt">;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model("User", authSchema);

// ---------------------------------------------------------------------------
// OtpCode schema  → collection `otp_codes`
// ---------------------------------------------------------------------------
const otpSchema = new Schema(
  {
    // Which user this code belongs to. `ref: "User"` enables populate().
    // Indexed because every lookup is by userId + purpose.
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // sha-256 of the 6-digit plaintext. We NEVER store the raw code: if the
    // database is leaked, an attacker gets hashes that cannot be used to log
    // in. This is a plain String hash — it is NOT one of OTP_PURPOSES.
    codeHash: {
      type: String,
      required: true,
    },

    // Why this code exists. A phone_verification code cannot be used to
    // reset a password, even if an attacker obtains it.
    purpose: {
      type: String,
      enum: OTP_PURPOSES,
      required: true,
    },

    // When the code stops being valid. The TTL index below lets Mongo delete
    // the row automatically once this moment passes.
    expiresAt: {
      type: Date,
      required: true,
    },

    // Single-use marker. Set once the code is successfully redeemed; a
    // consumed code can never be replayed.
    consumedAt: {
      type: Date,
      default: null,
    },

    // How many wrong guesses were made against this code. At 5 the code is
    // consumed (burnt) to stop brute-forcing the remaining guesses.
    attempts: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true, collection: "otp_codes" },
);

// TTL index: Mongo automatically deletes a document once `expiresAt` passes.
// `expireAfterSeconds: 0` means "delete exactly at expiresAt". This is the
// cleanup you would otherwise have to schedule by hand.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Supporting index for the "find the current code for this user+purpose" query.
otpSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

export type OtpCode = InferSchemaType<typeof otpSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

// Same Omit rationale as NewUser above.
export type NewOtpCode = Omit<InferSchemaType<typeof otpSchema>, "createdAt" | "updatedAt">;
export type OtpCodeDocument = HydratedDocument<OtpCode>;

export const OtpCodeModel = model<OtpCode>("OtpCode", otpSchema);