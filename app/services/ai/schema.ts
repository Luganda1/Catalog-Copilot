import { z } from "zod";

import { MAX_TAG_LENGTH, normalizeTags } from "../../lib/tags";
import { AiError, type ValidatedSuggestion } from "./types";

/**
 * Shape requested from the model via structured outputs. Kept to plain types
 * because not every JSON Schema constraint is enforced by structured outputs;
 * the real limits are applied by SuggestionOutputSchema below.
 */
export const ModelOutputSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()),
  missingInformation: z.array(z.string()),
  warnings: z.array(z.string()),
});

const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_TAGS = 15;
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 300;

// Any markup-looking sequence. The description must be plain text; we generate the HTML ourselves.
const HTML_PATTERN = /<\s*[a-z!/?]/i;

const note = z.string().trim().min(1).max(MAX_NOTE_LENGTH);

/** Server-side validation of untrusted model output. Applies to every provider. */
export const SuggestionOutputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Description is empty")
      .max(MAX_DESCRIPTION_LENGTH)
      .refine((value) => !HTML_PATTERN.test(value), "Description contains HTML"),
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(MAX_TAG_LENGTH)
          .refine((tag) => !tag.includes(","), "Tags can't contain commas"),
      )
      .max(MAX_TAGS),
    missingInformation: z.array(note).max(MAX_NOTES),
    warnings: z.array(note).max(MAX_NOTES),
  })
  .strict();

/**
 * Validates and normalizes raw model output. Throws AiError("invalid_output")
 * so invalid output is never stored or shown as a suggestion.
 *
 * Passing this check means the output has the right shape and limits. It does
 * NOT mean the content is factually accurate; the merchant's review covers that.
 */
export function validateSuggestionOutput(raw: unknown): ValidatedSuggestion {
  const result = SuggestionOutputSchema.safeParse(raw);
  if (!result.success) {
    throw new AiError(
      "invalid_output",
      "The AI response didn't pass validation, so it wasn't saved. Try generating again.",
      { details: z.flattenError(result.error) },
    );
  }
  return {
    ...result.data,
    tags: normalizeTags(result.data.tags),
  };
}
