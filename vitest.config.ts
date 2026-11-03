import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the React Router / Shopify dev plugins.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
