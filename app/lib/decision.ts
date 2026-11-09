import { MAX_TAG_LENGTH, parseTagInput, type TagMode } from "./tags";
import { SHOPIFY_TITLE_MAX_LENGTH } from "./title-format";

// The AI is limited to 4000 characters; merchants editing by hand get more room.
export const MAX_APPROVED_DESCRIPTION_LENGTH = 10_000;

/** What the merchant approved on the review screen. Plain text; HTML is generated on the server. */
export interface Decision {
  title: string | null;
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
  const includeTitle = form.get("includeTitle") === "true";
  const includeDescription = form.get("includeDescription") === "true";
  const includeTags = form.get("includeTags") === "true";
  if (!includeTitle && !includeDescription && !includeTags) {
    return { ok: false, error: "Choose at least one change to publish." };
  }

  const tagMode = form.get("tagMode");
  if (tagMode !== "ADD" && tagMode !== "REPLACE") {
    return { ok: false, error: "Choose how to apply the tags." };
  }

  let title: string | null = null;
  if (includeTitle) {
    // Titles are one line; line breaks and repeated spaces become single spaces.
    title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim();
    if (!title) return { ok: false, error: "The title is empty." };
    if (title.length > SHOPIFY_TITLE_MAX_LENGTH) {
      return {
        ok: false,
        error: `The title is longer than ${SHOPIFY_TITLE_MAX_LENGTH} characters, Shopify's limit.`,
      };
    }
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

  return { ok: true, decision: { title, description, tags, tagMode } };
}
