import { describe, expect, it } from "vitest";

import { escapeHtml, safeHtmlToText, textToSafeHtml } from "./html";

describe("textToSafeHtml", () => {
  it("wraps paragraphs and escapes markup", () => {
    expect(textToSafeHtml('Warm & dry.\n\n<script>alert("x")</script>')).toBe(
      "<p>Warm &amp; dry.</p><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });

  it("turns single newlines into <br> and drops empty paragraphs", () => {
    expect(textToSafeHtml("Line one\nLine two\n\n\n\n")).toBe("<p>Line one<br>Line two</p>");
  });

  it("round-trips through safeHtmlToText", () => {
    const text = `Three heat settings.\n\nIncludes a power bank & "quick start" card.\nOne-year? Not stated.`;
    expect(safeHtmlToText(textToSafeHtml(text))).toBe(text);
  });

  it("escapes every special character", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
