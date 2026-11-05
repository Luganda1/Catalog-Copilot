export interface ProductContent {
  title: string;
  descriptionHtml: string;
  tags: readonly string[];
}

/**
 * True when the product's title, description, or tags differ from the snapshot
 * a suggestion was generated from. Tag order is ignored; Shopify returns tags
 * sorted, but we don't rely on that.
 */
export function productChangedSince(snapshot: ProductContent, current: ProductContent): boolean {
  const sorted = (tags: readonly string[]) => [...tags].sort().join("\n");
  return (
    snapshot.title !== current.title ||
    snapshot.descriptionHtml !== current.descriptionHtml ||
    sorted(snapshot.tags) !== sorted(current.tags)
  );
}
