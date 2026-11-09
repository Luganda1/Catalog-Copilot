import { z } from "zod";

import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { ModelOutputSchema } from "./schema";
import { AiError, type AiProvider, type GenerationRequest, type ProviderResult } from "./types";

// Groq exposes an OpenAI-compatible Chat Completions API. We call it with fetch
// rather than adding another SDK: it's one endpoint and the response is small.
export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// One of the models Groq supports for strict (constrained-decoding) structured outputs.
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

// Strict mode requires every property in `required` and additionalProperties: false,
// which z.toJSONSchema already produces for ModelOutputSchema.
const RESPONSE_SCHEMA: Record<string, unknown> = z.toJSONSchema(ModelOutputSchema);
delete RESPONSE_SCHEMA.$schema;

interface GroqChatResponse {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }[];
}

export class GroqProvider implements AiProvider {
  readonly name = "groq";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_GROQ_MODEL,
    // Injectable for tests only.
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate({ facts, titleFormat }: GenerationRequest): Promise<ProviderResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserMessage(facts, titleFormat) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "product_suggestion", strict: true, schema: RESPONSE_SCHEMA },
          },
          // gpt-oss is a reasoning model; medium is enough for a short grounded writing task.
          reasoning_effort: "medium",
          max_completion_tokens: 4000,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      throw new AiError("provider_error", "Couldn't reach the AI provider. Check the connection and try again.", { cause: error });
    }

    if (!response.ok) throw await httpError(response);

    let body: GroqChatResponse;
    try {
      body = (await response.json()) as GroqChatResponse;
    } catch (error) {
      throw new AiError("invalid_output", "The AI response couldn't be read, so it wasn't saved. Try generating again.", { cause: error });
    }

    const choice = body.choices?.[0];
    if (choice?.message?.refusal) {
      throw new AiError("refused", "The AI declined to write a suggestion for this product.", {
        details: choice.message.refusal,
      });
    }
    if (choice?.finish_reason === "length") {
      throw new AiError("truncated", "The AI response was cut off before it finished. Try generating again.");
    }

    const content = choice?.message?.content;
    let parsed: unknown;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : undefined;
    } catch (error) {
      throw new AiError("invalid_output", "The AI response wasn't in the expected format, so it wasn't saved. Try generating again.", { cause: error });
    }
    if (parsed == null) {
      throw new AiError("invalid_output", "The AI response wasn't in the expected format, so it wasn't saved. Try generating again.");
    }

    return { raw: parsed, model: body.model ?? this.model };
  }
}

async function httpError(response: Response): Promise<AiError> {
  // Provider error bodies go to server logs only, never to the merchant.
  const details = { status: response.status, body: await response.text().catch(() => "") };
  if (response.status === 401 || response.status === 403) {
    return new AiError("not_configured", "The AI provider rejected the app's API key. Check GROQ_API_KEY.", { details });
  }
  if (response.status === 429) {
    return new AiError("provider_error", "The AI provider's rate limit was reached. Wait a moment and try again.", { details });
  }
  return new AiError("provider_error", "The AI provider returned an error. Try again in a moment.", { details });
}
