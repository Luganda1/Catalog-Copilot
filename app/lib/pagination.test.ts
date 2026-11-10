import { describe, expect, it } from "vitest";

import { parsePageArgs, parsePageNumber, parsePageSize } from "./pagination";

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

describe("parsePageSize", () => {
  it("accepts the allowed sizes", () => {
    expect(parsePageSize(params("size=50"))).toBe(50);
    expect(parsePageSize(params("size=100"))).toBe(100);
  });

  it("falls back to 20 for missing or other values", () => {
    expect(parsePageSize(params(""))).toBe(20);
    expect(parsePageSize(params("size=250"))).toBe(20);
    expect(parsePageSize(params("size=abc"))).toBe(20);
  });
});

describe("parsePageNumber", () => {
  it("reads a positive whole page number", () => {
    expect(parsePageNumber(params("page=3"))).toBe(3);
  });

  it("falls back to page 1 for invalid values", () => {
    for (const value of ["", "0", "-2", "1.5", "x"]) {
      expect(parsePageNumber(params(`page=${value}`))).toBe(1);
    }
  });
});
