import { describe, expect, it } from "vitest";

import { parseDecision } from "./decision";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const base = {
  includeTitle: "true",
  title: "  Acme   Merino\nBeanie ",
  includeDescription: "true",
  includeTags: "true",
  description: "  A warm beanie.  ",
  tags: "hats, Wool, wool",
  tagMode: "ADD",
};

describe("parseDecision", () => {
  it("returns trimmed text and normalized tags", () => {
    expect(parseDecision(form(base))).toEqual({
      ok: true,
      decision: {
        title: "Acme Merino Beanie",
        description: "A warm beanie.",
        tags: ["hats", "Wool"],
        tagMode: "ADD",
      },
    });
  });

  it("uses null for fields the merchant chose not to publish", () => {
    const result = parseDecision(form({ ...base, includeTags: "false", includeTitle: "false" }));
    expect(result).toMatchObject({ ok: true, decision: { tags: null, title: null } });
  });

  it.each([
    ["nothing selected", { includeTitle: "false", includeDescription: "false", includeTags: "false" }],
    ["an empty title", { title: "  " }],
    ["a title that's too long", { title: "x".repeat(256) }],
    ["an empty description", { description: "   " }],
    ["an unknown tag mode", { tagMode: "MERGE" }],
    ["a tag that's too long", { tags: "x".repeat(41) }],
    ["a description that's too long", { description: "x".repeat(10_001) }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseDecision(form({ ...base, ...overrides })).ok).toBe(false);
  });
});
