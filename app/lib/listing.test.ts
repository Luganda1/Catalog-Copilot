import { describe, expect, it } from "vitest";

import { assessListing, hasText, needsAttention } from "./listing";

describe("hasText", () => {
  it.each([
    [null, false],
    [undefined, false],
    ["", false],
    ["   \n\t", false],
    ["  ", false], // non-breaking spaces from rich-text editors
    ["&nbsp; &nbsp;", false],
    ["Warm jacket", true],
  ])("hasText(%j) → %s", (value, expected) => {
    expect(hasText(value)).toBe(expected);
  });
});

describe("assessListing", () => {
  it("flags an empty description and empty tags", () => {
    expect(assessListing({ description: "", tags: [] })).toEqual({
      missingDescription: true,
      missingTags: true,
    });
  });

  it("treats whitespace-only tags as missing", () => {
    expect(assessListing({ description: "x", tags: [" ", ""] }).missingTags).toBe(true);
  });

  it("passes a complete listing", () => {
    const health = assessListing({
      description: "Heated jacket with three heat settings.",
      tags: ["outerwear"],
    });
    expect(health).toEqual({ missingDescription: false, missingTags: false });
    expect(needsAttention(health)).toBe(false);
  });

  it("needsAttention is true when either field is missing", () => {
    expect(needsAttention({ missingDescription: true, missingTags: false })).toBe(true);
    expect(needsAttention({ missingDescription: false, missingTags: true })).toBe(true);
  });
});
