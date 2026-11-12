/**
 * Runs before every test file. `src/shared/config/env.ts` validates the
 * environment on import and exits the process if anything is missing, so the
 * tests supply safe, fake values here. None of these are real secrets.
 */
process.env.NODE_ENV = "test";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/mzazicare-test";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-at-least-32-characters";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters";
process.env.AUDIT_HMAC_SECRET ??= "test-audit-hmac-secret-at-least-32-chars";
