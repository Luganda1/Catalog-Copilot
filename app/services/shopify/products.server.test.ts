import { describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { getProduct, listProducts } from "./products.server";

/**
 * MOCKED Shopify client: these tests cover our request variables and response
 * mapping only. They do not prove the real Admin API behaves this way; that is
 * covered by manual development-store checks.
 */
function mockAdmin(body: unknown) {
  const graphql = vi.fn(async () => new Response(JSON.stringify(body)));
  return { admin: { graphql } as unknown as AdminApiContext, graphql };
}

const pageInfo = {
  hasNextPage: true,
  hasPreviousPage: false,
  startCursor: "start",
  endCursor: "end",
};

describe("listProducts (mocked Admin API)", () => {
  it("passes pagination args and maps products with listing health", async () => {
    const { admin, graphql } = mockAdmin({
      data: {
        products: {
          nodes: [
            {
              id: "gid://shopify/Product/1",
              title: "Heated Jacket",
              status: "ACTIVE",
              tags: [],
              description: "Short.",
              featuredMedia: {
                preview: { image: { url: "https://cdn/x.jpg", altText: null } },
              },
            },
            {
              id: "gid://shopify/Product/2",
              title: "Gift Card",
              status: "DRAFT",
              tags: ["gift"],
              description: "",
              featuredMedia: null,
            },
          ],
          pageInfo,
        },
      },
    });

    const page = await listProducts(admin, { first: 20, after: "abc" });

    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("products("), {
      variables: { first: 20, after: "abc" },
    });
    expect(page.pageInfo).toEqual(pageInfo);
    expect(page.products[0]).toMatchObject({
      id: "gid://shopify/Product/1",
      image: { url: "https://cdn/x.jpg", altText: null },
      health: { missingDescription: false, missingTags: true },
    });
    expect(page.products[1]).toMatchObject({
      image: null,
      health: { missingDescription: true, missingTags: false },
    });
  });

  it("throws when Shopify returns no product connection", async () => {
    const { admin } = mockAdmin({ data: null });
    await expect(listProducts(admin, { first: 20, after: null })).rejects.toThrow(
      "Shopify returned no product data",
    );
  });
});

describe("getProduct (mocked Admin API)", () => {
  it("returns null when the product isn't in this shop", async () => {
    const { admin } = mockAdmin({ data: { product: null } });
    expect(await getProduct(admin, "gid://shopify/Product/404")).toBeNull();
  });

  it("flattens option values", async () => {
    const { admin } = mockAdmin({
      data: {
        product: {
          id: "gid://shopify/Product/1",
          title: "Heated Jacket",
          status: "ACTIVE",
          handle: "heated-jacket",
          descriptionHtml: "<p>Three heat settings.</p>",
          description: "Three heat settings.",
          tags: ["outerwear"],
          productType: "Jacket",
          vendor: "Acme",
          options: [{ name: "Size", optionValues: [{ name: "S" }, { name: "M" }] }],
          featuredMedia: null,
        },
      },
    });
    const product = await getProduct(admin, "gid://shopify/Product/1");
    expect(product?.options).toEqual([{ name: "Size", values: ["S", "M"] }]);
    expect(product?.health).toEqual({ missingDescription: false, missingTags: false });
  });
});
