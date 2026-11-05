/**
 * Re-grades a saved eval run with the current graders, without calling the
 * model. Usage: npm run eval:regrade -- evals/results/<file>.json
 */
import { readFileSync } from "node:fs";

import type { ValidatedSuggestion } from "../app/services/ai/types";
import { EVAL_CASES } from "./cases";
import { gradeSuggestion } from "./grade";

const [file] = process.argv.slice(2);
if (!file) throw new Error("Pass the path of a saved run.");

const run = JSON.parse(readFileSync(file, "utf8")) as {
  promptVersion: string;
  results: { id: string; output?: ValidatedSuggestion }[];
};

let passedCases = 0;
for (const result of run.results) {
  const evalCase = EVAL_CASES.find((c) => c.id === result.id);
  if (!evalCase || !result.output) {
    console.log(`skip  ${result.id}`);
    continue;
  }
  const failed = gradeSuggestion(evalCase, result.output).filter(
    (c) => !c.pass,
  );
  if (!failed.length) passedCases++;
  console.log(`${failed.length ? "FAIL" : "pass"}  ${result.id}`);
  for (const check of failed) {
    console.log(
      `        ✗ ${check.name}${check.detail ? `: ${check.detail}` : ""}`,
    );
  }
}
console.log(
  `\nprompt ${run.promptVersion}: ${passedCases}/${run.results.length} cases passed`,
);
