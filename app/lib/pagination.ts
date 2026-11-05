export const PRODUCTS_PAGE_SIZE = 20;

// Shopify cursors are opaque base64-ish strings. Reject anything else rather
// than forwarding arbitrary input into a GraphQL variable.
const CURSOR_PATTERN = /^[A-Za-z0-9+/=_-]{1,512}$/;

export type PageArgs =
  | { first: number; after: string | null }
  | { last: number; before: string };

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
