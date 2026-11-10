import { randomUUID } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import db from "../../app/db.server";
import { getOrCreateShop } from "../../app/models/shop.server";
import { createSuggestion, getHistory, getPendingSuggestion } from "../../app/models/suggestion.server";
import { publishSuggestion, rejectSuggestion } from "../../app/services/publish.server";
import type { Decision } from "../../app/lib/decision";

/**
 * Integration tests: REAL PostgreSQL (catalog_copilot_test), MOCKED Shopify
 * Admin API. They prove how our code records outcomes for each Shopify
 * response; they don't prove Shopify itself behaves this way.
 */

const PRODUCT_ID = "gid://shopify/Product/1001";

interface FakeProduct {
  title: string;
  descriptionHtml: string;
  tags: string[];
}

/** A fake Admin GraphQL client holding one product. Records every mutation it receives. */
function fakeAdmin(
  product: FakeProduct | null,
  onUpdate: (variables: { product: Record<string, unknown> }) => unknown = (variables) => ({
    data: {
      productUpdate: {
        product: { id: PRODUCT_ID, descriptionHtml: "", tags: [], ...variables.product },
        userErrors: [],
      },
    },
  }),
) {
  const mutations: Record<string, unknown>[] = [];
  const graphql = vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => {
    const variables = options?.variables ?? {};
    if (query.includes("CatalogCopilotProductUpdate")) {
      mutations.push(variables.product as Record<string, unknown>);
      const body = await onUpdate(variables as { product: Record<string, unknown> });
      return Response.json(body);
    }
    if (query.includes("CatalogCopilotProduct(")) {
      return Response.json({
        data: {
          product: product && {
            id: PRODUCT_ID,
            status: "ACTIVE",
            handle: "beanie",
            description: product.descriptionHtml.replace(/<[^>]+>/g, ""),
            productType: "Hats",
            vendor: "Northfold",
            options: [],
            featuredMedia: null,
            ...product,
          },
        },
      });
    }
    throw new Error(`Unexpected query: ${query.slice(0, 80)}`);
  });
  return { admin: { graphql } as unknown as AdminApiContext, mutations, graphql };
}

const source: FakeProduct = {
  title: "Merino Beanie",
  descriptionHtml: "<p>Soft merino.</p>",
  tags: ["hats"],
};

const decision: Decision = {
  title: null,
  description: "Soft merino beanie.\n\nRibbed <knit> & warm.",
  tags: ["wool", "Hats"],
  tagMode: "ADD",
};

const createdShops: string[] = [];

async function newShop() {
  const shop = await getOrCreateShop(`test-${randomUUID()}.myshopify.com`);
  createdShops.push(shop.id);
  return shop;
}

async function newSuggestion(shopId: string) {
  return createSuggestion({
    shopId,
    product: { id: PRODUCT_ID, ...source },
    generated: {
      output: {
        title: "Acme Merino Beanie",
        description: "Soft merino beanie.",
        tags: ["wool"],
        missingInformation: [],
        warnings: [],
      },
      titleTemplate: "{Brand} {Product name}",
      model: "test-model",
      promptVersion: "test",
    },
  });
}

const attemptsFor = (suggestionId: string) =>
  db.publishAttempt.findMany({ where: { suggestionId }, orderBy: { createdAt: "asc" } });

let shop: Awaited<ReturnType<typeof newShop>>;

beforeEach(async () => {
  shop = await newShop();
});

afterAll(async () => {
  await db.shop.deleteMany({ where: { id: { in: createdShops } } });
  await db.$disconnect();
});

describe("explicit approval", () => {
  it("generating a suggestion never writes to Shopify; it waits as PENDING", async () => {
    const { mutations } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);
    expect(suggestion.status).toBe("PENDING");
    expect(mutations).toHaveLength(0);
  });
});

