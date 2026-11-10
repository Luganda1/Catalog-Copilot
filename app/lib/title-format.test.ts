import { describe, expect, it } from "vitest";

import {
  checkTitleFormat,
  exampleTitle,
  fillTitleTemplate,
  parseTitleFormat,
  templatePlaceholders,
} from "./title-format";

describe("parseTitleFormat", () => {
  it("accepts a valid format and normalizes placeholder names", () => {
    expect(parseTitleFormat("{brand}  { product  NAME } – {Key detail}", "70")).toEqual({
      ok: true,
      format: { template: "{Brand}  {Product name} – {Key detail}", maxLength: 70 },
    });
  });

  it.each([
    ["", "Enter a title format."],
    ["Just text", "Use at least one placeholder"],
    ["{Colour}", "isn't a placeholder"],
    ["{Brand} {Brand}", "more than once"],
    ["{Brand", "matching"],
    ["{Brand}<b>", "can't contain"],
    ["{Brand}\n{Product name}", "can't contain"],
  ])("rejects %j", (template, message) => {
    const result = parseTitleFormat(template, "70");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.template).toContain(message);
  });

  it.each(["", "abc", "19", "256", "70.5"])("rejects max length %j", (maxLength) => {
    const result = parseTitleFormat("{Brand}", maxLength);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.maxLength).toBeDefined();
  });
});

describe("templatePlaceholders", () => {
  it("lists placeholders in order", () => {
    expect(templatePlaceholders("{Product type} by {Brand}")).toEqual(["Product type", "Brand"]);
  });
});

describe("fillTitleTemplate", () => {
  const template = "{Brand} {Product name} – {Key detail}";

  it("fills every placeholder", () => {
    expect(
      fillTitleTemplate(template, { Brand: "Acme", "Product name": "Summit", "Key detail": "Black" }),
    ).toBe("Acme Summit – Black");
  });

  it("drops empty placeholders with their separators", () => {
    expect(fillTitleTemplate(template, { Brand: "Acme", "Product name": "Summit" })).toBe("Acme Summit");
    expect(fillTitleTemplate(template, { "Product name": "Summit", "Key detail": "Black" })).toBe(
      "Summit – Black",
    );
    expect(fillTitleTemplate("{Brand} | {Product name} | {Key detail}", { Brand: "Acme", "Key detail": "Black" })).toBe(
      "Acme | Black",
    );
    expect(fillTitleTemplate(template, { Brand: "Acme", "Key detail": "Black" })).toBe("Acme – Black");
  });

  it("builds the settings example", () => {
    expect(exampleTitle(template)).toBe("Acme Summit – Black, Sizes S–XL");
  });
});

describe("checkTitleFormat", () => {
  const format = { template: "{Brand} {Product type}", maxLength: 70 };

  it("passes a title with the brand and type", () => {
    expect(checkTitleFormat("Acme Heated Jacket", format, { vendor: "Acme", productType: "Heated Jacket" })).toEqual([]);
  });

  it("warns when a requested fact is missing", () => {
    const warnings = checkTitleFormat("Summit Jacket", format, { vendor: "Acme", productType: "Heated Jacket" });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"Acme"');
  });

  it("doesn't warn about facts the product doesn't have", () => {
    expect(checkTitleFormat("Summit Jacket", format, { vendor: "", productType: "" })).toEqual([]);
  });

  it("warns about all-caps titles", () => {
    expect(checkTitleFormat("ACME HEATED JACKET", format, { vendor: "Acme", productType: "Heated Jacket" })).toHaveLength(1);
  });
});
