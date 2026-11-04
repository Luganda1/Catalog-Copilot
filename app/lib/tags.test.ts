import { describe, expect, it } from "vitest";

import { normalizeTags, parseTagInput, planTagChange } from "./tags";

describe("normalizeTags", () => {
  it("trims, collapses spaces, and de-duplicates case-insensitively", () => {
    expect(normalizeTags([" Winter ", "winter", "heated  jacket", ""])).toEqual([
      "Winter",
      "heated jacket",
    ]);
  });
});

describe("parseTagInput", () => {
  it("splits merchant input on commas", () => {
    expect(parseTagInput("outerwear, heated,, Outerwear ")).toEqual(["outerwear", "heated"]);
  });
});

describe("planTagChange", () => {
  const existing = ["Sale", "outerwear"];

  it("ADD keeps existing tags and appends only new ones", () => {
    expect(planTagChange(existing, ["Outerwear", "heated"], "ADD")).toEqual({
      finalTags: ["Sale", "outerwear", "heated"],
      added: ["heated"],
      removed: [],
    });
  });

  it("REPLACE removes tags that aren't in the approved list", () => {
    expect(planTagChange(existing, ["outerwear", "heated"], "REPLACE")).toEqual({
      finalTags: ["outerwear", "heated"],
      added: ["heated"],
      removed: ["Sale"],
    });
  });

  it("REPLACE with an empty list removes everything", () => {
    expect(planTagChange(existing, [], "REPLACE").removed).toEqual(existing);
  });
});
