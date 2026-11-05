import { randomUUID } from "node:crypto";
import path from "node:path";

import { Client } from "minio";

import logger from "@/shared/config/logger";
import { storageConfig, DEFAULT_SIGNED_URL_TTL_SECONDS } from "@/shared/config/storage";

export interface StoredFile {
  key: string;
  contentType: string;
  sizeBytes: number;
}

export interface StoredObject extends StoredFile {
  lastModified: Date;
}

export interface StorageService {
  /** Creates the bucket if it is missing. Called once at boot. */
  ensureBucket(): Promise<void>;
  /** `folder` segregates by sensitivity — "kyc", "visit-photos", "elder-photos". */
  put(folder: string, filename: string, buffer: Buffer, contentType: string): Promise<StoredFile>;
  /** Short-lived download URL. This is the ONLY way a client reads a file. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Short-lived upload URL, so large files skip the API entirely. */
  signedUploadUrl(
    folder: string,
    filename: string,
    expiresInSeconds?: number,
  ): Promise<{ key: string; url: string }>;
  exists(key: string): Promise<boolean>;
  /** Size and content type of a stored object, or null if it does not exist. */
  stat(key: string): Promise<StoredObject | null>;
  /** Every object under `prefix`, streamed page by page from the bucket. */
  list(prefix: string): AsyncIterable<{ key: string; sizeBytes: number; lastModified: Date }>;
  remove(key: string): Promise<void>;
}

let client: Client | null = null;
let signingClient: Client | null = null;

function getClient(): Client {
  if (!client) {
    client = new Client({
      endPoint: storageConfig.endPoint,
      port: storageConfig.port,
      useSSL: storageConfig.useSSL,
      accessKey: storageConfig.accessKey,
      secretKey: storageConfig.secretKey,
      region: storageConfig.region,
    });
  }
  return client;
}

/**
 * A presigned URL is signed against a specific host, so it must be signed
 * against the host the *browser* will use. Inside docker the API reaches
 * RustFS at `rustfs:9000`, which does not resolve on the user's machine —
 * RUSTFS_PUBLIC_URL (e.g. http://localhost:9000) fixes that.
 */
function getSigningClient(): Client {
  if (!storageConfig.publicUrl) return getClient();

  if (!signingClient) {
    const url = new URL(storageConfig.publicUrl);
    signingClient = new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      useSSL: url.protocol === "https:",
      accessKey: storageConfig.accessKey,
      secretKey: storageConfig.secretKey,
      region: storageConfig.region,
    });
  }
  return signingClient;
}

/** Strips directory traversal and spaces out of a client-supplied filename. */
function safeKey(folder: string, filename: string): string {
  const base = path.basename(filename).replace(/[^\w.-]/g, "_");
  return `${folder}/${randomUUID()}-${base}`;
}

export const storageService: StorageService = {
  ensureBucket: async () => {
    const c = getClient();
    if (await c.bucketExists(storageConfig.bucket)) {
      logger.info(`[storage] bucket "${storageConfig.bucket}" ready`);
      return;
    }
    await c.makeBucket(storageConfig.bucket, storageConfig.region);
    logger.info(`[storage] bucket "${storageConfig.bucket}" created`);
    // Left private on purpose. Every read goes through a presigned URL —
    // KYC documents and photos of people in their homes are never public.
  },

  put: async (folder, filename, buffer, contentType) => {
    const key = safeKey(folder, filename);
    await getClient().putObject(storageConfig.bucket, key, buffer, buffer.length, {
      "Content-Type": contentType,
    });
    logger.info(`[storage] uploaded ${key} (${buffer.length} bytes)`);
    return { key, contentType, sizeBytes: buffer.length };
  },

  signedUrl: async (key, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) =>
    getSigningClient().presignedGetObject(storageConfig.bucket, key, expiresInSeconds),

  signedUploadUrl: async (folder, filename, expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) => {
    const key = safeKey(folder, filename);
    const url = await getSigningClient().presignedPutObject(
      storageConfig.bucket,
      key,
      expiresInSeconds,
    );
    return { key, url };
  },

  exists: async (key) => {
    try {
      await getClient().statObject(storageConfig.bucket, key);
      return true;
    } catch {
      return false;
    }
  },

  stat: async (key) => {
    try {
      const info = await getClient().statObject(storageConfig.bucket, key);
      const contentType = String(info.metaData?.["content-type"] ?? "application/octet-stream");
      return { key, contentType, sizeBytes: info.size, lastModified: info.lastModified };
    } catch {
      return null;
    }
  },

  list: async function* (prefix) {
    for await (const item of getClient().listObjectsV2(storageConfig.bucket, prefix, true)) {
      if (item.name) yield { key: item.name, sizeBytes: item.size, lastModified: item.lastModified };
    }
  },

  remove: async (key) => {
    await getClient().removeObject(storageConfig.bucket, key);
    logger.info(`[storage] removed ${key}`);
  },
};