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

/**
 * Decided suggestions and any with publish attempts, newest first, for one shop.
 * Undecided suggestions without attempts (and replaced ones) aren't history yet.
 */
export async function getHistory(shopId: string, limit: number) {
  return db.suggestion.findMany({
    where: {
      shopId,
      OR: [
        { status: { in: ["PUBLISHED", "REJECTED", "PUBLISHING"] } },
        { publishAttempts: { some: {} } },
      ],
    },
    include: { publishAttempts: { orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export type ProductSuggestionState = "draft" | "published";

/**
 * For each product, whether it has a draft waiting for review or a published
 * suggestion (the most recent of the two wins). Scoped to one shop.
 */
export async function getSuggestionStates(shopId: string, productIds: string[]) {
  const rows = await db.suggestion.findMany({
    where: { shopId, productId: { in: productIds }, status: { in: ["PENDING", "PUBLISHED"] } },
    select: { productId: true, status: true },
    orderBy: { updatedAt: "desc" },
  });
  const states: Record<string, ProductSuggestionState> = {};
  for (const row of rows) {
    states[row.productId] ??= row.status === "PENDING" ? "draft" : "published";
  }
  return states;
}
