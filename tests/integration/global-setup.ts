import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/catalog_copilot_test";
  // Guard against wiping a real database by accident.
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(`Refusing to run integration tests against a database whose name doesn't end in _test: ${url}`);
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
