import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import db from "../db.server";

// Phase 1 shell: a shop-scoped count. Phase 4 adds the full change history.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const suggestionCount = await db.suggestion.count({
    where: { shopId: shop.id },
  });
  return { suggestionCount };
};

export default function History() {
  const { suggestionCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading="History">
      <s-section>
        {suggestionCount === 0 ? (
          <s-paragraph>
            No suggestions yet. Reviewed and published changes will appear
            here.
          </s-paragraph>
        ) : (
          <s-paragraph>{suggestionCount} suggestions recorded.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
