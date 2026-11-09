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
import { parseDecision } from "../lib/decision";
import { productChangedSince } from "../lib/snapshot";
import { parseTagInput, planTagChange, type TagMode } from "../lib/tags";
import type { TitleFormat } from "../lib/title-format";
import { getOrCreateShop, titleFormatOf } from "../models/shop.server";
import {
  createSuggestion,
  getPendingSuggestion,
} from "../models/suggestion.server";
import { buildProductFacts } from "../services/ai/facts";
import { generateSuggestion, getAiProvider } from "../services/ai/index.server";
import { MOCK_MODEL } from "../services/ai/mock.server";
import { AiError } from "../services/ai/types";
import {
  publishSuggestion,
  rejectSuggestion,
  type DecisionOutcome,
} from "../services/publish.server";
import {
  getProduct,
  type ProductDetail,
} from "../services/shopify/products.server";

interface SuggestionView {
  id: string;
  /** Null when the draft has no title suggestion. */
  title: string | null;
  /** The title format the title was generated for. */
  titleTemplate: string | null;
  descriptionText: string;
  tags: string[];
  missingInfo: string[];
  warnings: string[];
  aiModel: string;
  promptVersion: string;
  createdAt: string;
  isMock: boolean;
  /** The product's title, description, or tags changed in Shopify after this suggestion was generated. */
  sourceChanged: boolean;
}

type LoaderData =
  | {
      state: "ok";
      product: ProductDetail;
      suggestion: SuggestionView | null;
      /** The shop's current title format; null when title suggestions are off. */
      titleFormat: TitleFormat | null;
    }
  | { state: "not-found" }
  | { state: "error"; message: string };

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
    titleFormat: titleFormatOf(shop),
    suggestion: pending && {
      id: pending.id,
      title: pending.aiTitle,
      titleTemplate: pending.titleTemplate,
      descriptionText: safeHtmlToText(pending.aiDescriptionHtml),
      tags: pending.aiTags,
      missingInfo: pending.missingInfo,
      warnings: pending.warnings,
      aiModel: pending.aiModel,
      promptVersion: pending.promptVersion,
      createdAt: pending.createdAt.toISOString(),
      isMock: pending.aiModel === MOCK_MODEL,
      sourceChanged: productChangedSince(
        {
          title: pending.sourceTitle,
          descriptionHtml: pending.sourceDescriptionHtml,
          tags: pending.sourceTags,
        },
        product,
      ),
    },
  };
};

type ActionData =
  | { intent: "generate"; ok: true }
  | { intent: "generate"; ok: false; error: string }
  | { intent: "decide"; outcome: DecisionOutcome };

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionData> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reject" || intent === "publish") {
    return {
      intent: "decide",
      outcome: await decide(admin, session.shop, intent, formData),
    };
  }
  if (intent !== "generate") {
    return { intent: "generate", ok: false, error: "Unknown action." };
  }

  const gid = productGidFromUrlId(params.productId);
  if (!gid)
    return { intent: "generate", ok: false, error: "Product not found." };

  try {
    // Always re-read the product: the AI only ever sees current Shopify data.
    const product = await getProduct(admin, gid);
    if (!product)
      return { intent: "generate", ok: false, error: "Product not found." };

    const shop = await getOrCreateShop(session.shop);
    const provider = getAiProvider();
    const { facts, truncated } = buildProductFacts(product);
    const generated = await generateSuggestion(provider, facts, {
      descriptionTruncated: truncated,
      titleFormat: titleFormatOf(shop),
    });

    await createSuggestion({ shopId: shop.id, product, generated });
    return { intent: "generate", ok: true };
  } catch (error) {
    rethrowIfResponse(error);
    if (error instanceof AiError) {
      console.error(
        "AI suggestion failed",
        error.code,
        error.details ?? error.cause,
      );
      return { intent: "generate", ok: false, error: error.userMessage };
    }
    console.error("Suggestion generation failed", error);
    return {
      intent: "generate",
      ok: false,
      error: "Something went wrong while generating the suggestion. Try again.",
    };
  }
};

