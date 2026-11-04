import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "./anthropic.server";
import type { ProductFacts } from "./types";

/**
 * MOCKED Anthropic client: these tests cover how we interpret responses
 * (stop reasons, parse failures). They don't call the real API.
 */
function providerReturning(response: unknown) {
  const parse = vi.fn(async () => response);
  const client = { beta: { messages: { parse } } } as unknown as Anthropic;
  return { provider: new AnthropicProvider("test-key", "claude-opus-5-5", client), parse };
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

describe("AnthropicProvider (mocked client)", () => {
  it("returns parsed output and the model that answered", async () => {
    const { provider, parse } = providerReturning({
      stop_reason: "end_turn",
      parsed_output: output,
      model: "claude-opus-5-5",
    });
    await expect(provider.generate(facts)).resolves.toEqual({ raw: output, model: "claude-opus-5-5" });

    const request = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.fallbacks).toBe("default");
    expect(JSON.stringify(request.messages)).toContain("<product_facts>");
  });

  it.each([
    ["refusal", { stop_reason: "refusal", parsed_output: null, model: "m" }, "refused"],
    ["truncation", { stop_reason: "max_tokens", parsed_output: null, model: "m" }, "truncated"],
    ["unparseable output", { stop_reason: "end_turn", parsed_output: null, model: "m" }, "invalid_output"],
  ])("maps %s to an AiError", async (_label, response, code) => {
    const { provider } = providerReturning(response);
    await expect(provider.generate(facts)).rejects.toMatchObject({ code });
  });

  it("maps an SDK parse exception to invalid_output", async () => {
    const parse = vi.fn(async () => {
      throw new SyntaxError("Unexpected token");
    });
    const client = { beta: { messages: { parse } } } as unknown as Anthropic;
    const provider = new AnthropicProvider("k", "claude-opus-5-5", client);
    await expect(provider.generate(facts)).rejects.toMatchObject({ code: "invalid_output" });
  });
});