describe("publishing", () => {
  it("publishes approved content and records success only after Shopify confirms", async () => {
    const { admin, mutations } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);

    await expect(publishSuggestion(admin, shop.id, suggestion.id, decision)).resolves.toEqual({
      status: "published",
    });

    expect(mutations).toEqual([
      {
        id: PRODUCT_ID,
        // Merchant text is escaped into paragraphs; "Hats" duplicates "hats" so ADD keeps one.
        descriptionHtml: "<p>Soft merino beanie.</p><p>Ribbed &lt;knit&gt; &amp; warm.</p>",
        tags: ["hats", "wool"],
      },
    ]);
    const saved = await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(saved.status).toBe("PUBLISHED");
    expect(saved.publishedAt).not.toBeNull();
    expect((await attemptsFor(suggestion.id)).map((a) => a.status)).toEqual(["SUCCEEDED"]);
  });

  it("REPLACE sends only the approved tags; omitted fields aren't sent", async () => {
    const { admin, mutations } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);
    await publishSuggestion(admin, shop.id, suggestion.id, {
      title: null,
      description: null,
      tags: ["wool"],
      tagMode: "REPLACE",
    });
    expect(mutations).toEqual([{ id: PRODUCT_ID, tags: ["wool"] }]);
  });

  it("publishes an approved title and records it on the suggestion and the attempt", async () => {
    const { admin, mutations } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);
    expect(suggestion).toMatchObject({ aiTitle: "Acme Merino Beanie", titleTemplate: "{Brand} {Product name}" });

    const outcome = await publishSuggestion(admin, shop.id, suggestion.id, {
      title: "Acme Merino Beanie – Grey",
      description: null,
      tags: null,
      tagMode: "ADD",
    });

    expect(outcome).toEqual({ status: "published" });
    expect(mutations).toEqual([{ id: PRODUCT_ID, title: "Acme Merino Beanie – Grey" }]);
    const saved = await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(saved.approvedTitle).toBe("Acme Merino Beanie – Grey");
    expect((await attemptsFor(suggestion.id))[0].title).toBe("Acme Merino Beanie – Grey");
  });

  it("stops with CONFLICT when the title changed in Shopify", async () => {
    const { admin, mutations } = fakeAdmin({ ...source, title: "Renamed in Shopify" });
    const suggestion = await newSuggestion(shop.id);
    const outcome = await publishSuggestion(admin, shop.id, suggestion.id, { ...decision, title: "Acme Merino Beanie" });
    expect(outcome.status).toBe("conflict");
    expect(mutations).toHaveLength(0);
  });

  it("stops with CONFLICT and sends nothing when the product changed since the snapshot", async () => {
    const { admin, mutations } = fakeAdmin({ ...source, descriptionHtml: "<p>Edited in Shopify.</p>" });
    const suggestion = await newSuggestion(shop.id);

    const outcome = await publishSuggestion(admin, shop.id, suggestion.id, decision);

    expect(outcome.status).toBe("conflict");
    expect(mutations).toHaveLength(0);
    const saved = await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(saved.status).toBe("PENDING");
    expect((await attemptsFor(suggestion.id)).map((a) => a.status)).toEqual(["CONFLICT"]);
  });

  it("records userErrors as FAILED, keeps the suggestion and the merchant's edits", async () => {
    const { admin } = fakeAdmin(source, () => ({
      data: { productUpdate: { product: null, userErrors: [{ field: ["tags"], message: "Tags are invalid" }] } },
    }));
    const suggestion = await newSuggestion(shop.id);

    const outcome = await publishSuggestion(admin, shop.id, suggestion.id, decision);

    expect(outcome).toMatchObject({ status: "failed", message: expect.stringContaining("Tags are invalid") });
    const saved = await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(saved.status).toBe("PENDING");
    expect(saved.publishedAt).toBeNull();
    expect(saved.approvedTags).toEqual(["wool", "Hats"]);
    const attempts = await attemptsFor(suggestion.id);
    expect(attempts.map((a) => a.status)).toEqual(["FAILED"]);
    expect(attempts[0].errorDetails).toEqual([{ field: ["tags"], message: "Tags are invalid" }]);
  });

  it("records a thrown GraphQL/network error as FAILED, not published", async () => {
    const { admin } = fakeAdmin(source, () => {
      throw new Error("GraphQL Client: Throttled");
    });
    const suggestion = await newSuggestion(shop.id);

    expect((await publishSuggestion(admin, shop.id, suggestion.id, decision)).status).toBe("failed");
    expect((await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status).toBe("PENDING");
    expect((await attemptsFor(suggestion.id)).map((a) => a.status)).toEqual(["FAILED"]);
  });

  it("can be retried after a failure", async () => {
    let fail = true;
    const { admin } = fakeAdmin(source, (variables) =>
      fail
        ? { data: { productUpdate: { product: null, userErrors: [{ field: null, message: "Try later" }] } } }
        : { data: { productUpdate: { product: { id: PRODUCT_ID, ...variables.product }, userErrors: [] } } },
    );
    const suggestion = await newSuggestion(shop.id);
    await publishSuggestion(admin, shop.id, suggestion.id, decision);
    fail = false;

    expect((await publishSuggestion(admin, shop.id, suggestion.id, decision)).status).toBe("published");
    expect((await attemptsFor(suggestion.id)).map((a) => a.status)).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("re-throws Shopify auth Responses after releasing the lock", async () => {
    const { admin } = fakeAdmin(source, () => {
      throw new Response(null, { status: 401 });
    });
    const suggestion = await newSuggestion(shop.id);

    await expect(publishSuggestion(admin, shop.id, suggestion.id, decision)).rejects.toBeInstanceOf(Response);
    expect((await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status).toBe("PENDING");
  });

  it("publishes once when the same suggestion is submitted twice at the same time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { admin, mutations } = fakeAdmin(source, async (variables) => {
      await gate; // hold the first request inside Shopify while the second arrives
      return { data: { productUpdate: { product: { id: PRODUCT_ID, ...variables.product }, userErrors: [] } } };
    });
    const suggestion = await newSuggestion(shop.id);

    const first = publishSuggestion(admin, shop.id, suggestion.id, decision);
    const second = publishSuggestion(admin, shop.id, suggestion.id, decision);
    const secondOutcome = await second;
    release();
    const firstOutcome = await first;

    expect([firstOutcome.status, secondOutcome.status].sort()).toEqual(["published", "unavailable"]);
    expect(mutations).toHaveLength(1);
    expect(await attemptsFor(suggestion.id)).toHaveLength(1);
  });

  it("refuses to publish a suggestion that was already published", async () => {
    const { admin, mutations } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);
    await publishSuggestion(admin, shop.id, suggestion.id, decision);

    const again = await publishSuggestion(admin, shop.id, suggestion.id, decision);
    expect(again).toMatchObject({ status: "unavailable", message: expect.stringContaining("already been published") });
    expect(mutations).toHaveLength(1);
  });
});