async function decide(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  shopDomain: string,
  intent: "reject" | "publish",
  formData: FormData,
): Promise<DecisionOutcome> {
  // The shop always comes from the session; the suggestion id is only looked up within it.
  const shop = await getOrCreateShop(shopDomain);
  const suggestionId = String(formData.get("suggestionId") ?? "");

  if (intent === "reject") return rejectSuggestion(shop.id, suggestionId);

  const parsed = parseDecision(formData);
  if (!parsed.ok) return { status: "failed", message: parsed.error };
  return publishSuggestion(admin, shop.id, suggestionId, parsed.decision);
}

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

/** One label/value pair in a two-column grid. */
function Fact({ label, children }: { label: string; children: string }) {
  return (
    <>
      <s-text color="subdued">{label}</s-text>
      <s-text type="strong">{children}</s-text>
    </>
  );
}

function TagChips({ tags, empty }: { tags: string[]; empty: string }) {
  return tags.length ? (
    <s-stack direction="inline" gap="small-200">
      {tags.map((tag) => (
        <s-chip key={tag}>{tag}</s-chip>
      ))}
    </s-stack>
  ) : (
    <s-text color="subdued">{empty}</s-text>
  );
}

type Step = "generate" | "review" | "publish";
const STEPS: { id: Step; label: string }[] = [
  { id: "generate", label: "Generate a draft" },
  { id: "review", label: "Review and edit" },
  { id: "publish", label: "Publish to Shopify" },
];

/** Where the merchant is in the flow. "done" means every step is complete. */
function Steps({ current }: { current: Step | "done" }) {
  const currentIndex =
    current === "done"
      ? STEPS.length
      : STEPS.findIndex((s) => s.id === current);
  return (
    <s-stack direction="inline" gap="large" alignItems="center">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <s-stack
            key={step.id}
            direction="inline"
            gap="small-200"
            alignItems="center"
          >
            <s-icon
              type={
                done
                  ? "check-circle-filled"
                  : active
                    ? "circle"
                    : "circle-dashed"
              }
              tone={done ? "success" : active ? "info" : "neutral"}
            />
            {active ? (
              <s-text type="strong">{step.label}</s-text>
            ) : (
              <s-text color="subdued">{step.label}</s-text>
            )}
          </s-stack>
        );
      })}
    </s-stack>
  );
}

// React 18 passes props to web components as attributes and can't read their
// value properties, so field values are read from the native `input` event.
type FieldEvent = { currentTarget: EventTarget | null };
const fieldValue = (event: FieldEvent) =>
  (event.currentTarget as HTMLElement & { value: string }).value;
const fieldChecked = (event: FieldEvent) =>
  (event.currentTarget as HTMLElement & { checked: boolean }).checked;

// Two equal columns when there's room, stacked otherwise.
const COMPARE_COLUMNS = "@container (inline-size > 600px) 1fr 1fr, 1fr";
// Tag input takes the wider share; the mode select sits beside it.
const TAG_FIELD_COLUMNS = "@container (inline-size > 600px) 2fr 1fr, 1fr";

type DecisionFetcher = ReturnType<typeof useFetcher<typeof action>>;

/**
 * The review screen. Returns the main column and the sidebar cards as siblings
 * so the sidebar cards can use the page's `aside` slot.
 */
