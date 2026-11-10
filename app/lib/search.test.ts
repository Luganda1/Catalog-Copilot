import { describe, expect, it } from "vitest";

import {
  MAX_SEARCH_LENGTH,
  parseSearch,
  titleMatches,
  titleSearchQuery,
} from "./search";

const params = (query: string) => new URLSearchParams(query);

describe("parseSearch", () => {
  it("is empty when there's no search", () => {
    expect(parseSearch(params(""))).toBe("");
  });

  it("trims and collapses whitespace", () => {
    expect(parseSearch(params("q=%20%20blue%20%20%20shirt%20"))).toBe(
      "blue shirt",
    );
  });

  it("caps the length", () => {
    expect(parseSearch(params(`q=${"a".repeat(500)}`))).toHaveLength(
      MAX_SEARCH_LENGTH,
    );
  });
});

describe("titleSearchQuery", () => {
  it("matches each word as a title prefix", () => {
    expect(titleSearchQuery("Blue sh")).toBe("title:blue* AND title:sh*");
  });

  it("drops punctuation and search operators", () => {
    expect(titleSearchQuery('shirt") OR status:archived')).toBe(
      "title:shirt* AND title:or* AND title:statusarchived*",
    );
  });

  it("returns null when nothing searchable is left", () => {
    expect(titleSearchQuery("")).toBeNull();
    expect(titleSearchQuery("*** ::")).toBeNull();
  });
});

describe("titleMatches", () => {
  it("matches every word against the start of a title word", () => {
    expect(titleMatches("Classic Blue T-Shirt", "blue sh")).toBe(true);
    expect(titleMatches("Classic Blue T-Shirt", "lue")).toBe(false);
    expect(titleMatches("Classic Blue T-Shirt", "blue hat")).toBe(false);
  });

  it("matches everything when the search is empty", () => {
    expect(titleMatches("Anything", "")).toBe(true);
  });
});
