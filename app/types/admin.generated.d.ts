/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type CatalogCopilotShopInfoQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type CatalogCopilotShopInfoQuery = { shop: Pick<AdminTypes.Shop, 'name' | 'myshopifyDomain'>, currentAppInstallation: { accessScopes: Array<Pick<AdminTypes.AccessScope, 'handle'>> } };

interface GeneratedQueryTypes {
  "#graphql\n      query CatalogCopilotShopInfo {\n        shop {\n          name\n          myshopifyDomain\n        }\n        currentAppInstallation {\n          accessScopes {\n            handle\n          }\n        }\n      }": {return: CatalogCopilotShopInfoQuery, variables: CatalogCopilotShopInfoQueryVariables},
}

interface GeneratedMutationTypes {
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
