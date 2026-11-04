import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { rethrowIfResponse } from "../lib/errors.server";
import { safeHtmlToText } from "../lib/html";
import { productGidFromUrlId } from "../lib/product-id";
import { parseTagInput, planTagChange, type TagMode } from "../lib/tags";
import { getOrCreateShop } from "../models/shop.server";
import {
  createSuggestion,
  getPendingSuggestion,
} from "../models/suggestion.server";
import { buildProductFacts } from "../services/ai/facts";
import { generateSuggestion, getAiProvider } from "../services/ai/index.server";
import { MOCK_MODEL } from "../services/ai/mock.server";
import { AiError } from "../services/ai/types";
import {
  getProduct,
  type ProductDetail,
} from "../services/shopify/products.server";

interface SuggestionView {
  id: string;
  descriptionText: string;
  tags: string[];
  missingInfo: string[];
  warnings: string[];
  aiModel: string;
  promptVersion: string;
  createdAt: string;
  isMock: boolean;
  /** The product's description or tags changed in Shopify after this suggestion was generated. */
  sourceChanged: boolean;
}

type LoaderData =
  | { state: "ok"; product: ProductDetail; suggestion: SuggestionView | null }
  | { state: "not-found" }
  | { state: "error"; message: string };

function sameTags(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

export const loader = async ({
  request,
  params,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);

  const gid = productGidFromUrlId(params.productId);
  if (!gid) return { state: "not-found" };

  let product: ProductDetail | null;
  try {
    // admin.graphql is bound to the authenticated shop, so a product id from
    // another store simply returns null here.
    product = await getProduct(admin, gid);
  } catch (error) {
    rethrowIfResponse(error);
    console.error("Failed to load product", error);
    return {
      state: "error",
      message: "Shopify didn't return this product. Try again in a moment.",
    };
  }
  if (!product) return { state: "not-found" };

  const shop = await getOrCreateShop(session.shop);
  const pending = await getPendingSuggestion(shop.id, product.id);

  return {
    state: "ok",
    product,
    suggestion: pending && {
      id: pending.id,
      descriptionText: safeHtmlToText(pending.aiDescriptionHtml),
      tags: pending.aiTags,
      missingInfo: pending.missingInfo,
      warnings: pending.warnings,
      aiModel: pending.aiModel,
      promptVersion: pending.promptVersion,
      createdAt: pending.createdAt.toISOString(),
      isMock: pending.aiModel === MOCK_MODEL,
      sourceChanged:
        pending.sourceDescriptionHtml !== product.descriptionHtml ||
        !sameTags(pending.sourceTags, product.tags),
    },
  };
};

type ActionData = { ok: true } | { ok: false; error: string };

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "generate") {
    return { ok: false, error: "Unknown action." };
  }

  const gid = productGidFromUrlId(params.productId);
  if (!gid) return { ok: false, error: "Product not found." };

  try {
    // Always re-read the product: the AI only ever sees current Shopify data.
    const product = await getProduct(admin, gid);
    if (!product) return { ok: false, error: "Product not found." };

    const provider = getAiProvider();
    const { facts, truncated } = buildProductFacts(product);
    const generated = await generateSuggestion(provider, facts, {
      descriptionTruncated: truncated,
    });

    const shop = await getOrCreateShop(session.shop);
    await createSuggestion({ shopId: shop.id, product, generated });
    return { ok: true };
  } catch (error) {
    rethrowIfResponse(error);
    if (error instanceof AiError) {
      console.error("AI suggestion failed", error.code, error.details ?? error.cause);
      return { ok: false, error: error.userMessage };
    }
    console.error("Suggestion generation failed", error);
    return {
      ok: false,
      error: "Something went wrong while generating the suggestion. Try again.",
    };
  }
};

function BackLink() {
  return <Link to="/app">← Back to products</Link>;
}

function NoteList({ items }: { items: string[] }) {
  return (
    <s-unordered-list>
      {items.map((item) => (
        <s-list-item key={item}>{item}</s-list-item>
      ))}
    </s-unordered-list>
  );
}

function TagList({ tags, empty }: { tags: string[]; empty: string }) {
  return tags.length ? (
    <s-paragraph>{tags.join(", ")}</s-paragraph>
  ) : (
    <s-paragraph>
      <s-text color="subdued">{empty}</s-text>
    </s-paragraph>
  );
}

// React 18 passes props to web components as attributes and can't read their
// value properties, so field values are read from the native `input` event.
type FieldEvent = { currentTarget: EventTarget | null };
const fieldValue = (event: FieldEvent) =>
  (event.currentTarget as HTMLElement & { value: string }).value;

