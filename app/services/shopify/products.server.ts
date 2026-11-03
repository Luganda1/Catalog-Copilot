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
    products: connection.nodes.map((node) => ({
      id: node.id,
      title: node.title,
      status: node.status,
      tags: node.tags,
      descriptionPreview: node.description,
      image: node.featuredMedia?.preview?.image
        ? {
            url: node.featuredMedia.preview.image.url,
            altText: node.featuredMedia.preview.image.altText ?? null,
          }
        : null,
      health: assessListing({ description: node.description, tags: node.tags }),
    })),
    pageInfo: {
      hasNextPage: connection.pageInfo.hasNextPage,
      hasPreviousPage: connection.pageInfo.hasPreviousPage,
      startCursor: connection.pageInfo.startCursor ?? null,
      endCursor: connection.pageInfo.endCursor ?? null,
    },
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
            url(transform: { maxWidth: 400, maxHeight: 400 })
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
