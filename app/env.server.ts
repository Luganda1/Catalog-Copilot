import fs from "node:fs";
import { parseEnv } from "node:util";

/**
 * In development, load server-only settings (AI_PROVIDER, ANTHROPIC_API_KEY, …)
 * from .env. Values already in the environment win, and empty values are ignored,
 * so this never overrides the Shopify credentials injected by `shopify app dev`.
 * In production, configure real environment variables instead.
 */
if (process.env.NODE_ENV !== "production" && fs.existsSync(".env")) {
  const values = parseEnv(fs.readFileSync(".env", "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (value && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
