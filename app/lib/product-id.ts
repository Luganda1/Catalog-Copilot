const PRODUCT_GID_PREFIX = "gid://shopify/Product/";

/**
 * Product GIDs are kept as strings everywhere. In URLs we use only the trailing
 * numeric part, e.g. /app/products/123 ↔ gid://shopify/Product/123.
 */
export function productUrlId(gid: string): string {
  if (!gid.startsWith(PRODUCT_GID_PREFIX)) {
    throw new Error(`Not a product GID: ${gid}`);
  }
  return gid.slice(PRODUCT_GID_PREFIX.length);
}

/** Returns null for anything that isn't a plain numeric id, so routes can 404. */
export function productGidFromUrlId(urlId: string | undefined): string | null {
  if (!urlId || !/^\d{1,20}$/.test(urlId)) return null;
  return `${PRODUCT_GID_PREFIX}${urlId}`;
}
