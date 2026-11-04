/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type CatalogCopilotShopInfoQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type CatalogCopilotShopInfoQuery = { shop: Pick<AdminTypes.Shop, 'name' | 'myshopifyDomain'>, currentAppInstallation: { accessScopes: Array<Pick<AdminTypes.AccessScope, 'handle'>> } };

export type CatalogCopilotProductsQueryVariables = AdminTypes.Exact<{
  first?: AdminTypes.InputMaybe<AdminTypes.Scalars['Int']['input']>;
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
  last?: AdminTypes.InputMaybe<AdminTypes.Scalars['Int']['input']>;
  before?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type CatalogCopilotProductsQuery = { products: { nodes: Array<(
      Pick<AdminTypes.Product, 'id' | 'title' | 'status' | 'tags' | 'description'>
      & { featuredMedia?: AdminTypes.Maybe<{ preview?: AdminTypes.Maybe<{ image?: AdminTypes.Maybe<Pick<AdminTypes.Image, 'url' | 'altText'>> }> }> }
    )>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'hasPreviousPage' | 'startCursor' | 'endCursor'> } };

export type CatalogCopilotProductQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type CatalogCopilotProductQuery = { product?: AdminTypes.Maybe<(
    Pick<AdminTypes.Product, 'id' | 'title' | 'status' | 'handle' | 'descriptionHtml' | 'description' | 'tags' | 'productType' | 'vendor'>
    & { options: Array<(
      Pick<AdminTypes.ProductOption, 'name'>
      & { optionValues: Array<Pick<AdminTypes.ProductOptionValue, 'name'>> }
    )>, featuredMedia?: AdminTypes.Maybe<{ preview?: AdminTypes.Maybe<{ image?: AdminTypes.Maybe<Pick<AdminTypes.Image, 'url' | 'altText'>> }> }> }
  )> };

interface GeneratedQueryTypes {
  "#graphql\n      query CatalogCopilotShopInfo {\n        shop {\n          name\n          myshopifyDomain\n        }\n        currentAppInstallation {\n          accessScopes {\n            handle\n          }\n        }\n      }": {return: CatalogCopilotShopInfoQuery, variables: CatalogCopilotShopInfoQueryVariables},
  "#graphql\n  query CatalogCopilotProducts($first: Int, $after: String, $last: Int, $before: String) {\n    products(first: $first, after: $after, last: $last, before: $before, sortKey: TITLE) {\n      nodes {\n        id\n        title\n        status\n        tags\n        description(truncateAt: 120)\n        featuredMedia {\n          preview {\n            image {\n              url(transform: { maxWidth: 120, maxHeight: 120 })\n              altText\n            }\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        hasPreviousPage\n        startCursor\n        endCursor\n      }\n    }\n  }": {return: CatalogCopilotProductsQuery, variables: CatalogCopilotProductsQueryVariables},
  "#graphql\n  query CatalogCopilotProduct($id: ID!) {\n    product(id: $id) {\n      id\n      title\n      status\n      handle\n      descriptionHtml\n      description\n      tags\n      productType\n      vendor\n      options {\n        name\n        optionValues {\n          name\n        }\n      }\n      featuredMedia {\n        preview {\n          image {\n            url(transform: { maxWidth: 400, maxHeight: 400 })\n            altText\n          }\n        }\n      }\n    }\n  }": {return: CatalogCopilotProductQuery, variables: CatalogCopilotProductQueryVariables},
}

interface GeneratedMutationTypes {
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
