/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Request-shape validation. Every schema here answers ONE question:
 * "is this request well-formed?" (right types, right lengths, right enums).
 *
 * It deliberately does NOT answer business questions like "is this phone
 * already registered?" — that requires the database and lives in the service
 * layer. Separating the two keeps validation fast, side-effect-free, and
 * reusable.
 *
 * The `validate` middleware in shared/middleware parses these schemas against
 * the incoming request and REPLACES body/params/query with the parsed result,
 * so controllers receive typed, coerced, extras-stripped data.
 */

import { z } from "zod";
import { normalizeKenyanPhone } from "@/shared/utils/phone.util";
import { OTP_PURPOSES, USER_ROLES, USER_STATUSES } from "@/modules/auth-service/models/auth.model";

// ---------------------------------------------------------------------------
// Reusable field validators
// ---------------------------------------------------------------------------

// A MongoDB ObjectId is exactly 24 hex characters. Used for `:id` params so a
// malformed id fails here with a clean 422 instead of a 500 CastError later.
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

// The phone arrives in any Kenyan format (0712…, +254712…, 254712…, 712…).
// The `.transform()` runs normalizeKenyanPhone AFTER zod confirms it is a
// string, rewriting it into canonical E.164 (+254712…). The parsed `body.phone`
// the controller receives is therefore ALWAYS normalised — services can trust
// it and never re-normalise.
const phoneField = z.string().transform(normalizeKenyanPhone);

// OTP codes are exactly 6 digits. Anything else is rejected before it ever
// reaches the database.
const otpCode = z.string().regex(/^\d{6}$/, "Code must be 6 digits");

// Shared password policy: minimum 8, maximum 128. Using one `password` schema
// for register, change-password and reset-password means the policy lives in
// exactly one place.
const password = z.string().min(8, "Password must be at least 8 characters").max(128);

/**
 * Request-shape validation only — "is this well-formed?".
 * "Is this caregiver free on Tuesday?" is a service question, not this.
 */
export const authValidation = {
  // Generic single-id param guard, reused by any /:id route.
  byId: z.object({
    params: z.object({ id: objectId }),
  }),

  // POST /register — phone, name, password and an optional role.
  // `z.enum([...]).default("family")` restricts SELF-registration to the three
  // roles a person can claim. "coordinator"/"admin" are NOT in the list — a
  // user must never be able to register themselves as an admin; those roles
  // are granted by an admin via PATCH /users/:id/status.
  register: z.object({
    body: z.object({
      phone: phoneField,
      name: z.string().min(1, "Name is required").max(120),
      // Where the verification code is emailed. Optional for the API (SMS still
      // works when configured); the web app asks for it.
      email: z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
      password,
      role: z.enum(["family", "elder", "caregiver"]).default("family"),
    }),
  }),

  // POST /verify-phone — proves control of the phone by redeeming the OTP.
  verifyPhone: z.object({
    body: z.object({
      phone: phoneField,
      code: otpCode,
    }),
  }),

  // POST /resend-otp — a fresh code. `purpose` defaults to phone_verification
  // so a plain "resend" call works without the client knowing the enum.
  resendOtp: z.object({
    body: z.object({
      phone: phoneField,
      purpose: z.enum(OTP_PURPOSES).default("phone_verification"),
    }),
  }),

  // POST /login — phone + password. Only min(1) here: "wrong length" is the
  // service's business (it must return the same error for unknown phone vs
  // wrong password, so it cannot reject structurally here).
  login: z.object({
    body: z.object({
      phone: phoneField,
      password: z.string().min(1, "Password is required"),
    }),
  }),

  // POST /refresh — just the token string. Everything else (signature, jti
  // liveness, user status) is verified in the service.
  refresh: z.object({
    body: z.object({
      refreshToken: z.string().min(1, "refreshToken is required"),
    }),
  }),

  // POST /logout — same single field as refresh.
  logout: z.object({
    body: z.object({
      refreshToken: z.string().min(1, "refreshToken is required"),
    }),
  }),

  // PATCH /me — both fields optional so a client can update just one.
  updateMe: z.object({
    body: z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
    }),
  }),

  // POST /change-password — the CURRENT password is validated for presence
  // only; correctness is checked against the stored hash in the service.
  // The `.refine` additionally rejects a new password identical to the current
  // one at the shape level — a cheap UX guard before any bcrypt work.
  changePassword: z.object({
    body: z
      .object({
        currentPassword: z.string().min(1),
        newPassword: password,
      })
      .refine((data) => data.currentPassword !== data.newPassword, {
        message: "New password must be different from the current password",
        path: ["newPassword"],
      }),
  }),

  // POST /forgot-password — phone only. The endpoint deliberately reveals
  // nothing about whether the account exists.
  forgotPassword: z.object({
    body: z.object({
      phone: phoneField,
    }),
  }),

  // POST /reset-password — phone + code + new password.
  resetPassword: z.object({
    body: z.object({
      phone: phoneField,
      code: otpCode,
      newPassword: password,
    }),
  }),

  // PATCH /users/:id/status — an admin sets a new status. `params.id` is
  // validated as an ObjectId; `body.status` must be a real lifecycle state.
  updateStatus: z.object({
    params: z.object({ id: objectId }),
    body: z.object({
      status: z.enum(USER_STATUSES),
    }),
  }),

  // GET /users — admin directory: filter by role/status, search name or phone.
  listUsers: z.object({
    query: z.object({
      role: z.enum(USER_ROLES).optional(),
      status: z.enum(USER_STATUSES).optional(),
      q: z.string().trim().min(1).max(80).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),

  // PATCH /users/:id/role — an admin changes someone's role.
  updateRole: z.object({
    params: z.object({ id: objectId }),
    body: z.object({ role: z.enum(USER_ROLES) }),
  }),
};