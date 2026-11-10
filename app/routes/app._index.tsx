import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef } from "react";
import {
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { ProductTable, productPath } from "../components/ProductTable";
import { StatTile } from "../components/StatTile";
import { authenticate } from "../shopify.server";
import { rethrowIfResponse } from "../lib/errors.server";
import { needsAttention } from "../lib/listing";
import {
  PAGE_SIZES,
  parsePageArgs,
  parsePageNumber,
  parsePageSize,
  type PageSize,
} from "../lib/pagination";
import {
  MAX_SEARCH_LENGTH,
  parseSearch,
  titleMatches,
  titleSearchQuery,
} from "../lib/search";
import { getOrCreateShop } from "../models/shop.server";
import {
  getSuggestionStates,
  type ProductSuggestionState,
} from "../models/suggestion.server";
import {
  listProducts,
  scanCatalog,
  type ProductListItem,
} from "../services/shopify/products.server";

const VIEWS = ["all", "attention", "description", "tags"] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  all: "All products",
  attention: "Needs attention",
  description: "No description",
  tags: "No tags",
};

const VIEW_FILTERS: Record<
  Exclude<View, "all">,
  (p: ProductListItem) => boolean
> = {
  attention: (p) => needsAttention(p.health),
  description: (p) => p.health.missingDescription,
  tags: (p) => p.health.missingTags,
};

type Paging =
  /** "All" pages through Shopify with cursors. */
  | {
      kind: "cursor";
      hasPrevious: boolean;
      hasNext: boolean;
      startCursor: string | null;
      endCursor: string | null;
    }
  /** Filtered views page through the catalog scan by number. */
  | { kind: "number"; page: number; pageCount: number; total: number };

