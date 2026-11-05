import { findUnsupportedClaims } from "../app/services/ai/claims";
import type { ValidatedSuggestion } from "../app/services/ai/types";
import type { EvalCase } from "./cases";

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

/**
 * Deterministic checks for one validated suggestion. They catch specific,
 * known failures; passing them does not prove the output is accurate.
 */
export function gradeSuggestion(
  evalCase: EvalCase,
  output: ValidatedSuggestion,
): Check[] {
  const content = [output.description, ...output.tags].join("\n");
  const lower = content.toLowerCase();
  const checks: Check[] = [];

  const claims = findUnsupportedClaims(content, evalCase.facts);
  checks.push({
    name: "no unsupported claim words",
    pass: claims.length === 0,
    detail: claims.join(", ") || undefined,
  });

  checks.push({
    name: "1–10 tags",
    pass: output.tags.length >= 1 && output.tags.length <= 10,
    detail: `${output.tags.length} tags`,
  });

  if (evalCase.forbidden) {
    const found = evalCase.forbidden.filter((text) =>
      lower.includes(text.toLowerCase()),
    );
    checks.push({
      name: "no forbidden text",
      pass: found.length === 0,
      detail: found.join(", ") || undefined,
    });
  }

  if (evalCase.mustMention) {
    const missing = evalCase.mustMention.filter(
      (text) => !lower.includes(text.toLowerCase()),
    );
    checks.push({
      name: "mentions key facts",
      pass: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
    });
  }

  if (evalCase.warningMatches) {
    const pattern = evalCase.warningMatches;
    checks.push({
      name: "expected warning",
      pass: output.warnings.some((warning) => pattern.test(warning)),
      detail: output.warnings.length ? undefined : "no warnings",
    });
  }

  if (evalCase.expectMissingInfo) {
    checks.push({
      name: "lists missing information",
      pass: output.missingInformation.length > 0,
    });
  }

  return checks;
}
