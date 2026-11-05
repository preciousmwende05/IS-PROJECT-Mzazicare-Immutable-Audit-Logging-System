/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * The HTTP wiring for the module. Each route declares:
 *   the path + verb, the middleware chain, and the final controller.
 *
 * MIDDLEWARE ORDER IS ALWAYS:
 *   authMiddleware → requireRole/requirePermission → validate → audit → controller
 *
 * Reading a route left to right tells you the whole story of the endpoint:
 *   - does it need a valid token?            (authMiddleware)
 *   - does it need a role/permission?        (requireRole / requirePermission)
 *   - what shape must the body/params have?  (validate)
 *   - is the outcome recorded for compliance?(audit)
 *   - what runs last?                        (the controller)
 *
 * Credential routes (register/verify-phone/resend/login/refresh/forgot/
 * reset) additionally carry `authRateLimit`: 10 tries per 15 minutes, and
 * SUCCESSFUL requests don't count — a user who fat-fingers a password is not
 * locked out by the limiter, but a brute-force script is.
 */

import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requireRole } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit, auditFailure } from "@/shared/middleware/audit.middleware";
import { authRateLimit } from "@/shared/middleware/rate-limit.middleware";
import { authController } from "@/modules/auth-service/controllers/auth.controller";
import { authValidation } from "@/modules/auth-service/validation/auth.validation";

export const authRoutes = Router();

// POST /register — public + rate-limited. Creates a pending account, SMS OTP.
// No authMiddleware: the account does not exist yet. `audit` records the
// phone (not the password) for compliance.
authRoutes.post(
  "/register",
  authRateLimit,
  validate(authValidation.register),
  audit("auth.register", (req) => ({ phone: req.body.phone })),
  authController.register,
);

// POST /verify-phone — public + rate-limited. Redeems the OTP, activates the
// account, issues the first token pair. This is the moment an unverified
// account becomes usable, so it is audited.
authRoutes.post(
  "/verify-phone",
  authRateLimit,
  validate(authValidation.verifyPhone),
  audit("auth.verify_phone", (req) => ({ phone: req.body.phone })),
  authController.verifyPhone,
);

// POST /resend-otp — public + rate-limited. Sends a fresh code. Not audited:
// it changes nothing of record (the OTP row is ephemeral).
authRoutes.post(
  "/resend-otp",
  authRateLimit,
  validate(authValidation.resendOtp),
  authController.resendOtp,
);

// POST /login — public + rate-limited. Verifies credentials, returns tokens.
// Audited so login history exists (with the phone, never the password).
// auditFailure runs FIRST so every refused attempt is recorded, including
// rate-limited ones: that is the credential-stuffing signal.
authRoutes.post(
  "/login",
  auditFailure("auth.login.failed", (req) => ({ phone: req.body?.phone })),
  authRateLimit,
  validate(authValidation.login),
  audit("user.logged_in", (req) => ({ phone: req.body.phone })),
  authController.login,
);

// POST /refresh — public + rate-limited. The refresh TOKEN is the credential
// here, so there is no authMiddleware — the token itself is verified inside
// the service. Rate-limited because a stolen refresh token is worth
// brute-forcing if it ever became guessable.
authRoutes.post("/refresh", authRateLimit, validate(authValidation.refresh), authController.refresh);

// POST /logout — requires a valid access token. Blacklists the presented
// refresh token. 204 on success.
authRoutes.post("/logout", authMiddleware, validate(authValidation.logout), authController.logout);

// GET /me — requires a valid access token. Returns the current profile. No
// validation or audit needed: it is a pure read of the token's identity.
authRoutes.get("/me", authMiddleware, authController.getMe);

// PATCH /me — requires a valid access token. Updates name/email. Audited so
// profile changes are attributable.
authRoutes.patch(
  "/me",
  authMiddleware,
  validate(authValidation.updateMe),
  audit("auth.profile_updated", (req) => ({ userId: req.user!.id })),
  authController.updateMe,
);

// POST /change-password — requires a valid access token. Audited — changing a
// credential is exactly the kind of event compliance wants on record.
authRoutes.post(
  "/change-password",
  authMiddleware,
  validate(authValidation.changePassword),
  audit("auth.password_changed", (req) => ({ userId: req.user!.id })),
  authController.changePassword,
);

// POST /forgot-password — public + rate-limited. Starts a reset; always
// answers 200. No audit: an unknown-phone attempt is not an event we record.
authRoutes.post(
  "/forgot-password",
  authRateLimit,
  validate(authValidation.forgotPassword),
  authController.forgotPassword,
);

// POST /reset-password — public + rate-limited. Completes a reset using the
// SMS code. Audited with the phone — a credential change, kept for compliance.
authRoutes.post(
  "/reset-password",
  authRateLimit,
  validate(authValidation.resetPassword),
  audit("auth.password_reset", (req) => ({ phone: req.body.phone })),
  authController.resetPassword,
);

// PATCH /users/:id/status — admin only (requireRole("admin")). Suspends,
// reinstates, deactivates or activates an account. Audited with both the
// target user and the new status: who did what to whom, and when.
authRoutes.patch(
  "/users/:id/status",
  authMiddleware,
  requireRole("admin"),
  validate(authValidation.updateStatus),
  audit(
    (req) => (req.body.status === "deactivated" ? "user.deactivated" : "user.status.changed"),
    (req) => ({ userId: req.params.id, status: req.body.status }),
  ),
  authController.updateStatus,
);

// GET /users — admin directory (Users & access page).
authRoutes.get(
  "/users",
  authMiddleware,
  requireRole("admin"),
  validate(authValidation.listUsers),
  authController.listUsers,
);

// PATCH /users/:id/role — admin changes a role. Audited as user.role.changed.
authRoutes.patch(
  "/users/:id/role",
  authMiddleware,
  requireRole("admin"),
  validate(authValidation.updateRole),
  audit("user.role.changed", (req) => ({ userId: req.params.id, role: req.body.role })),
  authController.updateRole,
);