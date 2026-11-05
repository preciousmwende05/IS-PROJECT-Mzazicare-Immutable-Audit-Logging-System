import type { AuthUser } from "@/shared/types";

declare global {
  namespace Express {
    interface Request {
      /** Set by auth.middleware. Trustworthy — the token was verified. */
      user?: AuthUser;
      /** Correlation id set by logger.middleware, echoed into audit entries. */
      requestId: string;
    }
  }
}

export {};
