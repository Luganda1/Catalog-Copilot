import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.server";
import { MAX_DESCRIPTION_CHARS } from "./facts";
import { DEFAULT_GROQ_MODEL, GroqProvider } from "./groq.server";
import { MockProvider } from "./mock.server";
import { PROMPT_VERSION } from "./prompt";
import { validateSuggestionOutput } from "./schema";
import { AiError, type AiProvider, type ProductFacts, type ValidatedSuggestion } from "./types";

/** Chooses the provider from server-side environment variables. */
export function getAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const provider = (env.AI_PROVIDER || "anthropic").toLowerCase();

  if (provider === "mock") return new MockProvider();

  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiError(
        "not_configured",
        "AI isn't configured. Set ANTHROPIC_API_KEY on the server (or AI_PROVIDER=mock for local testing).",
      );
    }
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL);
  }

  if (provider === "groq") {
    if (!env.GROQ_API_KEY) {
      throw new AiError(
        "not_configured",
        "AI isn't configured. Set GROQ_API_KEY on the server (or AI_PROVIDER=mock for local testing).",
      );
    }
    return new GroqProvider(env.GROQ_API_KEY, env.AI_MODEL || DEFAULT_GROQ_MODEL);
  }

  throw new AiError("not_configured", `Unknown AI_PROVIDER "${provider}". Use "groq", "anthropic" or "mock".`);
}

export interface GeneratedSuggestion {
  output: ValidatedSuggestion;
  model: string;
  promptVersion: string;
}

/**
 * Calls the provider and validates its output. Nothing reaches the database or
 * the UI unless validation passes.
 */
export async function generateSuggestion(
  provider: AiProvider,
  facts: ProductFacts,
  options: { descriptionTruncated?: boolean } = {},
): Promise<GeneratedSuggestion> {
  const { raw, model } = await provider.generate(facts);
  const output = validateSuggestionOutput(raw);

  if (options.descriptionTruncated) {
    output.warnings.push(
      `The current description is longer than ${MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters, so only the beginning was used.`,
    );
  }

  return { output, model, promptVersion: PROMPT_VERSION };
}