function SuggestionReview({
  product,
  suggestion,
  generateButton,
}: {
  product: ProductDetail;
  suggestion: SuggestionView;
  generateButton: React.ReactNode;
}) {
  const [description, setDescription] = useState(suggestion.descriptionText);
  const [tagInput, setTagInput] = useState(suggestion.tags.join(", "));
  const [tagMode, setTagMode] = useState<TagMode>("ADD");

  const tagPlan = planTagChange(product.tags, parseTagInput(tagInput), tagMode);
  const descriptionEdited = description.trim() !== suggestion.descriptionText;

  return (
    <s-stack direction="block" gap="base">
      {suggestion.isMock && (
        <s-banner tone="warning" heading="Mock AI output">
          <s-paragraph>
            This suggestion came from the mock provider (AI_PROVIDER=mock). It
            only rearranges your existing fields and isn&apos;t real AI output.
          </s-paragraph>
        </s-banner>
      )}

      <s-banner tone="info" heading="Review before publishing">
        <s-paragraph>
          AI suggestions can be wrong. The app checks that the response has the
          expected format, but that can&apos;t confirm the content is accurate.
          Check every claim against your product before you publish.
        </s-paragraph>
      </s-banner>

      {suggestion.sourceChanged && (
        <s-banner tone="warning" heading="This product changed in Shopify">
          <s-paragraph>
            The product&apos;s description or tags were edited after this
            suggestion was generated. Generate a new suggestion to use the
            latest content.
          </s-paragraph>
        </s-banner>
      )}

      {suggestion.warnings.length > 0 && (
        <s-banner tone="warning" heading="Check these before publishing">
          <NoteList items={suggestion.warnings} />
        </s-banner>
      )}

      {suggestion.missingInfo.length > 0 && (
        <s-banner tone="info" heading="Information shoppers may look for">
          <s-paragraph>
            The AI didn&apos;t add these because they aren&apos;t in your
            product data. Add them yourself if you know them.
          </s-paragraph>
          <NoteList items={suggestion.missingInfo} />
        </s-banner>
      )}

      <s-section heading="Description">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-grid-item>
            <s-stack direction="block" gap="small-200">
              <s-heading>Current</s-heading>
              {product.health.missingDescription ? (
                <s-paragraph>
                  <s-text color="subdued">No description.</s-text>
                </s-paragraph>
              ) : (
                <s-paragraph>{product.description}</s-paragraph>
              )}
            </s-stack>
          </s-grid-item>
          <s-grid-item>
            <s-text-area
              label="Suggested description"
              details={
                descriptionEdited
                  ? "Edited. Plain text; separate paragraphs with a blank line."
                  : "Plain text; separate paragraphs with a blank line."
              }
              rows={12}
              defaultValue={suggestion.descriptionText}
              onInput={(event) => setDescription(fieldValue(event))}
            />
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-section heading="Tags">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-grid-item>
            <s-stack direction="block" gap="small-200">
              <s-heading>Current</s-heading>
              <TagList tags={product.tags} empty="No tags." />
            </s-stack>
          </s-grid-item>
          <s-grid-item>
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Suggested tags"
                details="Separate tags with commas."
                defaultValue={suggestion.tags.join(", ")}
                onInput={(event) => setTagInput(fieldValue(event))}
              />
              <s-select
                label="How to apply tags"
                value={tagMode}
                onInput={(event) => setTagMode(fieldValue(event) as TagMode)}
              >
                <s-option value="ADD">Add to the existing tags</s-option>
                <s-option value="REPLACE">Replace all existing tags</s-option>
              </s-select>
            </s-stack>
          </s-grid-item>
        </s-grid>

        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack direction="block" gap="small-200">
            <s-text type="strong">
              {tagMode === "ADD"
                ? "Tags will be added. Existing tags are kept."
                : "Tags will be replaced. Existing tags not in your list are removed."}
            </s-text>
            <s-text>
              After publishing: {tagPlan.finalTags.join(", ") || "no tags"}
            </s-text>
            {tagPlan.added.length > 0 && (
              <s-text>Adding: {tagPlan.added.join(", ")}</s-text>
            )}
            {tagPlan.removed.length > 0 && (
              <s-text tone="critical">
                Removing: {tagPlan.removed.join(", ")}
              </s-text>
            )}
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Decision">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Nothing is published until you approve it. Reject and Approve &amp;
            Publish are implemented in Phase 4.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button disabled>Reject</s-button>
            <s-button variant="primary" disabled>
              Approve &amp; Publish
            </s-button>
          </s-stack>
          <s-paragraph>
            <s-text color="subdued">
              Generating again replaces this suggestion and discards your edits.
            </s-text>
          </s-paragraph>
          {generateButton}
          <s-text color="subdued">
            Generated {new Date(suggestion.createdAt).toLocaleString()} by{" "}
            {suggestion.aiModel} · prompt {suggestion.promptVersion}
          </s-text>
        </s-stack>
      </s-section>
    </s-stack>
  );
}

