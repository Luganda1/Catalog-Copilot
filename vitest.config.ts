import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the React Router / Shopify dev plugins.
// Unit tests only; integration tests need PostgreSQL and use vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
    environment: "node",
  },
});
