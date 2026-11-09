import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { StatTile } from "../components/StatTile";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { getHistory } from "../models/suggestion.server";
import { productUrlId } from "../lib/product-id";

const HISTORY_LIMIT = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Always the authenticated shop; there is no way to ask for another shop's history.
  const shop = await getOrCreateShop(session.shop);
  const rows = await getHistory(shop.id, HISTORY_LIMIT);

  return {
    entries: rows.map((row) => {
      const failures = row.publishAttempts.filter(
        (attempt) => attempt.status !== "SUCCEEDED",
      );
      const lastFailure = failures[failures.length - 1];
      return {
        id: row.id,
        productUrlId: productUrlId(row.productId),
        // After a title change, show the product under its new name.
        title: (row.status === "PUBLISHED" && row.approvedTitle) || row.sourceTitle,
        status: row.status,
        date: (row.publishedAt ?? row.decidedAt ?? row.updatedAt).toISOString(),
        changes: describeChanges(row),
        aiModel: row.aiModel,
        failedAttempts: failures.length,
        lastFailure: lastFailure
          ? `${lastFailure.status === "CONFLICT" ? "Conflict" : "Failed"}: ${lastFailure.errorMessage ?? "Unknown error"}`
          : null,
      };
    }),
  };
};

function describeChanges(row: {
  status: string;
  approvedTitle: string | null;
  approvedDescriptionHtml: string | null;
  publishTags: boolean;
  tagMode: string | null;
}) {
  if (row.status === "REJECTED") return "None";
  const parts = [];
  if (row.approvedTitle !== null) parts.push("Title");
  if (row.approvedDescriptionHtml !== null) parts.push("Description");
  if (row.publishTags)
    parts.push(row.tagMode === "REPLACE" ? "Tags (replaced)" : "Tags (added)");
  return parts.join(", ") || "None";
}

const STATUS_BADGES: Record<
  string,
  { label: string; tone: "success" | "neutral" | "critical" | "warning" }
> = {
  PUBLISHED: { label: "Published", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  PENDING: { label: "Not published", tone: "critical" },
  PUBLISHING: { label: "Publishing", tone: "warning" },
  SUPERSEDED: { label: "Replaced", tone: "neutral" },
};

export default function History() {
  const { entries } = useLoaderData<typeof loader>();
  const count = (status: string) =>
    entries.filter((entry) => entry.status === status).length;
  const unresolved = entries.filter(
    (entry) => entry.status === "PENDING",
  ).length;

  return (
    <s-page heading="History">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Every decision and publish attempt for your store. Nothing is
          published without your approval.
        </s-text>
        <s-stack direction="inline" gap="base">
          <StatTile
            icon="check-circle"
            tone="success"
            label="Published"
            value={String(count("PUBLISHED"))}
          />
          <StatTile
            icon="x-circle"
            tone="neutral"
            label="Rejected"
            value={String(count("REJECTED"))}
          />
          <StatTile
            icon="alert-circle"
            tone="critical"
            label="Not published"
            value={String(unresolved)}
          />
        </s-stack>
        <s-section padding="none">
          {entries.length === 0 ? (
            <s-box padding="large">
              <s-stack direction="block" gap="small-200" alignItems="center">
                <s-icon type="clock" tone="neutral" />
                <s-text type="strong">No history yet</s-text>
                <s-text color="subdued">
                  Drafts you publish or reject, and publish attempts that fail,
                  appear here.
                </s-text>
                <Link to="/app">Find a listing to fix</Link>
              </s-stack>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Outcome</s-table-header>
                <s-table-header>Date</s-table-header>
                <s-table-header>Changes</s-table-header>
                <s-table-header>Notes</s-table-header>
                <s-table-header>Model</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {entries.map((entry) => {
                  const badge = STATUS_BADGES[entry.status];
                  return (
                    <s-table-row key={entry.id}>
                      <s-table-cell>
                        <Link to={`/app/products/${entry.productUrlId}`}>
                          {entry.title}
                        </Link>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={badge.tone}>{badge.label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        {new Date(entry.date).toLocaleString()}
                      </s-table-cell>
                      <s-table-cell>{entry.changes}</s-table-cell>
                      <s-table-cell>
                        {entry.lastFailure ? (
                          <s-text
                            tone={
                              entry.status === "PUBLISHED"
                                ? "neutral"
                                : "critical"
                            }
                          >
                            {entry.failedAttempts > 1
                              ? `${entry.failedAttempts} unsuccessful attempts. Last: `
                              : ""}
                            {entry.lastFailure}
                          </s-text>
                        ) : (
                          <s-text color="subdued">None</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>{entry.aiModel}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
        </s-section>
        <s-text color="subdued">
          Showing the latest {HISTORY_LIMIT} entries.
        </s-text>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
