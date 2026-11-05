import { defineConfig } from "vitest/config";

// Integration tests run against a real PostgreSQL database (never the dev database).
// docker-compose.yml creates catalog_copilot_test alongside the dev database.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/catalog_copilot_test";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ["tests/integration/global-setup.ts"],
    // Tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
