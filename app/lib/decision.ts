import { MAX_TAG_LENGTH, parseTagInput, type TagMode } from "./tags";

// The AI is limited to 4000 characters; merchants editing by hand get more room.
export const MAX_APPROVED_DESCRIPTION_LENGTH = 10_000;

/** What the merchant approved on the review screen. Plain text; HTML is generated on the server. */
export interface Decision {
  description: string | null;
  tags: string[] | null;
  tagMode: TagMode;
}

export type DecisionResult = { ok: true; decision: Decision } | { ok: false; error: string };

/**
 * Validates the review form. A null field means "don't change it in Shopify".
 * Form input is untrusted even though it comes from our own UI.
 */
export function parseDecision(form: FormData): DecisionResult {
  const includeDescription = form.get("includeDescription") === "true";
  const includeTags = form.get("includeTags") === "true";
  if (!includeDescription && !includeTags) {
    return { ok: false, error: "Choose at least one change to publish." };
  }

  const tagMode = form.get("tagMode");
  if (tagMode !== "ADD" && tagMode !== "REPLACE") {
    return { ok: false, error: "Choose how to apply the tags." };
  }

  let description: string | null = null;
  if (includeDescription) {
    description = String(form.get("description") ?? "").trim();
    if (!description) return { ok: false, error: "The description is empty." };
    if (description.length > MAX_APPROVED_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        error: `The description is longer than ${MAX_APPROVED_DESCRIPTION_LENGTH.toLocaleString("en-US")} characters.`,
      };
    }
  }

  let tags: string[] | null = null;
  if (includeTags) {
    tags = parseTagInput(String(form.get("tags") ?? ""));
    const tooLong = tags.find((tag) => tag.length > MAX_TAG_LENGTH);
    if (tooLong) {
      return { ok: false, error: `The tag "${tooLong}" is longer than ${MAX_TAG_LENGTH} characters.` };
    }
  }

  return { ok: true, decision: { description, tags, tagMode } };
}
