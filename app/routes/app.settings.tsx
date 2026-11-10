import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  DEFAULT_TITLE_MAX_LENGTH,
  DEFAULT_TITLE_TEMPLATE,
  exampleTitle,
  MAX_TEMPLATE_LENGTH,
  MIN_TITLE_MAX_LENGTH,
  parseTitleFormat,
  PLACEHOLDER_HELP,
  SHOPIFY_TITLE_MAX_LENGTH,
  TITLE_PLACEHOLDERS,
} from "../lib/title-format";
import {
  getOrCreateShop,
  saveTitleFormat,
  titleFormatOf,
} from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Always the authenticated shop's own settings.
  const shop = await getOrCreateShop(session.shop);
  return { titleFormat: titleFormatOf(shop) };
};

type ActionData =
  | { ok: true; enabled: boolean }
  | { ok: false; errors: { template?: string; maxLength?: string } };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const form = await request.formData();

  if (form.get("intent") === "disable") {
    await saveTitleFormat(shop.id, null);
    return { ok: true, enabled: false };
  }

  const parsed = parseTitleFormat(form.get("template"), form.get("maxLength"));
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  await saveTitleFormat(shop.id, parsed.format);
  return { ok: true, enabled: true };
};

// React 18 passes props to web components as attributes and can't read their
// value properties, so field values are read from the native `input` event.
const fieldValue = (event: { currentTarget: EventTarget | null }) =>
  (event.currentTarget as HTMLElement & { value: string }).value;

export default function Settings() {
  const { titleFormat } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [template, setTemplate] = useState(
    titleFormat?.template ?? DEFAULT_TITLE_TEMPLATE,
  );
  const [maxLength, setMaxLength] = useState(
    String(titleFormat?.maxLength ?? DEFAULT_TITLE_MAX_LENGTH),
  );

  const saving = fetcher.state !== "idle";
  const savingIntent = saving ? fetcher.formData?.get("intent") : null;
  const result = !saving ? fetcher.data : undefined;
  const errors = result && !result.ok ? result.errors : {};

  // Preview while typing; errors only appear after Save so typing isn't interrupted.
  const preview = parseTitleFormat(template, maxLength);
  const example = preview.ok ? exampleTitle(preview.format.template) : null;

  return (
    <s-page heading="Settings">
      <s-section heading="Title format">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            When a format is set, drafts include a title that follows it, so
            your product titles share one shape. You still review every title
            before it&apos;s published. Titles only use facts from the product;
            a placeholder with no matching fact is left out and flagged.
          </s-paragraph>

          {result?.ok && (
            <s-banner tone="success">
              <s-paragraph>
                {result.enabled
                  ? "Title format saved. New drafts will suggest titles in this format."
                  : "Title suggestions are off. New drafts won't change titles."}
              </s-paragraph>
            </s-banner>
          )}

          {!titleFormat && !result?.ok && (
            <s-banner tone="info">
              <s-paragraph>
                Title suggestions are off. Save a format to turn them on.
              </s-paragraph>
            </s-banner>
          )}

          <s-text-field
            label="Format"
            details={`Use the placeholders below with any separators, such as – or |. Up to ${MAX_TEMPLATE_LENGTH} characters.`}
            defaultValue={template}
            {...(errors.template ? { error: errors.template } : {})}
            onInput={(event) => setTemplate(fieldValue(event))}
          />
          <s-number-field
            label="Maximum title length"
            details={`Between ${MIN_TITLE_MAX_LENGTH} and ${SHOPIFY_TITLE_MAX_LENGTH} characters. Around 70 keeps titles readable in search results.`}
            min={MIN_TITLE_MAX_LENGTH}
            max={SHOPIFY_TITLE_MAX_LENGTH}
            defaultValue={maxLength}
            {...(errors.maxLength ? { error: errors.maxLength } : {})}
            onInput={(event) => setMaxLength(fieldValue(event))}
          />

          <s-box padding="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="small-300">
              <s-text color="subdued">Example</s-text>
              {example ? (
                <s-text type="strong">{example}</s-text>
              ) : (
                <s-text color="subdued">
                  Fix the format to see an example.
                </s-text>
              )}
            </s-stack>
          </s-box>

          <s-stack direction="block" gap="small-200">
            <s-text type="strong">Placeholders</s-text>
            <s-grid gridTemplateColumns="auto 1fr" gap="small">
              {TITLE_PLACEHOLDERS.map((placeholder) => (
                <PlaceholderRow key={placeholder} name={placeholder} />
              ))}
            </s-grid>
          </s-stack>

          <s-stack direction="inline" gap="small">
            <s-button
              variant="primary"
              {...(saving ? { disabled: true } : {})}
              {...(savingIntent === "save" ? { loading: true } : {})}
              onClick={() =>
                fetcher.submit(
                  { intent: "save", template, maxLength },
                  { method: "POST" },
                )
              }
            >
              Save
            </s-button>
            {titleFormat && (
              <s-button
                variant="secondary"
                {...(saving ? { disabled: true } : {})}
                {...(savingIntent === "disable" ? { loading: true } : {})}
                onClick={() =>
                  fetcher.submit({ intent: "disable" }, { method: "POST" })
                }
              >
                Turn off title suggestions
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function PlaceholderRow({ name }: { name: (typeof TITLE_PLACEHOLDERS)[number] }) {
  return (
    <>
      <s-text type="strong">{`{${name}}`}</s-text>
      <s-text color="subdued">{PLACEHOLDER_HELP[name]}</s-text>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
