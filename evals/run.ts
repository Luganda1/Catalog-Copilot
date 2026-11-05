/**
 * Runs the eval set against the configured AI provider (AI_PROVIDER in .env).
 * Calls the real model and uses API quota. Usage: npm run eval [-- case-id ...]
 *
 * Grades the model's own output (after schema validation, before the app adds
 * its claim warning), so the score reflects the prompt and model.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { getAiProvider } from "../app/services/ai/index.server";
import { validateSuggestionOutput } from "../app/services/ai/schema";
import { PROMPT_VERSION } from "../app/services/ai/prompt";
import { AiError } from "../app/services/ai/types";
import { EVAL_CASES } from "./cases";
import { gradeSuggestion, type Check } from "./grade";

// Groq's free tier allows about 8K tokens a minute; one case uses roughly 2–3K.
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 20_000);
const RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (existsSync(".env")) process.loadEnvFile(".env");

const only = process.argv.slice(2);
const cases = only.length
  ? EVAL_CASES.filter((c) => only.includes(c.id))
  : EVAL_CASES;

const provider = getAiProvider();
console.log(
  `Provider: ${provider.name} · prompt ${PROMPT_VERSION} · ${cases.length} cases\n`,
);
if (provider.name === "mock") {
  console.log("MOCK provider: these results don't measure a language model.\n");
}

const results: {
  id: string;
  model?: string;
  checks: Check[];
  error?: string;
  output?: unknown;
}[] = [];

for (const [index, evalCase] of cases.entries()) {
  if (index > 0 && provider.name !== "mock") await sleep(DELAY_MS);

  let result: (typeof results)[number] | undefined;
  for (let attempt = 0; attempt <= RETRIES && !result; attempt++) {
    try {
      const { raw, model } = await provider.generate(evalCase.facts);
      const output = validateSuggestionOutput(raw);
      result = {
        id: evalCase.id,
        model,
        checks: gradeSuggestion(evalCase, output),
        output,
      };
    } catch (error) {
      const code = error instanceof AiError ? error.code : "error";
      // Rate limits and outages are retried; anything else is a result.
      if (code === "provider_error" && attempt < RETRIES) {
        await sleep(60_000);
        continue;
      }
      result = {
        id: evalCase.id,
        checks: [{ name: "valid output", pass: false, detail: code }],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  results.push(result!);
  const failed = result!.checks.filter((check) => !check.pass);
  console.log(
    `${failed.length ? "FAIL" : "pass"}  ${evalCase.id}  (${evalCase.about})`,
  );
  for (const check of failed) {
    console.log(
      `        ✗ ${check.name}${check.detail ? `: ${check.detail}` : ""}`,
    );
  }
}

const allChecks = results.flatMap((r) => r.checks);
const passedCases = results.filter((r) => r.checks.every((c) => c.pass)).length;
console.log(
  `\n${passedCases}/${results.length} cases passed · ${allChecks.filter((c) => c.pass).length}/${allChecks.length} checks passed`,
);

mkdirSync("evals/results", { recursive: true });
const file = `evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(
  file,
  JSON.stringify(
    { provider: provider.name, promptVersion: PROMPT_VERSION, results },
    null,
    2,
  ),
);
console.log(`Full outputs: ${file}`);

process.exitCode = passedCases === results.length ? 0 : 1;
