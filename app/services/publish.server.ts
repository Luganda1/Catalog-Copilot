import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";

import db from "../db.server";
import type { Decision } from "../lib/decision";
import { textToSafeHtml } from "../lib/html";
import { productChangedSince } from "../lib/snapshot";
import { planTagChange } from "../lib/tags";
import { getProduct, updateProduct, type ProductUpdate } from "./shopify/products.server";

// Shopify allows up to 250 tags per product.
export const MAX_PRODUCT_TAGS = 250;

// A PUBLISHING lock older than this is treated as abandoned (for example, the
// server restarted mid-request) and can be taken over. Safe because the
// snapshot check below refuses to write if the earlier attempt did reach Shopify.
const STALE_LOCK_MS = 5 * 60 * 1000;

export type DecisionOutcome =
  | { status: "published" }
  | { status: "rejected" }
  | { status: "conflict"; message: string }
  | { status: "failed"; message: string }
  | { status: "unavailable"; message: string };

/**
 * Marks a pending suggestion as rejected. Never calls Shopify: the function
 * doesn't receive an Admin API client, so it can't change the product.
 */
export async function rejectSuggestion(shopId: string, suggestionId: string): Promise<DecisionOutcome> {
  const { count } = await db.suggestion.updateMany({
    where: { id: suggestionId, shopId, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date() },
  });
  return count === 1 ? { status: "rejected" } : unavailable(shopId, suggestionId);
}

/**
 * Publishes the merchant's approved changes for one suggestion.
 *
 * 1. Lock: PENDING → PUBLISHING in a single conditional update, so a double
 *    click or a second tab can't publish twice.
 * 2. Re-read the product and compare it with the snapshot; if it changed in
 *    Shopify since generation, stop without writing (CONFLICT).
 * 3. productUpdate, checking both thrown GraphQL errors and userErrors.
 * 4. Only a confirmed update marks the suggestion PUBLISHED. Every other path
 *    returns it to PENDING (with the merchant's approved edits kept) and logs
 *    a PublishAttempt.
 *
 * Limitation: Shopify's productUpdate has no "only if unchanged" precondition,
 * so an edit made in Shopify in the moment between step 2 and step 3 can still
 * be overwritten. The check narrows that window; it can't close it.
 */
