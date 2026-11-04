import db from "../db.server";
import { textToSafeHtml } from "../lib/html";
import type { GeneratedSuggestion } from "../services/ai/index.server";

interface ProductSnapshot {
  id: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
}

/**
 * Stores a validated suggestion together with the product fields it was based on.
 * Any older undecided suggestion for the same product is marked SUPERSEDED in the
 * same transaction, so each product has at most one PENDING suggestion.
 */
export async function createSuggestion({
  shopId,
  product,
  generated,
}: {
  shopId: string;
  product: ProductSnapshot;
  generated: GeneratedSuggestion;
}) {
  return db.$transaction(async (tx) => {
    await tx.suggestion.updateMany({
      where: { shopId, productId: product.id, status: "PENDING" },
      data: { status: "SUPERSEDED" },
    });

    return tx.suggestion.create({
      data: {
        shopId,
        productId: product.id,
        sourceTitle: product.title,
        sourceDescriptionHtml: product.descriptionHtml,
        sourceTags: product.tags,
        aiDescriptionHtml: textToSafeHtml(generated.output.description),
        aiTags: generated.output.tags,
        missingInfo: generated.output.missingInformation,
        warnings: generated.output.warnings,
        aiModel: generated.model,
        promptVersion: generated.promptVersion,
      },
    });
  });
}

/** Latest undecided suggestion for a product, scoped to the authenticated shop. */
export async function getPendingSuggestion(shopId: string, productId: string) {
  return db.suggestion.findFirst({
    where: { shopId, productId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}
