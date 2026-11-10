import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { ModelOutputSchema } from "./schema";
import { AiError, type AiProvider, type GenerationRequest, type ProviderResult } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_ANTHROPIC_MODEL,
    // Injectable for tests only.
    client?: Anthropic,
  ) {
    // 90s per attempt; the SDK retries 429/5xx/connection errors twice by default.
    this.client = client ?? new Anthropic({ apiKey, timeout: 90_000 });
  }

  async generate({ facts, titleFormat }: GenerationRequest): Promise<ProviderResult> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // Medium effort: a short, grounded writing task doesn't need deep reasoning.
        output_config: {
          effort: "medium",
          format: betaZodOutputFormat(ModelOutputSchema),
        },
        // If a request is declined by safety classifiers, the API retries it on a
        // fallback model inside the same call. response.model reports which one answered.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(facts, titleFormat) }],
      });
    } catch (error) {
      throw toAiError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new AiError(
        "refused",
        "The AI declined to write a suggestion for this product.",
        { details: response.stop_details },
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiError(
        "truncated",
        "The AI response was cut off before it finished. Try generating again.",
      );
    }
    if (response.parsed_output == null) {
      throw new AiError(
        "invalid_output",
        "The AI response wasn't in the expected format, so it wasn't saved. Try generating again.",
      );
    }

    return { raw: response.parsed_output, model: response.model };
  }
}

function toAiError(error: unknown): AiError {
  // Most specific first. Messages shown to merchants never include provider details.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("not_configured", "The AI provider rejected the app's API key. Check ANTHROPIC_API_KEY.", { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("provider_error", "The AI provider is busy. Wait a moment and try again.", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("provider_error", "Couldn't reach the AI provider. Check the connection and try again.", { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError("provider_error", "The AI provider returned an error. Try again in a moment.", { cause: error });
  }
  // Includes SDK parse errors when the response doesn't match the schema.
  return new AiError("invalid_output", "The AI response couldn't be read, so it wasn't saved. Try generating again.", { cause: error });
}
