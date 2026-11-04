/**
 * Plain, deterministic checks for incomplete listings. No AI is involved:
 * a listing is flagged only when a field is objectively empty.
 */

export interface ListingHealth {
  missingDescription: boolean;
  missingTags: boolean;
}

/** True when the text contains something other than whitespace (including non-breaking spaces). */
export function hasText(value: string | null | undefined): boolean {
  return (value ?? "").replace(/\s|&nbsp;/g, "").length > 0;
}

/**
 * @param description Shopify's plain-text `description` field (HTML already stripped).
 * @param tags Product tags as returned by the Admin API.
 */
export function assessListing({
  description,
  tags,
}: {
  description: string | null | undefined;
  tags: readonly string[];
}): ListingHealth {
  return {
    missingDescription: !hasText(description),
    missingTags: !tags.some((tag) => hasText(tag)),
  };
}

export function needsAttention(health: ListingHealth): boolean {
  return health.missingDescription || health.missingTags;
}
