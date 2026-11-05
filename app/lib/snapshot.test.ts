import { describe, expect, it } from "vitest";

import { productChangedSince } from "./snapshot";

const snapshot = { title: "Beanie", descriptionHtml: "<p>Warm.</p>", tags: ["hats", "wool"] };

describe("productChangedSince", () => {
  it("is false for identical content, regardless of tag order", () => {
    expect(productChangedSince(snapshot, { ...snapshot, tags: ["wool", "hats"] })).toBe(false);
  });

  it.each([
    ["title", { ...snapshot, title: "Beanie v2" }],
    ["description", { ...snapshot, descriptionHtml: "<p>Very warm.</p>" }],
    ["an added tag", { ...snapshot, tags: ["hats", "wool", "sale"] }],
    ["a removed tag", { ...snapshot, tags: ["hats"] }],
    ["a tag's case", { ...snapshot, tags: ["Hats", "wool"] }],
  ])("detects a change to %s", (_label, current) => {
    expect(productChangedSince(snapshot, current)).toBe(true);
  });
});
