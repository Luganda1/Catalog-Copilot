import { describe, expect, it } from "vitest";

import { productGidFromUrlId, productUrlId } from "./product-id";

describe("product ids", () => {
  it("round-trips a product GID through the URL form", () => {
    const gid = "gid://shopify/Product/8123456789012";
    expect(productGidFromUrlId(productUrlId(gid))).toBe(gid);
  });

  it("keeps ids larger than Number.MAX_SAFE_INTEGER intact as strings", () => {
    expect(productGidFromUrlId("99999999999999999999")).toBe(
      "gid://shopify/Product/99999999999999999999",
    );
  });

  it.each([undefined, "", "abc", "12a", "-1", "1.5", "gid://shopify/Product/1"])(
    "rejects invalid URL id %j",
    (value) => {
      expect(productGidFromUrlId(value)).toBeNull();
    },
  );

  it("refuses to build a URL id from a non-product GID", () => {
    expect(() => productUrlId("gid://shopify/Order/1")).toThrow();
  });
});
