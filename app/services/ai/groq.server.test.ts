import { describe, expect, it, vi } from "vitest";

import { DEFAULT_GROQ_MODEL, GROQ_API_URL, GroqProvider } from "./groq.server";
import type { ProductFacts } from "./types";

/**
 * MOCKED fetch: these tests cover the request we send and how we interpret
 * responses. They don't call the real Groq API.
 */
function providerResponding(status: number, body: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  return { provider: new GroqProvider("test-key", DEFAULT_GROQ_MODEL, fetchMock as typeof fetch), fetchMock };
}

const facts: ProductFacts = {
  title: "Heated Jacket",
  currentDescription: "Three heat settings.",
  productType: "Jacket",
  vendor: "Acme",
  tags: [],
  options: [],
};

const output = { description: "A jacket.", tags: [], missingInformation: [], warnings: [] };

const completion = (content: string | null, finish_reason = "stop") => ({
  model: DEFAULT_GROQ_MODEL,
  choices: [{ finish_reason, message: { content } }],
});

describe("GroqProvider (mocked fetch)", () => {
  it("sends a strict JSON-schema request and returns the parsed output", async () => {
    const { provider, fetchMock } = providerResponding(200, completion(JSON.stringify(output)));
    await expect(provider.generate(facts)).resolves.toEqual({ raw: output, model: DEFAULT_GROQ_MODEL });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GROQ_API_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const request = JSON.parse(init.body as string);
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(request.messages[1].content).toContain("<product_facts>");
  });

  it.each([
    ["truncation", 200, completion('{"descr', "length"), "truncated"],
    ["a refusal", 200, { choices: [{ message: { content: null, refusal: "no" } }] }, "refused"],
    ["non-JSON content", 200, completion("not json"), "invalid_output"],
    ["empty content", 200, completion(null), "invalid_output"],
    ["an unreadable body", 200, "<html>", "invalid_output"],
    ["a bad API key", 401, { error: { message: "Invalid API Key" } }, "not_configured"],
    ["a rate limit", 429, { error: { message: "Rate limit" } }, "provider_error"],
    ["a server error", 500, "oops", "provider_error"],
  ])("maps %s to an AiError", async (_label, status, body, code) => {
    const { provider } = providerResponding(status, body);
    await expect(provider.generate(facts)).rejects.toMatchObject({ code });
  });

  it("maps a network failure to provider_error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider = new GroqProvider("k", DEFAULT_GROQ_MODEL, fetchMock as typeof fetch);
    await expect(provider.generate(facts)).rejects.toMatchObject({ code: "provider_error" });
  });
});
