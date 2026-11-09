import { Link } from "react-router";

import { productUrlId } from "../lib/product-id";
import type { ProductSuggestionState } from "../models/suggestion.server";
import type { ProductListItem } from "../services/shopify/products.server";

export const productPath = (id: string) => `/app/products/${productUrlId(id)}`;

const STATUS_TONES: Record<string, "success" | "info" | "neutral"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "neutral",
};

// Fixed locale and time zone so the server and browser render the same text (no hydration mismatch).
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function CopilotState({
  product,
  state,
}: {
  product: ProductListItem;
  state: ProductSuggestionState | undefined;
}) {
  if (state === "draft") {
    return (
      <s-badge tone="info" icon="wand">
        Draft ready
      </s-badge>
    );
  }
  if (product.health.missingDescription || product.health.missingTags) {
    return <s-text color="subdued">Needs a draft</s-text>;
  }
  return (
    <s-text color="subdued">
      {state === "published" ? "Updated by Copilot" : "Complete"}
    </s-text>
  );
}

/**
 * Products as table rows: thumbnail and title, Shopify status, what the listing
 * is missing, Copilot's state, and when the product last changed. Clicking a
 * row opens the product's review page.
 */
export function ProductTable({
  products,
  states,
}: {
  products: ProductListItem[];
  states: Record<string, ProductSuggestionState>;
}) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Product</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Description</s-table-header>
        <s-table-header>Tags</s-table-header>
        <s-table-header>Copilot</s-table-header>
        <s-table-header>Updated</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {products.map((product) => {
          const linkId = `product-${productUrlId(product.id)}`;
          return (
            <s-table-row key={product.id} clickDelegate={linkId}>
              <s-table-cell>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-thumbnail
                    size="small-200"
                    alt={product.image?.altText || product.title}
                    {...(product.image ? { src: product.image.url } : {})}
                  />
                  <Link id={linkId} to={productPath(product.id)}>
                    {product.title}
                  </Link>
                </s-stack>
              </s-table-cell>
              <s-table-cell>
                <s-badge tone={STATUS_TONES[product.status] ?? "neutral"}>
                  {formatStatus(product.status)}
                </s-badge>
              </s-table-cell>
              <s-table-cell>
                {product.health.missingDescription ? (
                  <s-badge tone="critical">Missing</s-badge>
                ) : (
                  <s-badge tone="success">Added</s-badge>
                )}
              </s-table-cell>
              <s-table-cell>
                {product.health.missingTags ? (
                  <s-badge tone="warning">Missing</s-badge>
                ) : (
                  <s-text>{product.tags.length}</s-text>
                )}
              </s-table-cell>
              <s-table-cell>
                <CopilotState product={product} state={states[product.id]} />
              </s-table-cell>
              <s-table-cell>
                {DATE_FORMAT.format(new Date(product.updatedAt))}
              </s-table-cell>
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}
