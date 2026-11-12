/**
 * The client address behind a reverse proxy. The audit log stores `req.ip`
 * on every entry and the rate limiters key on it, so it must be the real
 * client in production and must not be forgeable in development.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadEnv = async (vars: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value as string);
  for (const [key, value] of Object.entries(vars)) if (value === undefined) delete process.env[key];
  const { env } = await import("@/shared/config/env");
  return env;
};

const ipApp = (trustProxy: number) => {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  return app;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TRUST_PROXY resolution", () => {
  it("defaults to one hop (Caddy) in production", async () => {
    const env = await loadEnv({ NODE_ENV: "production", TRUST_PROXY: undefined });
    expect(env.trustProxy).toBe(1);
  });

  it("defaults to zero outside production, so the header cannot be forged", async () => {
    const env = await loadEnv({ NODE_ENV: "development", TRUST_PROXY: undefined });
    expect(env.trustProxy).toBe(0);
  });

  it("uses an explicit value when one is set", async () => {
    const env = await loadEnv({ NODE_ENV: "production", TRUST_PROXY: "2" });
    expect(env.trustProxy).toBe(2);
  });
});

describe("client address seen by the API", () => {
  it("behind one proxy, takes the client address the proxy forwarded", async () => {
    const res = await request(ipApp(1)).get("/ip").set("X-Forwarded-For", "41.90.64.10");
    expect(res.body.ip).toBe("41.90.64.10");
  });

  it("behind one proxy, ignores addresses a client prepended itself", async () => {
    // Caddy appends the real address, so a forged value ends up first.
    const res = await request(ipApp(1))
      .get("/ip")
      .set("X-Forwarded-For", "10.0.0.1, 41.90.64.10");
    expect(res.body.ip).toBe("41.90.64.10");
  });

  it("with no proxy trusted, ignores the header completely", async () => {
    const res = await request(ipApp(0)).get("/ip").set("X-Forwarded-For", "41.90.64.10");
    expect(res.body.ip).not.toBe("41.90.64.10");
  });
});

describe("app.ts", () => {
  it("applies the setting to the real app", () => {
    const source = readFileSync(path.resolve(__dirname, "../src/app.ts"), "utf8");
    expect(source).toMatch(/app\.set\(\s*"trust proxy"\s*,\s*env\.trustProxy\s*\)/);
  });
});
