import "dotenv/config";
import { z } from "zod";

/**
 * The only file in the codebase that reads process.env. Everything else
 * imports `env` from here, so a missing variable fails at boot rather than on
 * the first request that happens to need it.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/v1"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  // How many reverse proxies (Caddy, a load balancer) sit in front of the API.
  // Express then reads the real client address from X-Forwarded-For, which the
  // rate limits and the audit log's `ip` field depend on. Leave it unset to get
  // 1 in production (Caddy) and 0 elsewhere. Never set it higher than the real
  // number of proxies: a client could then forge its own address.
  TRUST_PROXY: z.coerce.number().int().min(0).optional(),

  MONGODB_URI: z.string().min(1),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  RUSTFS_ENDPOINT: z.string().default("localhost"),
  RUSTFS_PORT: z.coerce.number().default(9000),
  // NOT z.coerce.boolean() — that turns the STRING "false" into true.
  RUSTFS_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  RUSTFS_ACCESS_KEY: z.string().default("rustfsadmin"),
  RUSTFS_SECRET_KEY: z.string().default("rustfsadmin"),
  RUSTFS_BUCKET: z.string().default("mzazicare"),
  RUSTFS_REGION: z.string().default("us-east-1"),
  // Set when the API and the browser reach RustFS at different addresses
  // (API talks to "rustfs:9000" inside docker, the browser needs localhost).
  RUSTFS_PUBLIC_URL: z.string().url().optional(),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // U-CS 78 — key that seals every audit entry (HMAC-SHA-256).
  // Required, no default: the app must refuse to start without it.
  // Never change it once entries exist, or every old seal will fail verification.
  AUDIT_HMAC_SECRET: z.string().min(32, "AUDIT_HMAC_SECRET must be at least 32 characters"),

  // Integrations — blank in development falls back to the console stubs.
  SMS_API_KEY: z.string().optional(),
  SMS_USERNAME: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  // Any SMTP provider (Gmail app password, Brevo, ...). Verification codes are
  // emailed when set; blank logs them instead (development).
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console -- the logger is not configured yet at this point
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(",").map((s) => s.trim()),
  trustProxy: parsed.data.TRUST_PROXY ?? (parsed.data.NODE_ENV === "production" ? 1 : 0),
};