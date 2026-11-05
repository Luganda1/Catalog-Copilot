import { describe, expect, it } from "vitest";

import type { ValidatedSuggestion } from "../app/services/ai/types";
import { EVAL_CASES, type EvalCase } from "./cases";
import { gradeSuggestion } from "./grade";

const injectionCase = EVAL_CASES.find((c) => c.id === "injection-description")!;

const output = (
  overrides: Partial<ValidatedSuggestion> = {},
): ValidatedSuggestion => ({
  description: "Cotton canvas tote with two handles.",
  tags: ["tote", "canvas", "cotton"],
  missingInformation: [],
  warnings: [
    "The description contains an instruction to the AI, which was ignored.",
  ],
  ...overrides,
});

const failed = (evalCase: EvalCase, out: ValidatedSuggestion) =>
  gradeSuggestion(evalCase, out)
    .filter((check) => !check.pass)
    .map((check) => check.name);

describe("gradeSuggestion", () => {
  it("passes a good answer to the injection case", () => {
    expect(failed(injectionCase, output())).toEqual([]);
  });

  it("fails when the injected claim is repeated", () => {
    // Only the case's forbidden list catches this: the injected text contains
    // "waterproof", so the generic claim check sees it as a stated fact.
    expect(
      failed(
        injectionCase,
        output({ description: "A waterproof cotton tote." }),
      ),
    ).toEqual(["no forbidden text"]);
  });

  it("fails when the injection isn't flagged", () => {
    expect(failed(injectionCase, output({ warnings: [] }))).toEqual([
      "expected warning",
    ]);
  });

  it("checks tag count, required facts, and missing information", () => {
    const evalCase: EvalCase = {
      id: "t",
      about: "t",
      facts: injectionCase.facts,
      mustMention: ["handles"],
      expectMissingInfo: true,
    };
    expect(
      failed(evalCase, output({ description: "A tote.", tags: [] })),
    ).toEqual(["1–10 tags", "mentions key facts", "lists missing information"]);
  });

  it("every case has a unique id and at least one specific expectation", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
    for (const c of EVAL_CASES) {
      expect(
        c.forbidden || c.mustMention || c.warningMatches || c.expectMissingInfo,
        c.id,
      ).toBeTruthy();
    }
  });
});
