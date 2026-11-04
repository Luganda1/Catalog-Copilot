export type TagMode = "ADD" | "REPLACE";

export const MAX_TAG_LENGTH = 40;

/** Trims, drops blanks, and removes case-insensitive duplicates (first spelling wins). */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** Parses the merchant's comma-separated tag input. Commas can't appear inside a Shopify tag. */
export function parseTagInput(input: string): string[] {
  return normalizeTags(input.split(","));
}

export interface TagChange {
  finalTags: string[];
  added: string[];
  removed: string[];
}

/**
 * ADD keeps every existing tag and appends new ones; REPLACE makes the
 * approved tags the product's entire tag list. Comparison is case-insensitive,
 * matching how Shopify treats tags.
 */
export function planTagChange(
  existing: readonly string[],
  approved: readonly string[],
  mode: TagMode,
): TagChange {
  const current = normalizeTags(existing);
  const proposed = normalizeTags(approved);
  const finalTags =
    mode === "ADD" ? normalizeTags([...current, ...proposed]) : proposed;

  const has = (list: string[], tag: string) =>
    list.some((t) => t.toLowerCase() === tag.toLowerCase());

  return {
    finalTags,
    added: finalTags.filter((tag) => !has(current, tag)),
    removed: current.filter((tag) => !has(finalTags, tag)),
  };
}
