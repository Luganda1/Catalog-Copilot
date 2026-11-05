import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { StatTile } from "../components/StatTile";
import { authenticate } from "../shopify.server";
import { rethrowIfResponse } from "../lib/errors.server";
import { needsAttention } from "../lib/listing";
import { parsePageArgs } from "../lib/pagination";
import { productUrlId } from "../lib/product-id";
import { getOrCreateShop } from "../models/shop.server";
import {
  getSuggestionStates,
  type ProductSuggestionState,
} from "../models/suggestion.server";
import {
  listProducts,
  scanCatalog,
  type ProductListItem,
  type ProductListPage,
} from "../services/shopify/products.server";

const VIEWS = ["all", "attention", "description", "tags"] as const;
type View = (typeof VIEWS)[number];

const VIEW_FILTERS: Record<
  Exclude<View, "all">,
  (p: ProductListItem) => boolean
> = {
  attention: (p) => needsAttention(p.health),
  description: (p) => p.health.missingDescription,
  tags: (p) => p.health.missingTags,
};

type LoaderData =
  | {
      ok: true;
      view: View;
      shopName: string;
      health: {
        checked: number;
        truncated: boolean;
        missingDescription: number;
        missingTags: number;
        needsAttention: number;
      };
      nextToFix: ProductListItem | null;
      /** Products for the current view: one Shopify page for "all", the filtered scan otherwise. */
      products: ProductListItem[];
      pageInfo: ProductListPage["pageInfo"] | null;
      isFirstPage: boolean;
      suggestionStates: Record<string, ProductSuggestionState>;
    }
  | { ok: false; message: string };

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  // Outside the try block: auth redirects are thrown Responses and must propagate.
  const { admin, session } = await authenticate.admin(request);
  const searchParams = new URL(request.url).searchParams;
  const requested = searchParams.get("view");
  const view: View = VIEWS.includes(requested as View)
    ? (requested as View)
    : "all";

  try {
    const scan = await scanCatalog(admin);
    const flagged = scan.products.filter((p) => needsAttention(p.health));

    let products: ProductListItem[];
    let pageInfo: ProductListPage["pageInfo"] | null = null;
    let isFirstPage = true;
    if (view === "all") {
      const pageArgs = parsePageArgs(searchParams);
      const page = await listProducts(admin, pageArgs);
      products = page.products;
      pageInfo = page.pageInfo;
      isFirstPage = "after" in pageArgs && pageArgs.after === null;
    } else {
      products = scan.products.filter(VIEW_FILTERS[view]);
    }

    const shop = await getOrCreateShop(session.shop);
    const suggestionStates = await getSuggestionStates(shop.id, [
      ...new Set([...products, ...flagged].map((p) => p.id)),
    ]);

    return {
      ok: true,
      view,
      shopName: scan.shopName,
      health: {
        checked: scan.products.length,
        truncated: scan.truncated,
        missingDescription: scan.products.filter(
          (p) => p.health.missingDescription,
        ).length,
        missingTags: scan.products.filter((p) => p.health.missingTags).length,
        needsAttention: flagged.length,
      },
      // Prefer a flagged product that doesn't already have a draft waiting.
      nextToFix:
        flagged.find((p) => !suggestionStates[p.id]) ?? flagged[0] ?? null,
      products,
      pageInfo,
      isFirstPage,
      suggestionStates,
    };
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

const productPath = (id: string) => `/app/products/${productUrlId(id)}`;

function formatStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

/** A compact, clickable product row: small thumbnail, title, and listing badges. */
function ProductCard({
  product,
  state,
}: {
  product: ProductListItem;
  state: ProductSuggestionState | undefined;
}) {
  const navigate = useNavigate();
  const { health } = product;
  const complete = !needsAttention(health);
  return (
    <s-clickable
      onClick={() => navigate(productPath(product.id))}
      accessibilityLabel={`Review ${product.title}`}
      padding="small"
      border="base"
      borderRadius="base"
      background="base"
    >
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-thumbnail
          size="small"
          alt={product.image?.altText || product.title}
          {...(product.image ? { src: product.image.url } : {})}
        />
        <s-stack direction="block" gap="small-400">
          <s-text type="strong">{product.title}</s-text>
          <s-stack direction="inline" gap="small-300">
            {state === "draft" && (
              <s-badge tone="info" icon="wand">
                Draft ready
              </s-badge>
            )}
            {health.missingDescription && (
              <s-badge tone="critical">No description</s-badge>
            )}
            {health.missingTags && <s-badge tone="warning">No tags</s-badge>}
            {complete && (
              <s-badge tone="success">
                {state === "published" ? "Updated by Copilot" : "Complete"}
              </s-badge>
            )}
            {product.status !== "ACTIVE" && (
              <s-badge>{formatStatus(product.status)}</s-badge>
            )}
          </s-stack>
        </s-stack>
      </s-stack>
    </s-clickable>
  );
}

// 1 column on narrow screens, up to 3 on wide ones.
const CARD_COLUMNS =
  "@container (inline-size > 860px) repeat(3, minmax(0, 1fr)), @container (inline-size > 520px) repeat(2, minmax(0, 1fr)), minmax(0, 1fr)";

// Square tiles on the left, the "next up" card fills the remaining width.
const HEALTH_COLUMNS = "@container (inline-size > 900px) auto 1fr, 1fr";

export default function Products() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isLoading =
    navigation.state === "loading" || revalidator.state === "loading";

  if (!data.ok) {
    return (
      <s-page heading="Catalog Copilot">
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

  const {
    view,
    shopName,
    health,
    nextToFix,
    products,
    pageInfo,
    suggestionStates,
  } = data;

  if (health.checked === 0) {
    return (
      <s-page heading="Catalog Copilot">
        <s-section>
          <s-stack direction="block" gap="base" alignItems="center">
            <s-icon type="product" />
            <s-heading>Add your first product</s-heading>
            <s-paragraph>
              Catalog Copilot checks your listings for missing descriptions and
              tags. Add products in Shopify, then come back.
            </s-paragraph>
            <s-button
              variant="primary"
              href="shopify://admin/products/new"
              target="_top"
            >
              Add a product
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const complete = health.checked - health.needsAttention;
  const completePercent = Math.round((complete / health.checked) * 100);
  const scope = health.truncated
    ? `your ${health.checked} most recently updated products`
    : `all ${health.checked} products`;

  const showView = (next: View) =>
    navigate(next === "all" || next === view ? "?" : `?view=${next}`);

  const viewTitle: Record<View, string> = {
    all: "All products",
    attention: "Needs attention",
    description: "Missing a description",
    tags: "Missing tags",
  };

  return (
    <s-page heading="Catalog Copilot">
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-400">
          <s-heading>Hi, {shopName} 👋</s-heading>
          <s-text color="subdued">
            Find incomplete listings and fix them with drafts you review before
            anything is published.
          </s-text>
        </s-stack>

        <s-section heading="Catalog health">
          <s-stack direction="block" gap="base">
            <s-query-container>
              <s-grid gridTemplateColumns={HEALTH_COLUMNS} gap="base">
                {/* Tiles double as filters for the product list below. */}
                <s-stack direction="inline" gap="base">
                  <StatTile
                    icon="check-circle"
                    tone="success"
                    label="Complete"
                    value={`${completePercent}%`}
                  />
                  <StatTile
                    icon="product"
                    tone="neutral"
                    label="Need attention"
                    value={String(health.needsAttention)}
                    selected={view === "attention"}
                    onClick={() => showView("attention")}
                  />
                  <StatTile
                    icon="alert-circle"
                    tone="critical"
                    label="No description"
                    value={String(health.missingDescription)}
                    selected={view === "description"}
                    onClick={() => showView("description")}
                  />
                  <StatTile
                    icon="hashtag"
                    tone="warning"
                    label="No tags"
                    value={String(health.missingTags)}
                    selected={view === "tags"}
                    onClick={() => showView("tags")}
                  />
                </s-stack>

                {nextToFix ? (
                  <s-box
                    padding="base"
                    borderRadius="large"
                    background="subdued"
                    minBlockSize="128px"
                  >
                    <s-stack
                      direction="block"
                      gap="base"
                      justifyContent="space-between"
                      blockSize="100%"
                    >
                      <s-stack direction="block" gap="small-400">
                        <s-text color="subdued">Next up</s-text>
                        <s-stack
                          direction="inline"
                          gap="small"
                          alignItems="center"
                        >
                          <s-thumbnail
                            size="small"
                            alt={nextToFix.image?.altText || nextToFix.title}
                            {...(nextToFix.image
                              ? { src: nextToFix.image.url }
                              : {})}
                          />
                          <s-stack direction="block" gap="small-500">
                            <s-text type="strong">{nextToFix.title}</s-text>
                            <s-text color="subdued">
                              {[
                                nextToFix.health.missingDescription &&
                                  "No description",
                                nextToFix.health.missingTags && "No tags",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </s-text>
                          </s-stack>
                        </s-stack>
                      </s-stack>
                      <s-stack direction="inline">
                        <s-button
                          variant="primary"
                          icon="wand"
                          onClick={() => navigate(productPath(nextToFix.id))}
                        >
                          {suggestionStates[nextToFix.id] === "draft"
                            ? "Review draft"
                            : "Fix this listing"}
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </s-box>
                ) : (
                  <s-box
                    padding="base"
                    borderRadius="large"
                    background="subdued"
                    minBlockSize="128px"
                  >
                    <s-stack direction="block" gap="small-300">
                      <s-icon type="check-circle" tone="success" />
                      <s-text type="strong">Every listing is complete</s-text>
                      <s-text color="subdued">
                        All products checked have a description and tags.
                      </s-text>
                    </s-stack>
                  </s-box>
                )}
              </s-grid>
            </s-query-container>
            <s-text color="subdued">
              Based on {scope}. Select a tile to filter the list.
            </s-text>
          </s-stack>
        </s-section>

        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-heading>
                {viewTitle[view]}
                {view !== "all" && ` · ${products.length}`}
              </s-heading>
              {view !== "all" && (
                <s-button
                  variant="tertiary"
                  icon="x"
                  onClick={() => showView("all")}
                >
                  Clear filter
                </s-button>
              )}
            </s-stack>

            {products.length === 0 ? (
              <s-box padding="large" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="small-200" alignItems="center">
                  <s-icon type="check-circle" tone="success" />
                  <s-text type="strong">Nothing here</s-text>
                  <s-text color="subdued">
                    No products match this filter.
                  </s-text>
                </s-stack>
              </s-box>
            ) : (
              <s-query-container>
                <s-grid gridTemplateColumns={CARD_COLUMNS} gap="small">
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      state={suggestionStates[product.id]}
                    />
                  ))}
                </s-grid>
              </s-query-container>
            )}

            {view !== "all" && health.truncated && (
              <s-text color="subdued">
                Filters cover {scope}. Clear the filter to browse the rest.
              </s-text>
            )}

            {pageInfo && (pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
              <s-stack
                direction="inline"
                gap="small-200"
                justifyContent="center"
              >
                <s-button
                  icon="chevron-left"
                  accessibilityLabel="Previous page of products"
                  onClick={() =>
                    navigate(
                      `?before=${encodeURIComponent(pageInfo.startCursor ?? "")}`,
                    )
                  }
                  {...(!pageInfo.hasPreviousPage || isLoading
                    ? { disabled: true }
                    : {})}
                >
                  Previous
                </s-button>
                <s-button
                  icon="chevron-right"
                  accessibilityLabel="Next page of products"
                  onClick={() =>
                    navigate(
                      `?after=${encodeURIComponent(pageInfo.endCursor ?? "")}`,
                    )
                  }
                  {...(!pageInfo.hasNextPage || isLoading
                    ? { disabled: true }
                    : {})}
                >
                  Next
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
