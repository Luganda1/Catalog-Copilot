import { describe, expect, it, vi } from "vitest";

import { generateSuggestion, getAiProvider } from "./index.server";
import { MOCK_WARNING, MockProvider } from "./mock.server";
import { PROMPT_VERSION } from "./prompt";
import { AiError, type AiProvider, type ProductFacts } from "./types";

const facts: ProductFacts = {
  title: "Heated Jacket",
  currentDescription: "Three heat settings. Power bank included.",
  productType: "Jacket",
  vendor: "Acme",
  tags: [],
  options: [{ name: "Size", values: ["S", "M"] }],
};

/** Test double that returns whatever raw output we give it. */
const fakeProvider = (raw: unknown): AiProvider => ({
  name: "fake",
  generate: async () => ({ raw, model: "fake-model" }),
});

describe("getAiProvider", () => {
  it("requires an API key for the Anthropic provider", () => {
    expect(() => getAiProvider({ AI_PROVIDER: "anthropic" })).toThrow(AiError);
  });

  it("requires an API key for the Groq provider", () => {
    expect(() => getAiProvider({ AI_PROVIDER: "groq" })).toThrow(/GROQ_API_KEY/);
  });

  it("returns the Groq provider when configured", () => {
    expect(getAiProvider({ AI_PROVIDER: "groq", GROQ_API_KEY: "k" }).name).toBe("groq");
  });

  it("returns the mock provider when asked", () => {
    expect(getAiProvider({ AI_PROVIDER: "mock" }).name).toBe("mock");
  });

  it("rejects unknown providers", () => {
    expect(() => getAiProvider({ AI_PROVIDER: "something" })).toThrow(/Unknown AI_PROVIDER/);
  });
});

describe("generateSuggestion", () => {
  it("rejects invalid provider output instead of returning it", async () => {
    await expect(
      generateSuggestion(fakeProvider({ description: "<b>hi</b>", tags: [] }), facts),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("returns validated output with model and prompt version", async () => {
    const result = await generateSuggestion(
      fakeProvider({
        description: "A heated jacket.",
        tags: ["outerwear"],
        missingInformation: [],
        warnings: [],
      }),
      facts,
    );
    expect(result).toMatchObject({ model: "fake-model", promptVersion: PROMPT_VERSION });
  });

  it("warns about claims in the draft that the facts don't support", async () => {
    const result = await generateSuggestion(
      fakeProvider({
        description: "A durable heated jacket.",
        tags: ["waterproof"],
        missingInformation: [],
        warnings: [],
      }),
      facts,
    );
    expect(result.output.warnings).toEqual([expect.stringMatching(/waterproof, durable/)]);
  });

  it("adds no claim warning for a factual draft", async () => {
    const result = await generateSuggestion(
      fakeProvider({
        description: "A heated jacket with three heat settings.",
        tags: ["jacket"],
        missingInformation: [],
        warnings: [],
      }),
      facts,
    );
    expect(result.output.warnings).toEqual([]);
  });

  it("adds a warning when the description was truncated", async () => {
    const result = await generateSuggestion(new MockProvider(), facts, {
      descriptionTruncated: true,
    });
    expect(result.output.warnings.some((w) => w.includes("only the beginning"))).toBe(true);
  });
});

describe("generateSuggestion titles", () => {
  const titleFormat = { template: "{Brand} {Product name}", maxLength: 40 };
  const draft = (title: string | null) => ({
    title,
    description: "A heated jacket.",
    tags: ["jacket"],
    missingInformation: [],
    warnings: [],
  });

  it("passes the title format to the provider and keeps a valid title", async () => {
    const generate = vi.fn(async () => ({ raw: draft("Acme Heated Jacket"), model: "fake" }));
    const result = await generateSuggestion({ name: "fake", generate }, facts, { titleFormat });
    expect(generate).toHaveBeenCalledWith({ facts, titleFormat });
    expect(result.output.title).toBe("Acme Heated Jacket");
    expect(result.titleTemplate).toBe("{Brand} {Product name}");
    expect(result.output.warnings).toEqual([]);
  });

  it("drops a title when no format was set", async () => {
    const result = await generateSuggestion(fakeProvider(draft("Acme Heated Jacket")), facts);
    expect(result.output.title).toBeNull();
    expect(result.titleTemplate).toBeNull();
  });

  it("drops an over-long title with a warning but keeps the rest of the draft", async () => {
    const result = await generateSuggestion(fakeProvider(draft("Acme " + "Very ".repeat(10) + "Jacket")), facts, {
      titleFormat,
    });
    expect(result.output.title).toBeNull();
    expect(result.output.description).toBe("A heated jacket.");
    expect(result.output.warnings).toEqual([expect.stringContaining("40-character limit")]);
  });

  it("warns when the title skips a fact the format asks for", async () => {
    const result = await generateSuggestion(fakeProvider(draft("Heated Jacket")), facts, { titleFormat });
    expect(result.output.warnings).toEqual([expect.stringContaining('brand ("Acme")')]);
  });

  it("checks the title for unsupported claims", async () => {
    const result = await generateSuggestion(fakeProvider(draft("Acme Waterproof Jacket")), facts, { titleFormat });
    expect(result.output.warnings).toEqual([expect.stringMatching(/waterproof/)]);
  });
});

describe("MockProvider (mock, not a language model)", () => {
  it("produces output that passes validation and is labelled as mock", async () => {
    const result = await generateSuggestion(new MockProvider(), facts);
    expect(result.model).toBe("mock");
    expect(result.output.warnings).toContain(MOCK_WARNING);
    expect(result.output.tags).toEqual(["Jacket", "S", "M"]);
    expect(result.output.title).toBeNull();
  });

  it("fills the title format from the facts", async () => {
    const result = await generateSuggestion(new MockProvider(), facts, {
      titleFormat: { template: "{Brand} {Product name} – {Key detail}", maxLength: 70 },
    });
    expect(result.output.title).toBe("Acme Heated Jacket – S, M");
  });
});
