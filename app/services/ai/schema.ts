import { z } from "zod";

import { MAX_TAG_LENGTH, normalizeTags } from "../../lib/tags";
import type { TitleFormat } from "../../lib/title-format";
import { AiError, type ValidatedSuggestion } from "./types";

/**
 * Shape requested from the model via structured outputs. Kept to plain types
 * because not every JSON Schema constraint is enforced by structured outputs;
 * the real limits are applied by SuggestionOutputSchema below.
 */
export const ModelOutputSchema = z.object({
  // Null when the request has no title format.
  title: z.string().nullable(),
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
    // Checked on its own by validateTitle, so a bad title doesn't discard the rest.
    title: z.string().nullable().optional(),
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
export function validateSuggestionOutput(
  raw: unknown,
  titleFormat: TitleFormat | null = null,
): ValidatedSuggestion {
  const result = SuggestionOutputSchema.safeParse(raw);
  if (!result.success) {
    throw new AiError(
      "invalid_output",
      "The AI response didn't pass validation, so it wasn't saved. Try generating again.",
      { details: z.flattenError(result.error) },
    );
  }
  const { title: rawTitle, ...rest } = result.data;
  const output: ValidatedSuggestion = {
    ...rest,
    title: null,
    tags: normalizeTags(result.data.tags),
  };

  // A title is only kept when one was asked for.
  if (titleFormat) {
    const title = validateTitle(rawTitle, titleFormat.maxLength);
    if (title.ok) output.title = title.value;
    else output.warnings.push(`No title was suggested: ${title.reason}`);
  }
  return output;
}

/**
 * Checks a suggested title. Whitespace (including line breaks) is collapsed to
 * single spaces. Problems are reported as a reason, not thrown, so the
 * description and tags can still be reviewed.
 */
export function validateTitle(
  raw: string | null | undefined,
  maxLength: number,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, reason: "the AI didn't return one." };
  if (HTML_PATTERN.test(value)) {
    return { ok: false, reason: "the AI's title contained HTML, so it was left out." };
  }
  if (value.length > maxLength) {
    return {
      ok: false,
      reason: `the AI's title was ${value.length} characters, longer than your ${maxLength}-character limit, so it was left out.`,
    };
  }
  return { ok: true, value };
}
