import { describe, expect, it } from "vitest";

import { validateSuggestionOutput } from "./schema";
import { AiError } from "./types";

const valid = {
  description: "A heated jacket with three heat settings.\n\nIncludes a power bank.",
  tags: ["heated jacket", "outerwear", "Outerwear"],
  missingInformation: ["Battery runtime is not stated."],
  warnings: [],
};

function expectInvalid(raw: unknown) {
  try {
    validateSuggestionOutput(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).code).toBe("invalid_output");
    return;
  }
  throw new Error("Expected validation to fail");
}

describe("validateSuggestionOutput", () => {
  it("accepts valid output and de-duplicates tags", () => {
    expect(validateSuggestionOutput(valid).tags).toEqual(["heated jacket", "outerwear"]);
  });

  it.each([
    ["null", null],
    ["a string", "Here is your description"],
    ["an array", [valid]],
    ["missing description", { ...valid, description: undefined }],
    ["missing warnings", { tags: [], missingInformation: [], description: "x" }],
    ["empty description", { ...valid, description: "   " }],
    ["non-string description", { ...valid, description: 42 }],
    ["HTML in description", { ...valid, description: "<p>Warm</p>" }],
    ["script in description", { ...valid, description: "Nice <script>alert(1)</script>" }],
    ["oversized description", { ...valid, description: "a".repeat(4001) }],
    ["tags not an array", { ...valid, tags: "outerwear, heated" }],
    ["non-string tag", { ...valid, tags: ["ok", 5] }],
    ["empty tag", { ...valid, tags: ["ok", " "] }],
    ["tag with a comma", { ...valid, tags: ["warm, cozy"] }],
    ["overlong tag", { ...valid, tags: ["x".repeat(41)] }],
    ["too many tags", { ...valid, tags: Array.from({ length: 16 }, (_, i) => `tag ${i}`) }],
    ["too many warnings", { ...valid, warnings: Array.from({ length: 11 }, (_, i) => `w${i}`) }],
    ["extra fields", { ...valid, publish: true }],
  ])("rejects %s", (_label, raw) => {
    expectInvalid(raw);
  });

  it("does not echo raw output in the merchant-facing message", () => {
    try {
      validateSuggestionOutput({ ...valid, description: "<img src=x onerror=alert(1)>" });
    } catch (error) {
      expect((error as AiError).userMessage).not.toContain("<img");
    }
  });
});
