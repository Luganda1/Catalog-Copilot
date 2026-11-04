import type { ProductFacts } from "./types";

/** Long descriptions are cut, and the cut is reported to the merchant as a warning. */
export const MAX_DESCRIPTION_CHARS = 8000;

interface ProductLike {
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  options: { name: string; values: string[] }[];
}

export function buildProductFacts(product: ProductLike): {
  facts: ProductFacts;
  truncated: boolean;
} {
  const description = product.description.trim();
  const truncated = description.length > MAX_DESCRIPTION_CHARS;

  return {
    facts: {
      title: product.title.trim(),
      currentDescription: truncated
        ? description.slice(0, MAX_DESCRIPTION_CHARS)
        : description,
      productType: product.productType.trim(),
      vendor: product.vendor.trim(),
      tags: product.tags,
      // Shopify gives single-variant products a placeholder "Title: Default Title" option; it isn't a fact.
      options: product.options.filter(
        (option) =>
          !(option.name === "Title" && option.values.join() === "Default Title"),
      ),
    },
    truncated,
  };
}