describe("rejecting", () => {
  it("marks the suggestion REJECTED without any Shopify call", async () => {
    const { graphql } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);

    await expect(rejectSuggestion(shop.id, suggestion.id)).resolves.toEqual({ status: "rejected" });

    expect(graphql).not.toHaveBeenCalled();
    const saved = await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(saved.status).toBe("REJECTED");
    expect(saved.decidedAt).not.toBeNull();
    expect(await attemptsFor(suggestion.id)).toHaveLength(0);
  });

  it("can't publish a rejected suggestion", async () => {
    const { admin, mutations } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);
    await rejectSuggestion(shop.id, suggestion.id);

    expect((await publishSuggestion(admin, shop.id, suggestion.id, decision)).status).toBe("unavailable");
    expect(mutations).toHaveLength(0);
  });
});

describe("shop isolation", () => {
  it("another shop can't see, reject, or publish this shop's suggestion", async () => {
    const otherShop = await newShop();
    const { admin, graphql } = fakeAdmin(source);
    const suggestion = await newSuggestion(shop.id);

    expect(await getPendingSuggestion(otherShop.id, PRODUCT_ID)).toBeNull();
    expect(await rejectSuggestion(otherShop.id, suggestion.id)).toEqual({
      status: "unavailable",
      message: "Suggestion not found.",
    });
    expect((await publishSuggestion(admin, otherShop.id, suggestion.id, decision)).status).toBe("unavailable");

    expect(graphql).not.toHaveBeenCalled();
    expect((await db.suggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status).toBe("PENDING");
  });

  it("history only contains the shop's own entries", async () => {
    const otherShop = await newShop();
    const mine = await newSuggestion(shop.id);
    const theirs = await newSuggestion(otherShop.id);
    await rejectSuggestion(shop.id, mine.id);
    await rejectSuggestion(otherShop.id, theirs.id);

    expect((await getHistory(shop.id, 50)).map((row) => row.id)).toEqual([mine.id]);
  });

  it("the database rejects a publish attempt that points at another shop's suggestion", async () => {
    const otherShop = await newShop();
    const suggestion = await newSuggestion(shop.id);

    await expect(
      db.publishAttempt.create({
        data: { shopId: otherShop.id, suggestionId: suggestion.id, status: "FAILED" },
      }),
    ).rejects.toThrow();
  });
});