export async function publishSuggestion(
  admin: AdminApiContext,
  shopId: string,
  suggestionId: string,
  decision: Decision,
): Promise<DecisionOutcome> {
  const approvedDescriptionHtml = decision.description === null ? null : textToSafeHtml(decision.description);
  const publishTags = decision.tags !== null;

  const now = new Date();
  const { count } = await db.suggestion.updateMany({
    where: {
      id: suggestionId,
      shopId,
      OR: [
        { status: "PENDING" },
        { status: "PUBLISHING", updatedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    data: {
      status: "PUBLISHING",
      approvedDescriptionHtml,
      approvedTags: decision.tags ?? [],
      publishTags,
      tagMode: publishTags ? decision.tagMode : null,
      decidedAt: now,
    },
  });
  if (count !== 1) return unavailable(shopId, suggestionId);

  const suggestion = await db.suggestion.findUniqueOrThrow({
    where: { id_shopId: { id: suggestionId, shopId } },
  });

  // Recorded on every attempt so the history shows what we tried to write.
  let attempted: { descriptionHtml: string | null; tags: string[] } = {
    descriptionHtml: approvedDescriptionHtml,
    tags: [],
  };

  const release = async (
    status: "FAILED" | "CONFLICT",
    errorMessage: string,
    errorDetails?: unknown,
  ) => {
    await db.$transaction([
      db.publishAttempt.create({
        data: {
          shopId,
          suggestionId,
          status,
          descriptionHtml: attempted.descriptionHtml,
          tags: attempted.tags,
          errorMessage,
          errorDetails: toJson(errorDetails),
        },
      }),
      db.suggestion.update({
        where: { id_shopId: { id: suggestionId, shopId } },
        data: { status: "PENDING", decidedAt: null },
      }),
    ]);
  };

  try {
    const product = await getProduct(admin, suggestion.productId);
    if (!product) {
      await release("FAILED", "The product no longer exists in Shopify.");
      return { status: "failed", message: "This product no longer exists in Shopify, so nothing was published." };
    }

    const snapshot = {
      title: suggestion.sourceTitle,
      descriptionHtml: suggestion.sourceDescriptionHtml,
      tags: suggestion.sourceTags,
    };
    if (productChangedSince(snapshot, product)) {
      await release("CONFLICT", "The product changed in Shopify after the suggestion was generated.", {
        snapshot,
        current: { title: product.title, descriptionHtml: product.descriptionHtml, tags: product.tags },
      });
      return {
        status: "conflict",
        message:
          "This product was edited in Shopify after the suggestion was generated, so nothing was published. Generate a new suggestion to work from the latest content.",
      };
    }

    const update: ProductUpdate = { id: product.id };
    if (approvedDescriptionHtml !== null) update.descriptionHtml = approvedDescriptionHtml;
    if (decision.tags !== null) {
      update.tags = planTagChange(product.tags, decision.tags, decision.tagMode).finalTags;
      if (update.tags.length > MAX_PRODUCT_TAGS) {
        await release("FAILED", `More than ${MAX_PRODUCT_TAGS} tags.`);
        return { status: "failed", message: `A product can have at most ${MAX_PRODUCT_TAGS} tags.` };
      }
    }
    attempted = { descriptionHtml: update.descriptionHtml ?? null, tags: update.tags ?? [] };

    const result = await updateProduct(admin, update);
    if (!result.ok) {
      await release("FAILED", result.userErrors.map((error) => error.message).join("; "), result.userErrors);
      return {
        status: "failed",
        message: `Shopify rejected the update: ${result.userErrors.map((error) => error.message).join("; ")}`,
      };
    }
  } catch (error) {
    // Includes thrown GraphQL errors (GraphqlQueryError) and network failures.
    // After a network failure we can't know whether Shopify applied the update;
    // if it did, a retry is stopped by the snapshot check instead of writing twice.
    console.error("Publish failed", error);
    await release("FAILED", error instanceof Error ? error.message : "Unknown error", describeError(error));
    // Thrown Responses (re-authentication) must still reach the Shopify library.
    if (error instanceof Response) throw error;
    return {
      status: "failed",
      message:
        "The update couldn't be confirmed, so it wasn't marked as published. Reload the page to see the product's current content, then try again.",
    };
  }

  // Shopify confirmed the update. This write is outside the try block on purpose:
  // if it fails, the product really was updated, so we must not record a FAILED
  // attempt. The suggestion then stays PUBLISHING until the stale-lock window
  // passes, and a retry is stopped by the snapshot check.
  await db.$transaction([
    db.publishAttempt.create({
      data: {
        shopId,
        suggestionId,
        status: "SUCCEEDED",
        descriptionHtml: attempted.descriptionHtml,
        tags: attempted.tags,
      },
    }),
    db.suggestion.update({
      where: { id_shopId: { id: suggestionId, shopId } },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    }),
  ]);
  return { status: "published" };
}

/** Explains why a suggestion couldn't be locked, without revealing other shops' data. */
async function unavailable(shopId: string, suggestionId: string): Promise<DecisionOutcome> {
  const suggestion = await db.suggestion.findFirst({
    where: { id: suggestionId, shopId },
    select: { status: true },
  });
  const messages: Record<string, string> = {
    PUBLISHING: "This suggestion is already being published.",
    PUBLISHED: "This suggestion has already been published.",
    REJECTED: "This suggestion has already been rejected.",
    SUPERSEDED: "A newer suggestion replaced this one. Reload the page.",
  };
  return {
    status: "unavailable",
    message: (suggestion && messages[suggestion.status]) ?? "Suggestion not found.",
  };
}

function describeError(error: unknown) {
  if (error instanceof Response) return { response: error.status };
  if (error instanceof Error) {
    // GraphqlQueryError carries the GraphQL errors in `body`.
    const body = (error as Error & { body?: unknown }).body;
    return { name: error.name, message: error.message, body };
  }
  return { error: String(error) };
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
