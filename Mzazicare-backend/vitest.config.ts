import path from "node:path";
import type { UserConfig } from "vitest/config";

/**
 * Unit tests for the backend. They need no MongoDB, Redis or network:
 * anything that would open a connection is mocked inside the test file.
 *
 *   pnpm test            run once (what CI runs)
 *   pnpm test:watch      rerun on save
 *
 * Only a TYPE is imported from "vitest/config". This package is CommonJS, so
 * a value import would be loaded with require(), which fails on Node versions
 * before 22.12 because Vite is ESM only.
 */
const config: UserConfig = {
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/junit.xml" },
    restoreMocks: true,
  },
};

export default config;
