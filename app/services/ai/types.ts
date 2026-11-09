import type { TitleFormat } from "../../lib/title-format";

/**
 * The only product information the AI is allowed to use. Built from a live
 * Shopify read; nothing else (store settings, other products, the web) is sent.
 */
export interface ProductFacts {
  title: string;
  /** Plain text (Shopify's HTML-stripped `description`), so hidden markup and comments never reach the model. */
  currentDescription: string;
  productType: string;
  vendor: string;
  tags: string[];
  options: { name: string; values: string[] }[];
}

/** What a provider is asked to draft. */
export interface GenerationRequest {
  facts: ProductFacts;
  /** The shop's title format; null means don't suggest a title. */
  titleFormat: TitleFormat | null;
}

/** A suggestion that passed server-side validation. Plain text; converted to HTML only when stored. */
export interface ValidatedSuggestion {
  /** Null when no title was requested or the suggested title failed validation. */
  title: string | null;
  description: string;
  tags: string[];
  missingInformation: string[];
  warnings: string[];
}

export interface ProviderResult {
  /** Untrusted model output; must go through validateSuggestionOutput before use. */
  raw: unknown;
  /** The model that actually produced the output (may differ from the requested one after a fallback). */
  model: string;
}

export interface AiProvider {
  readonly name: string;
  generate(request: GenerationRequest): Promise<ProviderResult>;
}

export type AiErrorCode =
  | "not_configured"
  | "refused"
  | "truncated"
  | "invalid_output"
  | "provider_error";

/** Errors carry a merchant-safe message; details go to server logs only. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly userMessage: string,
    options?: { cause?: unknown; details?: unknown },
  ) {
    super(`${code}: ${userMessage}`, { cause: options?.cause });
    this.details = options?.details;
  }
  readonly details: unknown;
}