export default function ProductReview() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const isGenerating = fetcher.state !== "idle";

  if (data.state === "not-found") {
    return (
      <s-page heading="Product not found">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              This product doesn&apos;t exist in your store, or it was deleted.
            </s-paragraph>
            <BackLink />
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (data.state === "error") {
    return (
      <s-page heading="Review product">
        <s-banner tone="critical" heading="Couldn't load this product">
          <s-paragraph>{data.message}</s-paragraph>
          <s-button
            onClick={() => revalidator.revalidate()}
            {...(revalidator.state === "loading" ? { loading: true } : {})}
          >
            Try again
          </s-button>
        </s-banner>
        <BackLink />
      </s-page>
    );
  }

  const { product, suggestion } = data;
  const { health } = product;
  const generationError =
    !isGenerating && fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  const generateButton = (
    <s-button
      variant={suggestion ? "secondary" : "primary"}
      // Disabled while a request is in flight so a double click can't start two generations.
      {...(isGenerating ? { loading: true, disabled: true } : {})}
      onClick={() => fetcher.submit({ intent: "generate" }, { method: "POST" })}
    >
      {suggestion ? "Generate a new suggestion" : "Generate suggestion"}
    </s-button>
  );

  return (
    <s-page heading={product.title}>
      <s-stack direction="block" gap="base">
        <BackLink />

        {generationError && (
          <s-banner tone="critical" heading="Couldn't generate a suggestion">
            <s-paragraph>{generationError}</s-paragraph>
          </s-banner>
        )}

        {(health.missingDescription || health.missingTags) && (
          <s-banner tone="warning" heading="This listing is incomplete">
            <s-unordered-list>
              {health.missingDescription && (
                <s-list-item>The product has no description.</s-list-item>
              )}
              {health.missingTags && (
                <s-list-item>The product has no tags.</s-list-item>
              )}
            </s-unordered-list>
          </s-banner>
        )}

        {suggestion ? (
          // key resets the editable fields when a new suggestion arrives.
          <SuggestionReview
            key={suggestion.id}
            product={product}
            suggestion={suggestion}
            generateButton={generateButton}
          />
        ) : (
          <s-section heading="AI suggestion">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Draft a description and tags using only the facts below. You
                can review and edit everything before anything is published.
              </s-paragraph>
              {isGenerating && (
                <s-paragraph>
                  <s-text color="subdued">
                    Generating. This can take up to a minute.
                  </s-text>
                </s-paragraph>
              )}
              <s-stack direction="inline">{generateButton}</s-stack>
            </s-stack>
          </s-section>
        )}

        <s-section heading="Product facts sent to the AI">
          <s-stack direction="block" gap="small-200">
            <s-text>
              <s-text type="strong">Title:</s-text> {product.title}
            </s-text>
            <s-text>
              <s-text type="strong">Type:</s-text>{" "}
              {product.productType || "Not set"}
            </s-text>
            <s-text>
              <s-text type="strong">Vendor:</s-text> {product.vendor || "Not set"}
            </s-text>
            <s-text>
              <s-text type="strong">Tags:</s-text>{" "}
              {product.tags.length ? product.tags.join(", ") : "None"}
            </s-text>
            {product.options
              .filter((option) => option.name !== "Title")
              .map((option) => (
                <s-text key={option.name}>
                  <s-text type="strong">{option.name}:</s-text>{" "}
                  {option.values.join(", ")}
                </s-text>
              ))}
            <s-text type="strong">Current description:</s-text>
            {/* Plain text (Shopify's HTML-stripped field) so merchant HTML is never rendered unsanitized. */}
            <s-paragraph>
              {health.missingDescription ? "None" : product.description}
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-stack>

      {product.image && (
        <s-section slot="aside" heading="Image">
          <s-image
            src={product.image.url}
            alt={product.image.altText || product.title}
            borderRadius="base"
          />
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
