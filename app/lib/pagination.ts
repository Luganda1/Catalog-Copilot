export const PRODUCTS_PAGE_SIZE = 20;

/** Page sizes a merchant can pick on the products page. 100 stays well under Shopify's query cost limit. */
export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** Reads `?size=`; anything other than an allowed size falls back to the default. */
export function parsePageSize(searchParams: URLSearchParams): PageSize {
  const size = Number(searchParams.get("size"));
  return PAGE_SIZES.find((allowed) => allowed === size) ?? PRODUCTS_PAGE_SIZE;
}

/** Reads `?page=` (1-based) for lists paged in memory; invalid values mean page 1. */
export function parsePageNumber(searchParams: URLSearchParams): number {
  const page = Number(searchParams.get("page"));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

// Shopify cursors are opaque base64-ish strings. Reject anything else rather
// than forwarding arbitrary input into a GraphQL variable.
const CURSOR_PATTERN = /^[A-Za-z0-9+/=_-]{1,512}$/;

export type PageArgs =
  { first: number; after: string | null } | { last: number; before: string };

/**
 * Converts `?after=` / `?before=` search params into GraphQL connection args.
 * Invalid or missing cursors fall back to the first page.
 */
export function parsePageArgs(
  searchParams: URLSearchParams,
  pageSize = PRODUCTS_PAGE_SIZE,
): PageArgs {
  const after = searchParams.get("after");
  const before = searchParams.get("before");

  if (after && CURSOR_PATTERN.test(after)) {
    return { first: pageSize, after };
  }
  if (before && CURSOR_PATTERN.test(before)) {
    return { last: pageSize, before };
  }
  return { first: pageSize, after: null };
}