type LoaderData =
  | {
      ok: true;
      view: View;
      size: PageSize;
      /** Title search text; empty when not searching. */
      search: string;
      shopName: string;
      health: {
        checked: number;
        truncated: boolean;
        missingDescription: number;
        missingTags: number;
        needsAttention: number;
      };
      nextToFix: ProductListItem | null;
      products: ProductListItem[];
      paging: Paging;
      states: Record<string, ProductSuggestionState>;
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
  const size = parsePageSize(searchParams);
  const search = parseSearch(searchParams);

  try {
    // The scan feeds the health summary and the filtered views. Shopify search
    // can't filter on an empty description, so filters work on the scan.
    const scan = await scanCatalog(admin);
    const flagged = scan.products.filter((p) => needsAttention(p.health));

    let products: ProductListItem[];
    let paging: Paging;
    if (view === "all") {
      const page = await listProducts(
        admin,
        parsePageArgs(searchParams, size),
        titleSearchQuery(search),
      );
      products = page.products;
      paging = {
        kind: "cursor",
        hasPrevious: page.pageInfo.hasPreviousPage,
        hasNext: page.pageInfo.hasNextPage,
        startCursor: page.pageInfo.startCursor,
        endCursor: page.pageInfo.endCursor,
      };
    } else {
      const matching = scan.products.filter(
        (p) => VIEW_FILTERS[view](p) && titleMatches(p.title, search),
      );
      const pageCount = Math.max(1, Math.ceil(matching.length / size));
      const page = Math.min(parsePageNumber(searchParams), pageCount);
      products = matching.slice((page - 1) * size, page * size);
      paging = { kind: "number", page, pageCount, total: matching.length };
    }

    const shop = await getOrCreateShop(session.shop);
    const states = await getSuggestionStates(shop.id, [
      ...new Set([...products, ...flagged].map((p) => p.id)),
    ]);

    return {
      ok: true,
      view,
      size,
      search,
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
      nextToFix: flagged.find((p) => !states[p.id]) ?? flagged[0] ?? null,
      products,
      paging,
      states,
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

// React 18 passes props to web components as attributes and can't read their
// value properties, so select values are read from the native `input` event.
const selectValue = (event: { currentTarget: EventTarget | null }) =>
  (event.currentTarget as HTMLElement & { value: string }).value;

/** How long to wait after the last keystroke before searching. */
const SEARCH_DELAY_MS = 300;

// Square tiles on the left, the "next up" card fills the remaining width.
const HEALTH_COLUMNS = "@container (inline-size > 900px) auto 1fr, 1fr";

function NextUp({
  product,
  hasDraft,
}: {
  product: ProductListItem | null;
  hasDraft: boolean;
}) {
  const navigate = useNavigate();
  if (!product) {
    return (
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
    );
  }
  return (
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
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-thumbnail
              size="small"
              alt={product.image?.altText || product.title}
              {...(product.image ? { src: product.image.url } : {})}
            />
            <s-stack direction="block" gap="small-500">
              <s-text type="strong">{product.title}</s-text>
              <s-text color="subdued">
                {[
                  product.health.missingDescription && "No description",
                  product.health.missingTags && "No tags",
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
            onClick={() => navigate(productPath(product.id))}
          >
            {hasDraft ? "Review draft" : "Fix this listing"}
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isLoading =
    navigation.state === "loading" || revalidator.state === "loading";
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(searchTimer.current), []);

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
    size,
    search,
    shopName,
    health,
    nextToFix,
    products,
    paging,
    states,
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

  const viewCounts: Record<Exclude<View, "all">, number> = {
    attention: health.needsAttention,
    description: health.missingDescription,
    tags: health.missingTags,
  };

  /** Builds a URL for this page. Changing the view or page size starts again at page 1. */
  const go = (
    params: { view?: View; size?: number; search?: string; extra?: string },
    options?: { replace?: boolean },
  ) => {
    const query = new URLSearchParams();
    const nextView = params.view ?? view;
    const nextSize = params.size ?? size;
    const nextSearch = (params.search ?? search).trim();
    if (nextView !== "all") query.set("view", nextView);
    if (nextSize !== PAGE_SIZES[0]) query.set("size", String(nextSize));
    if (nextSearch) query.set("q", nextSearch);
    const extra = params.extra ?? "";
    navigate(`?${[query.toString(), extra].filter(Boolean).join("&")}`, options);
  };

  /** Searches once typing pauses. Replaces the history entry so Back skips keystrokes. */
  const onSearchInput = (event: { currentTarget: EventTarget | null }) => {
    const value = selectValue(event);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => go({ search: value }, { replace: true }),
      SEARCH_DELAY_MS,
    );
  };

  const pageLabel =
    paging.kind === "number"
      ? `${paging.total} product${paging.total === 1 ? "" : "s"} · page ${paging.page} of ${paging.pageCount}`
      : `${products.length} on this page`;
  const emptyMessage = search
    ? `No products with "${search}" in the title match this filter.`
    : "No products match this filter.";

  const prevDisabled =
    isLoading ||
    (paging.kind === "cursor" ? !paging.hasPrevious : paging.page <= 1);
  const nextDisabled =
    isLoading ||
    (paging.kind === "cursor"
      ? !paging.hasNext
      : paging.page >= paging.pageCount);

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
                  />
                  <StatTile
                    icon="alert-circle"
                    tone="critical"
                    label="No description"
                    value={String(health.missingDescription)}
                  />
                  <StatTile
                    icon="hashtag"
                    tone="warning"
                    label="No tags"
                    value={String(health.missingTags)}
                  />
                </s-stack>
                <NextUp
                  product={nextToFix}
                  hasDraft={
                    !!nextToFix && states[nextToFix.id] === "draft"
                  }
                />
              </s-grid>
            </s-query-container>
            <s-text color="subdued">Based on {scope}.</s-text>
          </s-stack>
        </s-section>

        <s-section padding="none">
          {/* Filter bar: one row of view buttons, page size on the right. */}
          <s-box padding="base">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="end"
              justifyContent="space-between"
            >
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small-200">
                  {VIEWS.map((v) => {
                    const label =
                      v === "all"
                        ? VIEW_LABELS[v]
                        : `${VIEW_LABELS[v]} · ${viewCounts[v]}`;
                    return (
                      <s-button
                        key={v}
                        variant={v === view ? "primary" : "secondary"}
                        accessibilityLabel={
                          v === view ? `${label}, selected` : `Show ${label}`
                        }
                        onClick={() => go({ view: v })}
                      >
                        {label}
                      </s-button>
                    );
                  })}
                </s-stack>
                <s-text color="subdued">{pageLabel}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small" alignItems="end">
                <s-search-field
                  label="Search products by title"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search by title"
                  maxLength={MAX_SEARCH_LENGTH}
                  defaultValue={search}
                  onInput={onSearchInput}
                />
                <s-select
                  label="Per page"
                  labelAccessibilityVisibility="exclusive"
                  value={String(size)}
                  onInput={(event) => go({ size: Number(selectValue(event)) })}
                >
                  {PAGE_SIZES.map((n) => (
                    <s-option key={n} value={String(n)}>
                      {`${n} per page`}
                    </s-option>
                  ))}
                </s-select>
              </s-stack>
            </s-stack>
          </s-box>

          {products.length === 0 ? (
            <s-box padding="large">
              <s-stack direction="block" gap="small-200" alignItems="center">
                <s-icon type="check-circle" tone="success" />
                <s-text type="strong">Nothing here</s-text>
                <s-text color="subdued">{emptyMessage}</s-text>
              </s-stack>
            </s-box>
          ) : (
            <ProductTable products={products} states={states} />
          )}

          <s-box padding="base">
            <s-stack
              direction="inline"
              gap="small-200"
              justifyContent="center"
              alignItems="center"
            >
              <s-button
                icon="chevron-left"
                accessibilityLabel="Previous page of products"
                {...(prevDisabled ? { disabled: true } : {})}
                onClick={() =>
                  go({
                    extra:
                      paging.kind === "cursor"
                        ? `before=${encodeURIComponent(paging.startCursor ?? "")}`
                        : `page=${paging.page - 1}`,
                  })
                }
              >
                Previous
              </s-button>
              <s-button
                icon="chevron-right"
                accessibilityLabel="Next page of products"
                {...(nextDisabled ? { disabled: true } : {})}
                onClick={() =>
                  go({
                    extra:
                      paging.kind === "cursor"
                        ? `after=${encodeURIComponent(paging.endCursor ?? "")}`
                        : `page=${paging.page + 1}`,
                  })
                }
              >
                Next
              </s-button>
            </s-stack>
          </s-box>
        </s-section>

        {view !== "all" && health.truncated && (
          <s-text color="subdued">
            Filters cover {scope}. Choose &quot;All products&quot; to browse the
            rest.
          </s-text>
        )}
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