function SuggestionReview({
  product,
  suggestion,
  titleFormat,
  generateButton,
  decisionFetcher,
}: {
  product: ProductDetail;
  suggestion: SuggestionView;
  titleFormat: TitleFormat | null;
  generateButton: React.ReactNode;
  decisionFetcher: DecisionFetcher;
}) {
  const [title, setTitle] = useState(suggestion.title ?? "");
  const [description, setDescription] = useState(suggestion.descriptionText);
  const [tagInput, setTagInput] = useState(suggestion.tags.join(", "));
  const [tagMode, setTagMode] = useState<TagMode>("ADD");
  const hasTitle = suggestion.title !== null;
  // A suggested title that matches the current one has nothing to publish.
  const [includeTitle, setIncludeTitle] = useState(
    hasTitle && suggestion.title !== product.title,
  );
  const [includeDescription, setIncludeDescription] = useState(true);
  const [includeTags, setIncludeTags] = useState(true);

  const tagPlan = planTagChange(product.tags, parseTagInput(tagInput), tagMode);
  const descriptionEdited = description.trim() !== suggestion.descriptionText;
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const titleEdited = hasTitle && cleanTitle !== suggestion.title;
  const titleLimit = titleFormat?.maxLength ?? null;
  const titleTooLong = titleLimit !== null && cleanTitle.length > titleLimit;
  const nothingSelected = !includeTitle && !includeDescription && !includeTags;

  const deciding = decisionFetcher.state !== "idle";
  const pendingIntent = deciding
    ? decisionFetcher.formData?.get("intent")
    : null;
  const outcome =
    !deciding && decisionFetcher.data?.intent === "decide"
      ? decisionFetcher.data.outcome
      : null;

  const submitDecision = (intent: "reject" | "publish") =>
    decisionFetcher.submit(
      {
        intent,
        suggestionId: suggestion.id,
        title,
        includeTitle: String(includeTitle),
        description,
        tags: tagInput,
        tagMode,
        includeDescription: String(includeDescription),
        includeTags: String(includeTags),
      },
      { method: "POST" },
    );

  const kept = tagPlan.finalTags.filter((tag) => !tagPlan.added.includes(tag));

  return (
    <>
      <s-stack direction="block" gap="base">
        {suggestion.isMock && (
          <s-banner tone="warning" heading="Mock AI output">
            <s-paragraph>
              This suggestion came from the mock provider (AI_PROVIDER=mock). It
              only rearranges your existing fields and isn&apos;t real AI
              output.
            </s-paragraph>
          </s-banner>
        )}

        {suggestion.sourceChanged && (
          <s-banner tone="warning" heading="This product changed in Shopify">
            <s-paragraph>
              The product was edited after this draft was generated, so it
              can&apos;t be published. Generate a new draft to use the latest
              content.
            </s-paragraph>
          </s-banner>
        )}

        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="block" gap="small-500">
                <s-heading>Title</s-heading>
                <s-text color="subdued">
                  {hasTitle
                    ? `Follows your format: ${suggestion.titleTemplate}`
                    : titleFormat
                      ? "This draft has no title suggestion. Generate a new draft to get one in your format."
                      : "Title suggestions are off."}
                </s-text>
              </s-stack>
              {generateButton}
            </s-stack>
            {hasTitle ? (
              <s-query-container>
                <s-grid gridTemplateColumns={COMPARE_COLUMNS} gap="small">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-badge>Current</s-badge>
                  </s-stack>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-badge tone="info" icon="wand">
                      AI draft
                    </s-badge>
                    {titleEdited && <s-badge>Edited by you</s-badge>}
                    {!titleEdited && suggestion.title === product.title && (
                      <s-badge tone="success">Already matches</s-badge>
                    )}
                  </s-stack>
                  <s-box padding="small" borderRadius="base" background="subdued">
                    <s-text>{product.title}</s-text>
                  </s-box>
                  <s-text-field
                    label="Suggested title"
                    labelAccessibilityVisibility="exclusive"
                    defaultValue={suggestion.title ?? ""}
                    details={
                      titleLimit === null
                        ? `${cleanTitle.length} characters`
                        : `${cleanTitle.length} of ${titleLimit} characters`
                    }
                    {...(titleTooLong
                      ? { error: `Longer than your ${titleLimit}-character limit.` }
                      : {})}
                    onInput={(event) => setTitle(fieldValue(event))}
                  />
                </s-grid>
              </s-query-container>
            ) : (
              !titleFormat && (
                <s-text color="subdued">
                  <Link to="/app/settings">Set a title format</Link> to get
                  title suggestions that give your products one consistent
                  shape.
                </s-text>
              )
            )}
          </s-stack>
        </s-section>

        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-500">
              <s-heading>Description</s-heading>
              <s-text color="subdued">
                Edit the draft on the right. Generating a new draft discards
                your edits.
              </s-text>
            </s-stack>
            <s-query-container>
              {/* Labels share one grid row, so the two boxes below always line up and match in height. */}
              <s-grid gridTemplateColumns={COMPARE_COLUMNS} gap="small">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge>Current</s-badge>
                </s-stack>
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-badge tone="info" icon="wand">
                    AI draft
                  </s-badge>
                  {descriptionEdited && <s-badge>Edited by you</s-badge>}
                </s-stack>
                <s-box padding="base" borderRadius="base" background="subdued">
                  {product.health.missingDescription ? (
                    <s-text color="subdued">No description yet.</s-text>
                  ) : (
                    <s-paragraph>{product.description}</s-paragraph>
                  )}
                </s-box>
                <s-text-area
                  label="Suggested description"
                  labelAccessibilityVisibility="exclusive"
                  details="Plain text. Separate paragraphs with a blank line."
                  rows={10}
                  defaultValue={suggestion.descriptionText}
                  onInput={(event) => setDescription(fieldValue(event))}
                />
              </s-grid>
            </s-query-container>
          </s-stack>
        </s-section>

        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-500">
              <s-heading>Tags</s-heading>
              <s-text color="subdued">
                What the product&apos;s tags will be after publishing.
              </s-text>
            </s-stack>

            <s-box padding="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="small">
                {tagPlan.finalTags.length === 0 ? (
                  <s-text color="subdued">
                    The product will have no tags.
                  </s-text>
                ) : (
                  <s-stack direction="inline" gap="small-200">
                    {kept.map((tag) => (
                      <s-chip key={tag}>{tag}</s-chip>
                    ))}
                    {tagPlan.added.map((tag) => (
                      <s-badge key={tag} tone="success" icon="plus">
                        {tag}
                      </s-badge>
                    ))}
                    {tagPlan.removed.map((tag) => (
                      <s-badge key={tag} tone="critical" icon="minus">
                        {tag}
                      </s-badge>
                    ))}
                  </s-stack>
                )}
                <s-text color="subdued">
                  {[
                    `${kept.length} kept`,
                    `${tagPlan.added.length} added`,
                    `${tagPlan.removed.length} removed`,
                  ].join(" · ")}
                </s-text>
              </s-stack>
            </s-box>

            <s-query-container>
              <s-grid gridTemplateColumns={TAG_FIELD_COLUMNS} gap="base">
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
              </s-grid>
            </s-query-container>
          </s-stack>
        </s-section>

        {suggestion.missingInfo.length > 0 && (
          <s-section>
            <s-stack direction="block" gap="small">
              <s-stack direction="block" gap="small-500">
                <s-heading>Shoppers may also look for</s-heading>
                <s-text color="subdued">
                  Not in your product data, so the AI didn&apos;t add it. Add it
                  yourself if you know it.
                </s-text>
              </s-stack>
              <NoteList items={suggestion.missingInfo} />
            </s-stack>
          </s-section>
        )}
      </s-stack>

      <s-section slot="aside" heading="Review and publish">
        <s-stack direction="block" gap="base">
          {outcome &&
            outcome.status !== "published" &&
            outcome.status !== "rejected" && (
              <s-banner
                tone={outcome.status === "conflict" ? "warning" : "critical"}
                heading="Nothing was published"
              >
                <s-paragraph>{outcome.message}</s-paragraph>
              </s-banner>
            )}

          {/* Warnings sit next to the buttons so they're read before approving. */}
          {suggestion.warnings.length > 0 ? (
            <s-banner
              tone="warning"
              heading={`Check ${suggestion.warnings.length} warning${suggestion.warnings.length === 1 ? "" : "s"}`}
            >
              <NoteList items={suggestion.warnings} />
            </s-banner>
          ) : (
            <s-text color="subdued">
              No warnings. AI drafts can still be wrong: the app checks the
              format, not the facts.
            </s-text>
          )}

          <s-stack direction="block" gap="small-200">
            <s-text type="strong">What to publish</s-text>
            {hasTitle && (
              <s-checkbox
                label="Title"
                details={
                  includeTitle ? `Becomes "${cleanTitle}".` : "Stays as it is."
                }
                {...(includeTitle ? { defaultChecked: true } : {})}
                onChange={(event) => setIncludeTitle(fieldChecked(event))}
              />
            )}
            <s-checkbox
              label="Description"
              details={
                includeDescription
                  ? "Replaced with your draft."
                  : "Stays as it is."
              }
              defaultChecked
              onChange={(event) => setIncludeDescription(fieldChecked(event))}
            />
            <s-checkbox
              label="Tags"
              details={
                !includeTags
                  ? "Stay as they are."
                  : tagMode === "ADD"
                    ? `${tagPlan.added.length} tag${tagPlan.added.length === 1 ? "" : "s"} added.`
                    : `Replaced (${tagPlan.removed.length} removed).`
              }
              defaultChecked
              onChange={(event) => setIncludeTags(fieldChecked(event))}
            />
          </s-stack>

          <s-button
            variant="primary"
            icon="check"
            // Both buttons are disabled while either request is in flight; the server
            // also locks the suggestion, so a second submission can't publish twice.
            {...(deciding || suggestion.sourceChanged || nothingSelected
              ? { disabled: true }
              : {})}
            {...(pendingIntent === "publish" ? { loading: true } : {})}
            onClick={() => submitDecision("publish")}
          >
            Approve &amp; Publish
          </s-button>
          <s-button
            tone="critical"
            variant="secondary"
            {...(deciding ? { disabled: true } : {})}
            {...(pendingIntent === "reject" ? { loading: true } : {})}
            onClick={() => submitDecision("reject")}
          >
            Reject draft
          </s-button>
          <s-text color="subdued">
            {suggestion.sourceChanged
              ? "Publishing is turned off because the product changed in Shopify."
              : nothingSelected
                ? "Choose at least one change to publish."
                : "Nothing changes in Shopify until you approve."}
          </s-text>
          <s-divider />
          <s-text color="subdued">
            Drafted {new Date(suggestion.createdAt).toLocaleString()} by{" "}
            {suggestion.aiModel} · prompt {suggestion.promptVersion}
          </s-text>
        </s-stack>
      </s-section>
    </>
  );
}

