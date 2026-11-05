import { env } from "@/shared/config/env";

/**
 * Object storage lives in RustFS, which speaks the S3 API. We talk to it
 * through the standard S3 client (the `minio` npm package is just an S3 SDK —
 * it works against any S3-compatible endpoint). Swapping to real S3 later
 * means changing these values, not the code.
 *
 * Prefixes inside the bucket segregate content by sensitivity:
 *   kyc/           caregiver identity documents  — coordinator only
 *   visit-photos/  photos attached to a report   — care circle only
 *   elder-photos/  profile pictures              — care circle only
 */
export const storageConfig = {
  endPoint: env.RUSTFS_ENDPOINT,
  port: env.RUSTFS_PORT,
  useSSL: env.RUSTFS_USE_SSL,
  accessKey: env.RUSTFS_ACCESS_KEY,
  secretKey: env.RUSTFS_SECRET_KEY,
  bucket: env.RUSTFS_BUCKET,
  region: env.RUSTFS_REGION,
  publicUrl: env.RUSTFS_PUBLIC_URL,
};

/** Default lifetime for a presigned URL. Deliberately short. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

/** KYC documents get the shortest window of all. */
export const KYC_SIGNED_URL_TTL_SECONDS = 120;