import { describe, expect, it } from "vitest";

import { parsePageArgs } from "./pagination";

const params = (query: string) => new URLSearchParams(query);

describe("parsePageArgs", () => {
  it("defaults to the first page", () => {
    expect(parsePageArgs(params(""), 20)).toEqual({ first: 20, after: null });
  });

  it("uses `after` for the next page", () => {
    expect(parsePageArgs(params("after=eyJsYXN0X2lkIjoxfQ=="), 20)).toEqual({
      first: 20,
      after: "eyJsYXN0X2lkIjoxfQ==",
    });
  });

  it("uses `before` for the previous page", () => {
    expect(parsePageArgs(params("before=abc123"), 20)).toEqual({
      last: 20,
      before: "abc123",
    });
  });

  it("prefers `after` when both are present", () => {
    expect(parsePageArgs(params("after=a1&before=b2"), 20)).toEqual({
      first: 20,
      after: "a1",
    });
  });

  it("ignores malformed cursors and falls back to the first page", () => {
    expect(parsePageArgs(params('after=") { shop { name } }'), 20)).toEqual({
      first: 20,
      after: null,
    });
    expect(parsePageArgs(params(`before=${"a".repeat(600)}`), 20)).toEqual({
      first: 20,
      after: null,
    });
  });
});
