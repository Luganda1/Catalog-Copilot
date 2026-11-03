import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";

// Phase 1: proves the authenticated Admin GraphQL client and the database both work.
// Phase 2 replaces this page with the real product list.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query CatalogCopilotShopInfo {
        shop {
          name
          myshopifyDomain
        }
        currentAppInstallation {
          accessScopes {
            handle
          }
        }
      }`,
  );
  const { data } = await response.json();
  const shop = await getOrCreateShop(session.shop);

  return {
    shopName: data?.shop?.name ?? session.shop,
    domain: shop.domain,
    // Read granted scopes from Shopify rather than session.scope, which can be stale.
    scopes: (data?.currentAppInstallation?.accessScopes ?? [])
      .map((scope) => scope.handle)
      .join(", "),
  };
};

export default function Index() {
  const { shopName, domain, scopes } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Products">
      <s-section heading="Connected">
        <s-paragraph>
          Catalog Copilot is connected to <s-text type="strong">{shopName}</s-text>{" "}
          ({domain}).
        </s-paragraph>
        <s-paragraph>
          <s-text color="subdued">Granted scopes: {scopes || "none"}</s-text>
        </s-paragraph>
      </s-section>
      <s-section heading="Product list">
        <s-paragraph>The product list is implemented in Phase 2.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
