import rateLimit from "express-rate-limit";

const envelope = (message: string) => ({
  success: false,
  error: { code: "RATE_LIMITED", message },
});

/** Baseline, applied to the whole API in app.ts. */
export const rateLimitMiddleware = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: envelope("Too many requests"),
});

/** Tighter, for credential endpoints — auth-service mounts this on login/OTP. */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: envelope("Too many attempts, try again later"),
});

/**
 * Emergency endpoints are deliberately loose — a panic button pressed
 * repeatedly must still get through.
 */
export const emergencyRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: envelope("Too many requests"),
});