export default function ProductReview() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const decisionFetcher = useFetcher<typeof action>();
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

  const { product, suggestion, titleFormat } = data;
  const { health } = product;
  const generationError =
    !isGenerating && fetcher.data?.intent === "generate" && !fetcher.data.ok
      ? fetcher.data.error
      : null;
  // Shown at page level because the review panel disappears once the suggestion is decided.
  const decided =
    decisionFetcher.state === "idle" &&
    decisionFetcher.data?.intent === "decide"
      ? decisionFetcher.data.outcome.status
      : null;

  const step: Step | "done" = suggestion
    ? "review"
    : decided === "published"
      ? "done"
      : "generate";

  const generateButton = (
    <s-button
      variant={suggestion ? "secondary" : "primary"}
      icon="wand"
      // Disabled while a request is in flight so a double click can't start two generations.
      {...(isGenerating ? { loading: true, disabled: true } : {})}
      onClick={() => fetcher.submit({ intent: "generate" }, { method: "POST" })}
    >
      {suggestion ? "Generate a new draft" : "Generate draft"}
    </s-button>
  );

  return (
    <s-page heading="Review listing">
      <s-stack direction="block" gap="base">
        <BackLink />

        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-thumbnail
                size="large"
                alt={product.image?.altText || product.title}
                {...(product.image ? { src: product.image.url } : {})}
              />
              <s-stack direction="block" gap="small-200">
                <s-heading>{product.title}</s-heading>
                <s-text color="subdued">
                  {[product.vendor, product.productType]
                    .filter(Boolean)
                    .join(" · ") || "No vendor or type set"}
                </s-text>
                <s-stack direction="inline" gap="small-200">
                  <s-badge
                    tone={product.status === "ACTIVE" ? "success" : "neutral"}
                  >
                    {product.status.charAt(0) +
                      product.status.slice(1).toLowerCase()}
                  </s-badge>
                  {health.missingDescription && (
                    <s-badge tone="critical">No description</s-badge>
                  )}
                  {health.missingTags && (
                    <s-badge tone="warning">No tags</s-badge>
                  )}
                  {!health.missingDescription && !health.missingTags && (
                    <s-badge tone="success">Listing complete</s-badge>
                  )}
                </s-stack>
              </s-stack>
            </s-stack>
            <s-divider />
            <Steps current={step} />
          </s-stack>
        </s-section>

        {decided === "published" && (
          <s-banner tone="success" heading="Published to Shopify">
            <s-paragraph>
              Shopify confirmed the update. It&apos;s recorded in{" "}
              <Link to="/app/history">History</Link>.
            </s-paragraph>
          </s-banner>
        )}
        {decided === "rejected" && (
          <s-banner tone="info" heading="Draft rejected">
            <s-paragraph>Nothing was changed in Shopify.</s-paragraph>
          </s-banner>
        )}
        {generationError && (
          <s-banner tone="critical" heading="Couldn't generate a draft">
            <s-paragraph>{generationError}</s-paragraph>
          </s-banner>
        )}
      </s-stack>

      {suggestion ? (
        // key resets the editable fields when a new suggestion arrives.
        <SuggestionReview
          key={suggestion.id}
          product={product}
          suggestion={suggestion}
          titleFormat={titleFormat}
          generateButton={generateButton}
          decisionFetcher={decisionFetcher}
        />
      ) : (
        <s-section>
          <s-stack direction="block" gap="base" alignItems="center">
            <s-icon type="wand" tone="info" />
            <s-heading>
              {decided === "published"
                ? "Want another pass?"
                : "Draft a complete listing"}
            </s-heading>
            <s-paragraph>
              Copilot writes a description and tags
              {titleFormat ? ", plus a title in your format," : ""} using only
              the product facts in the sidebar. It won&apos;t invent features, materials,
              certifications, or warranties. You review and edit everything
              before anything is published.
            </s-paragraph>
            {generateButton}
            {isGenerating && (
              <s-text color="subdued">
                Drafting. This usually takes a few seconds.
              </s-text>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Facts the AI can use">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Drafts use only these fields. Edit them in Shopify to give the AI
            more to work with.
          </s-text>
          <s-grid gridTemplateColumns="auto 1fr" gap="small" alignItems="start">
            <Fact label="Type">{product.productType || "Not set"}</Fact>
            <Fact label="Vendor">{product.vendor || "Not set"}</Fact>
            {product.options
              .filter((option) => option.name !== "Title")
              .map((option) => (
                <Fact key={option.name} label={option.name}>
                  {option.values.join(", ")}
                </Fact>
              ))}
          </s-grid>
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">Tags</s-text>
            <TagChips tags={product.tags} empty="None" />
          </s-stack>
          {/* Without a draft, the current description isn't shown anywhere else. Plain text, never rendered as HTML. */}
          {!suggestion && (
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Description</s-text>
              <s-text>
                {health.missingDescription ? "None" : product.description}
              </s-text>
            </s-stack>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
