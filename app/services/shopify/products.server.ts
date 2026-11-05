import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import { assessListing, type ListingHealth } from "../../lib/listing";
import type { PageArgs } from "../../lib/pagination";

/**
 * Reads products live from the Shopify Admin GraphQL API. Nothing here is
 * persisted: Shopify stays the source of truth for the catalog.
 */

export interface ProductListItem {
  id: string;
  title: string;
  status: string;
  tags: string[];
  descriptionPreview: string;
  image: { url: string; altText: string | null } | null;
  health: ListingHealth;
}

export interface ProductListPage {
  products: ProductListItem[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}

const PRODUCTS_QUERY = `#graphql
  query CatalogCopilotProducts($first: Int, $after: String, $last: Int, $before: String) {
    products(first: $first, after: $after, last: $last, before: $before, sortKey: TITLE) {
      nodes {
        id
        title
        status
        tags
        description(truncateAt: 120)
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 120, maxHeight: 120 })
              altText
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }`;

interface ListNode {
  id: string;
  title: string;
  status: string;
  tags: string[];
  description: string;
  featuredMedia?: {
    preview?: { image?: { url: string; altText?: string | null } | null } | null;
  } | null;
}

function toListItem(node: ListNode): ProductListItem {
  const image = node.featuredMedia?.preview?.image;
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    tags: node.tags,
    descriptionPreview: node.description,
    image: image ? { url: image.url, altText: image.altText ?? null } : null,
    health: assessListing({ description: node.description, tags: node.tags }),
  };
}

export async function listProducts(
  admin: AdminApiContext,
  page: PageArgs,
): Promise<ProductListPage> {
  const response = await admin.graphql(PRODUCTS_QUERY, { variables: page });
  const { data } = await response.json();
  const connection = data?.products;
  if (!connection) {
    throw new Error("Shopify returned no product data");
  }

  return {
    products: connection.nodes.map(toListItem),
    pageInfo: {
      hasNextPage: connection.pageInfo.hasNextPage,
      hasPreviousPage: connection.pageInfo.hasPreviousPage,
      startCursor: connection.pageInfo.startCursor ?? null,
      endCursor: connection.pageInfo.endCursor ?? null,
    },
  };
}

export interface CatalogScan {
  shopName: string;
  products: ProductListItem[];
  /** True when the store has more products than the scan covers. */
  truncated: boolean;
}

// 100 products with an image each keeps the query well under Shopify's
// 1,000-point query cost limit (each product node with media costs ~4 points).
export const CATALOG_SCAN_SIZE = 100;

const CATALOG_SCAN_QUERY = `#graphql
  query CatalogCopilotScan($first: Int!) {
    shop {
      name
    }
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        status
        tags
        description(truncateAt: 120)
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 120, maxHeight: 120 })
              altText
            }
          }
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }`;

/**
 * The most recently updated products, used for the catalog health summary and
 * the "needs attention" views. Read live; nothing is stored.
 */
export async function scanCatalog(admin: AdminApiContext): Promise<CatalogScan> {
  const response = await admin.graphql(CATALOG_SCAN_QUERY, {
    variables: { first: CATALOG_SCAN_SIZE },
  });
  const { data } = await response.json();
  if (!data?.products || !data.shop) {
    throw new Error("Shopify returned no catalog data");
  }
  return {
    shopName: data.shop.name,
    products: data.products.nodes.map(toListItem),
    truncated: data.products.pageInfo.hasNextPage,
  };
}

export interface ProductDetail {
  id: string;
  title: string;
  status: string;
  handle: string;
  descriptionHtml: string;
  description: string;
  tags: string[];
  productType: string;
  vendor: string;
  options: { name: string; values: string[] }[];
  image: { url: string; altText: string | null } | null;
  health: ListingHealth;
}

const PRODUCT_QUERY = `#graphql
  query CatalogCopilotProduct($id: ID!) {
    product(id: $id) {
      id
      title
      status
      handle
      descriptionHtml
      description
      tags
      productType
      vendor
      options {
        name
        optionValues {
          name
        }
      }
      featuredMedia {
        preview {
          image {
            url(transform: { maxWidth: 200, maxHeight: 200 })
            altText
          }
        }
      }
    }
  }`;

/** Returns null when the product doesn't exist in the authenticated shop. */
export async function getProduct(
  admin: AdminApiContext,
  id: string,
): Promise<ProductDetail | null> {
  const response = await admin.graphql(PRODUCT_QUERY, { variables: { id } });
  const { data } = await response.json();
  const product = data?.product;
  if (!product) return null;

  return {
    id: product.id,
    title: product.title,
    status: product.status,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    description: product.description,
    tags: product.tags,
    productType: product.productType,
    vendor: product.vendor,
    options: product.options.map((option) => ({
      name: option.name,
      values: option.optionValues.map((value) => value.name),
    })),
    image: product.featuredMedia?.preview?.image
      ? {
          url: product.featuredMedia.preview.image.url,
          altText: product.featuredMedia.preview.image.altText ?? null,
        }
      : null,
    health: assessListing({
      description: product.description,
      tags: product.tags,
    }),
  };
}

export interface ProductUpdate {
  id: string;
  /** Omitted fields are left unchanged in Shopify. */
  descriptionHtml?: string;
  /** The product's complete tag list after the update (Shopify replaces tags as a whole). */
  tags?: string[];
}

export type ProductUpdateResult =
  | { ok: true; product: { id: string; descriptionHtml: string; tags: string[] } }
  | { ok: false; userErrors: { field: string[] | null; message: string }[] };

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation CatalogCopilotProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        descriptionHtml
        tags
      }
      userErrors {
        field
        message
      }
    }
  }`;

/**
 * Writes the approved fields to Shopify. Top-level GraphQL errors (bad query,
 * throttling, missing scope) are thrown by the client; validation problems come
 * back as userErrors with HTTP 200, so both must be checked before treating the
 * update as successful.
 */
export async function updateProduct(
  admin: AdminApiContext,
  update: ProductUpdate,
): Promise<ProductUpdateResult> {
  const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
    variables: { product: update },
  });
  const { data } = await response.json();
  const payload = data?.productUpdate;

  if (!payload) {
    return { ok: false, userErrors: [{ field: null, message: "Shopify returned no result for the update." }] };
  }
  if (payload.userErrors.length > 0) {
    return {
      ok: false,
      userErrors: payload.userErrors.map((error) => ({
        field: error.field ?? null,
        message: error.message,
      })),
    };
  }
  if (!payload.product) {
    return { ok: false, userErrors: [{ field: null, message: "Shopify didn't return the updated product." }] };
  }
  return { ok: true, product: payload.product };
}
