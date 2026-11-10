import { fillTitleTemplate } from "../../lib/title-format";
import type { AiProvider, GenerationRequest, ProviderResult } from "./types";

export const MOCK_MODEL = "mock";
export const MOCK_WARNING =
  "MOCK OUTPUT: produced by the mock AI provider from your existing product fields, not by a language model.";

/**
 * MOCK provider for local development and tests without an API key.
 * Deterministic: it only rearranges the supplied facts, so it never invents
 * anything, but it also doesn't demonstrate real AI behaviour.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async generate({ facts, titleFormat }: GenerationRequest): Promise<ProviderResult> {
    const optionLines = facts.options.map(
      (option) => `${option.name}: ${option.values.join(", ")}.`,
    );
    const paragraphs = [
      facts.currentDescription || `${facts.title}.`,
      optionLines.length ? `Available options. ${optionLines.join(" ")}` : "",
    ].filter(Boolean);

    const tags = [
      facts.productType,
      ...facts.options.flatMap((option) => option.values),
    ]
      .map((tag) => tag.replace(/,/g, " ").trim())
      .filter((tag) => tag && tag.length <= 40)
      .slice(0, 10);

    const missingInformation = [
      ...(facts.currentDescription ? [] : ["The product has no description."]),
      ...(facts.productType ? [] : ["No product type is set."]),
    ];

    // Fills the format with raw fields; a language model would also tidy the product name.
    const title = titleFormat
      ? fillTitleTemplate(titleFormat.template, {
          Brand: facts.vendor,
          "Product name": facts.title,
          "Product type": facts.productType,
          "Key detail": facts.options[0]?.values.join(", "),
        }).slice(0, titleFormat.maxLength)
      : null;

    return {
      raw: {
        title,
        description: paragraphs.join("\n\n"),
        tags,
        missingInformation,
        warnings: [MOCK_WARNING],
      },
      model: MOCK_MODEL,
    };
  }
}
