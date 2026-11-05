/**
 * Services and controllers throw these. `error.middleware` is the only place
 * that turns one into an HTTP status — never call res.status(4xx) yourself.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, message, "BAD_REQUEST", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super(403, message, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, `${resource} not found`, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(409, message, "CONFLICT");
  }
}

export class UnprocessableError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(422, message, "VALIDATION_FAILED", details);
  }
}

/**
 * LockedError — HTTP 423.
 * Used by auth-service (U-CS 67) when a login attempt arrives for an account
 * whose `lockedUntil` is still in the future (after 5 consecutive failures).
 * "Lock, don't ban": the account recovers automatically when the lock window
 * passes, so a legitimate user is delayed, never destroyed.
 */
export class LockedError extends AppError {
  constructor(message = "Account temporarily locked") {
    super(423, message, "ACCOUNT_LOCKED");
  }
}
