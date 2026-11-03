import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { rethrowIfResponse } from "../lib/errors.server";
import { needsAttention } from "../lib/listing";
import { parsePageArgs } from "../lib/pagination";
import { productUrlId } from "../lib/product-id";
import {
  listProducts,
  type ProductListItem,
  type ProductListPage,
} from "../services/shopify/products.server";

type LoaderData =
  | ({ ok: true; isFirstPage: boolean } & ProductListPage)
  | { ok: false; message: string };

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  // Outside the try block: auth redirects are thrown Responses and must propagate.
  const { admin } = await authenticate.admin(request);
  const pageArgs = parsePageArgs(new URL(request.url).searchParams);

  try {
    const page = await listProducts(admin, pageArgs);
    const isFirstPage = "after" in pageArgs && pageArgs.after === null;
    return { ok: true, isFirstPage, ...page };
  } catch (error) {
    rethrowIfResponse(error);
    console.error("Failed to load products", error);
    return {
      ok: false,
      message:
        "Shopify didn't return your products. Check your connection and try again.",
    };
  }
};

const STATUS_TONE: Record<string, "success" | "info" | "neutral"> = {
  ACTIVE: "success",
  DRAFT: "info",
  ARCHIVED: "neutral",
};

function formatStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function TagsCell({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 3);
  const hidden = tags.length - visible.length;
  return (
    <s-text>
      {visible.join(", ")}
      {hidden > 0 ? ` +${hidden} more` : ""}
    </s-text>
  );
}

function ProductRow({ product }: { product: ProductListItem }) {
  const { health } = product;
  return (
    <s-table-row>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-thumbnail
            size="small"
            alt={product.image?.altText || product.title}
            {...(product.image ? { src: product.image.url } : {})}
          />
          <Link to={`/app/products/${productUrlId(product.id)}`}>
            {product.title}
          </Link>
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={STATUS_TONE[product.status] ?? "neutral"}>
          {formatStatus(product.status)}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        {health.missingDescription ? (
          <s-badge tone="critical">Missing</s-badge>
        ) : (
          <s-badge tone="success">Present</s-badge>
        )}
      </s-table-cell>
      <s-table-cell>
        {health.missingTags ? (
          <s-badge tone="warning">No tags</s-badge>
        ) : (
          <TagsCell tags={product.tags} />
        )}
      </s-table-cell>
    </s-table-row>
  );
}

export default function Products() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isLoading =
    navigation.state === "loading" || revalidator.state === "loading";

  if (!data.ok) {
    return (
      <s-page heading="Products">
        <s-banner tone="critical" heading="Couldn't load products">
          <s-paragraph>{data.message}</s-paragraph>
          <s-button
            onClick={() => revalidator.revalidate()}
            {...(isLoading ? { loading: true } : {})}
          >
            Try again
          </s-button>
        </s-banner>
      </s-page>
    );
  }

  const { products, pageInfo, isFirstPage } = data;

  if (products.length === 0 && isFirstPage) {
    return (
      <s-page heading="Products">
        <s-section heading="No products yet">
          <s-paragraph>
            Add products in Shopify, then come back to check their listings.
          </s-paragraph>
          <s-button href="shopify://admin/products/new" target="_top">
            Add a product
          </s-button>
        </s-section>
      </s-page>
    );
  }

  const flaggedCount = products.filter((p) => needsAttention(p.health)).length;

  return (
    <s-page heading="Products">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {flaggedCount === 0
              ? "Every product on this page has a description and tags."
              : `${flaggedCount} of ${products.length} products on this page are missing a description or tags.`}
          </s-paragraph>

          <s-table
            variant="auto"
            {...(isLoading ? { loading: true } : {})}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="labeled">Description</s-table-header>
              <s-table-header listSlot="labeled">Tags</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <ProductRow key={product.id} product={product} />
              ))}
            </s-table-body>
          </s-table>

          {(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
            <s-stack direction="inline" gap="small-200" justifyContent="center">
              <s-button
                accessibilityLabel="Previous page of products"
                onClick={() => navigate(`?before=${encodeURIComponent(pageInfo.startCursor ?? "")}`)}
                {...(!pageInfo.hasPreviousPage || isLoading ? { disabled: true } : {})}
              >
                Previous
              </s-button>
              <s-button
                accessibilityLabel="Next page of products"
                onClick={() => navigate(`?after=${encodeURIComponent(pageInfo.endCursor ?? "")}`)}
                {...(!pageInfo.hasNextPage || isLoading ? { disabled: true } : {})}
              >
                Next
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
