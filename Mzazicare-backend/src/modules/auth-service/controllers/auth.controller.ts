/**
 * U-CS 67 — Secure User Registration & Authentication System
 * Owner(s): Stephen Nyariki, Cyril John Tike Sinari
 *
 * ============================================================================
 * WHAT THIS FILE IS
 * ============================================================================
 * Controllers are the THIN layer between HTTP and the domain. Each handler:
 *   1. reads what it needs from the request (body/params/user),
 *   2. calls ONE service method,
 *   3. shapes the reply through a serializer and a response util.
 *
 * There is NO database access, NO business rule, and NO res.status(4xx) here —
 * if a rule fails, the service THROWS an AppError and error.middleware turns
 * it into the right HTTP response. A long controller means logic has leaked
 * into the wrong layer.
 *
 * Every handler is wrapped in asyncHandler because Express 4 does not catch
 * rejected promises on its own — without it, an error would hang the request.
 */

import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, noContent, ok, paginated } from "@/shared/utils/response.util";
import { authService, type ListUsersQuery } from "@/modules/auth-service/services/auth.service";
import { serializeAuth, serializeUser } from "@/modules/auth-service/views/auth.view";

export const authController = {
  /**
   * register — POST /register.
   * Flow: validate middleware has already shaped req.body (phone normalised).
   * The service creates the pending user and SMS-sends an OTP; we answer 201
   * with the user view and NO tokens — tokens only arrive after verify-phone.
   */
  register: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.register(req.body);
    return created(res, serializeUser(user));
  }),

  /**
   * verifyPhone — POST /verify-phone.
   * Flow: the service checks the OTP, activates the account and issues the
   * first token pair. We serialize the user AND the tokens together via
   * serializeAuth so the frontend gets "who I am + my credentials" in one call.
   */
  verifyPhone: asyncHandler(async (req: Request, res: Response) => {
    const auth = await authService.verifyPhone(req.body.phone, req.body.code);
    return ok(res, serializeAuth(auth, auth.accessToken, auth.refreshToken));
  }),

  /**
   * resendOtp — POST /resend-otp.
   * Flow: the service silently does nothing for unknown phones. We ALWAYS
   * return the same 200 message either way — this is what prevents the
   * endpoint from being a phone-number oracle.
   */
  resendOtp: asyncHandler(async (req: Request, res: Response) => {
    await authService.resendOtp(req.body.phone, req.body.purpose);
    return ok(res, { message: "If that account exists, a code has been sent" });
  }),

  /**
   * login — POST /login.
   * Flow: service verifies credentials and returns a fresh token pair; we
   * serialize user + tokens. Any failure (bad credentials / locked / not
   * active) throws from the service and error.middleware picks the status.
   */
  login: asyncHandler(async (req: Request, res: Response) => {
    const auth = await authService.login(req.body);
    // No req.user on this route yet: tell the audit log who just signed in.
    res.locals.actorId = String(auth._id);
    res.locals.actorRole = auth.role;
    return ok(res, serializeAuth(auth, auth.accessToken, auth.refreshToken));
  }),

  /**
   * refresh — POST /refresh.
   * Flow: the service rotates the presented refresh token into a new pair.
   * The request is NOT behind authMiddleware — the token itself is the
   * credential, and it is verified inside the service.
   */
  refresh: asyncHandler(async (req: Request, res: Response) => {
    const auth = await authService.refresh(req.body.refreshToken);
    return ok(res, serializeAuth(auth, auth.accessToken, auth.refreshToken));
  }),

  /**
   * logout — POST /logout.
   * Flow: requires authMiddleware (req.user! is the verified identity). The
   * service blacklists the presented refresh token, then we answer 204 No
   * Content — nothing to return to a client that is going away.
   */
  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(req.body.refreshToken, req.user!.id);
    return noContent(res);
  }),

  /**
   * getMe — GET /me.
   * Flow: reads the caller's id from the verified access token (req.user.id —
   * trustworthy, never from the body) and returns the profile view.
   */
  getMe: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.getMe(req.user!.id);
    return ok(res, serializeUser(user));
  }),

  /**
   * updateMe — PATCH /me.
   * Flow: the service patches only the fields the caller actually sent; we
   * return the refreshed profile. Identity (id) comes from the token, NOT
   * from the body — a caller can only ever edit themselves.
   */
  updateMe: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.updateMe(req.user!.id, req.body);
    return ok(res, serializeUser(user));
  }),

  /**
   * changePassword — POST /change-password.
   * Flow: the service verifies the current password, writes the new one and
   * logs out all other sessions. 204 is right here — no data to return.
   */
  changePassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    return noContent(res);
  }),

  /**
   * forgotPassword — POST /forgot-password.
   * Flow: always answers the same generic message regardless of whether the
   * phone exists — the "send a code if you can" work happens silently inside
   * the service. The uniform reply is the anti-enumeration guarantee.
   */
  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.forgotPassword(req.body.phone);
    return ok(res, { message: "If that account exists, a reset code has been sent" });
  }),

  /**
   * resetPassword — POST /reset-password.
   * Flow: service validates the SMS code, writes the new password and revokes
   * every session. The success message is deliberately vague ("has been
   * reset") rather than echoing details.
   */
  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.resetPassword(req.body.phone, req.body.code, req.body.newPassword);
    return ok(res, { message: "Password has been reset" });
  }),

  /**
   * updateStatus — PATCH /users/:id/status (admin only).
   * Flow: the route guard (requireRole("admin")) already ran before us. The id
   * comes from the URL params (validated as an ObjectId); the service applies
   * the status change and revokes sessions when suspending. We return the
   * updated user.
   */
  updateStatus: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.updateStatus(req.params.id!, req.body.status, req.user!.id);
    return ok(res, serializeUser(user));
  }),

  /** GET /users — admin directory. */
  listUsers: asyncHandler(async (req: Request, res: Response) => {
    const page = await authService.listUsers(req.query as unknown as ListUsersQuery);
    return paginated(res, { ...page, items: page.items.map(serializeUser) });
  }),

  /** PATCH /users/:id/role — admin changes a role. */
  updateRole: asyncHandler(async (req: Request, res: Response) => {
    const user = await authService.updateRole(req.params.id!, req.body.role, req.user!.id);
    return ok(res, serializeUser(user));
  }),
};