import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { rethrowIfResponse } from "../lib/errors.server";
import { productGidFromUrlId } from "../lib/product-id";
import {
  getProduct,
  type ProductDetail,
} from "../services/shopify/products.server";

type LoaderData =
  | { state: "ok"; product: ProductDetail }
  | { state: "not-found" }
  | { state: "error"; message: string };

export const loader = async ({
  request,
  params,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin } = await authenticate.admin(request);

  const gid = productGidFromUrlId(params.productId);
  if (!gid) return { state: "not-found" };

  try {
    // admin.graphql is bound to the authenticated shop, so a product id from
    // another store simply returns null here.
    const product = await getProduct(admin, gid);
    return product ? { state: "ok", product } : { state: "not-found" };
  } catch (error) {
    rethrowIfResponse(error);
    console.error("Failed to load product", error);
    return {
      state: "error",
      message: "Shopify didn't return this product. Try again in a moment.",
    };
  }
};

function BackLink() {
  return <Link to="/app">← Back to products</Link>;
}

export default function ProductReview() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  if (data.state === "not-found") {
    return (
      <s-page heading="Product not found">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              This product doesn&apos;t exist in your store, or it was deleted.
            </s-paragraph>
            <BackLink />
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (data.state === "error") {
    return (
      <s-page heading="Review product">
        <s-banner tone="critical" heading="Couldn't load this product">
          <s-paragraph>{data.message}</s-paragraph>
          <s-button
            onClick={() => revalidator.revalidate()}
            {...(revalidator.state === "loading" ? { loading: true } : {})}
          >
            Try again
          </s-button>
        </s-banner>
        <BackLink />
      </s-page>
    );
  }

  const { product } = data;
  const { health } = product;

  return (
    <s-page heading={product.title}>
      <s-stack direction="block" gap="base">
        <BackLink />

        {(health.missingDescription || health.missingTags) && (
          <s-banner tone="warning" heading="This listing is incomplete">
            <s-unordered-list>
              {health.missingDescription && (
                <s-list-item>The product has no description.</s-list-item>
              )}
              {health.missingTags && (
                <s-list-item>The product has no tags.</s-list-item>
              )}
            </s-unordered-list>
          </s-banner>
        )}

        <s-section heading="Current description">
          {health.missingDescription ? (
            <s-paragraph>
              <s-text color="subdued">No description.</s-text>
            </s-paragraph>
          ) : (
            // Plain text (Shopify's HTML-stripped field) so merchant HTML is never rendered unsanitized.
            <s-paragraph>{product.description}</s-paragraph>
          )}
        </s-section>

        <s-section heading="Product facts">
          <s-stack direction="block" gap="small-200">
            <s-text>
              <s-text type="strong">Status:</s-text> {product.status}
            </s-text>
            <s-text>
              <s-text type="strong">Type:</s-text>{" "}
              {product.productType || "Not set"}
            </s-text>
            <s-text>
              <s-text type="strong">Vendor:</s-text> {product.vendor || "Not set"}
            </s-text>
            <s-text>
              <s-text type="strong">Tags:</s-text>{" "}
              {product.tags.length ? product.tags.join(", ") : "None"}
            </s-text>
            {product.options
              .filter((option) => option.name !== "Title")
              .map((option) => (
                <s-text key={option.name}>
                  <s-text type="strong">{option.name}:</s-text>{" "}
                  {option.values.join(", ")}
                </s-text>
              ))}
          </s-stack>
        </s-section>

        <s-section heading="AI suggestion">
          <s-paragraph>
            Generating a suggestion is implemented in Phase 3.
          </s-paragraph>
          <s-button disabled>Generate suggestion</s-button>
        </s-section>
      </s-stack>

      {product.image && (
        <s-section slot="aside" heading="Image">
          <s-image
            src={product.image.url}
            alt={product.image.altText || product.title}
            borderRadius="base"
          />
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
