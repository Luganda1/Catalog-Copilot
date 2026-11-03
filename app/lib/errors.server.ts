/**
 * authenticate.admin() and the Admin GraphQL client signal re-authentication
 * (and similar flows) by throwing a Response. Those must propagate so the
 * Shopify library can handle them; only genuine failures should be caught.
 */
export function rethrowIfResponse(error: unknown): void {
  if (error instanceof Response) throw error;
}
