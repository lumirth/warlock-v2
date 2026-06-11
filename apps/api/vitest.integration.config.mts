import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2024-01-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          kvNamespaces: ["GPA_CACHE", "SEARCH_CACHE"],
          ratelimits: {
            SEARCH_RATE_LIMITER: { simple: { limit: 120, period: 60 } },
            COURSE_RATE_LIMITER: { simple: { limit: 240, period: 60 } },
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            CURRENT_YEAR: "2026",
            CURRENT_TERM: "spring",
            CISAPI_BASE: "https://courses.illinois.edu/cisapp/explorer/catalog",
            FRONTEND_BASE: "http://localhost:5173",
            SYNC_CONCURRENCY: "1",
            BACKOFF_BASE_MS: "1000",
            BACKOFF_MAX_MS: "1000",
            MAX_RETRIES: "1",
            CLIENT_CACHE_TTL_MS: "300000",
            ADMIN_TOKEN: "admin-token",
            INTERNAL_TOKEN: "internal-token",
          },
        },
      }),
    ],
    test: {
      include: ["src/**/*.integration.test.ts"],
      setupFiles: ["./src/test-support/apply-d1-migrations.ts"],
    },
  };
});
