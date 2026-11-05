import { describe, expect, it } from "vitest";

import { findUnsupportedClaims } from "./claims";
import type { ProductFacts } from "./types";

const facts = (overrides: Partial<ProductFacts> = {}): ProductFacts => ({
  title: "Heated Jacket",
  currentDescription: "Three heat settings.",
  productType: "Jacket",
  vendor: "Acme",
  tags: [],
  options: [],
  ...overrides,
});

describe("findUnsupportedClaims", () => {
  it("flags claim words that the facts don't contain", () => {
    expect(
      findUnsupportedClaims(
        "A durable, waterproof jacket for any season.",
        facts(),
      ),
    ).toEqual(["waterproof", "durable", "all-season"]);
  });

  it("allows claims that the facts state", () => {
    expect(
      findUnsupportedClaims(
        "Water-resistant shell.",
        facts({ currentDescription: "Water resistant shell." }),
      ),
    ).toEqual([]);
  });

  it("checks tags and option values as facts too", () => {
    expect(
      findUnsupportedClaims("Organic cotton.", facts({ tags: ["organic"] })),
    ).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(
      findUnsupportedClaims("Bestseller in our Guaranteed Rate shop", facts()),
    ).toEqual(["warranty or guarantee"]);
    expect(findUnsupportedClaims("A bestseller.", facts())).toEqual([]);
  });

  it("returns nothing for plain factual text", () => {
    expect(
      findUnsupportedClaims("Heated jacket with three heat settings.", facts()),
    ).toEqual([]);
  });
});

describe("findUnsupportedClaims usage claims", () => {
  it("flags invented suitability and sturdiness", () => {
    expect(
      findUnsupportedClaims(
        "Two sturdy handles, suitable for everyday use.",
        facts(),
      ),
    ).toEqual(["durable", "suitability"]);
  });
});
