# Catalog Copilot

An embedded Shopify app that helps merchants find incomplete product listings, draft grounded descriptions and tags with AI, and review every change before it is published to Shopify.

> **Status: Phase 4 of 5 (approved publishing and history).**
> The evaluation set, deployment guide, and final docs come in Phase 5. See [Roadmap](#roadmap).

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| App framework | [Shopify React Router app template](https://github.com/Shopify/shopify-app-template-react-router) (TypeScript) | Shopify's currently recommended template; one full-stack app (loaders/actions run on the server) |
| Shopify API | GraphQL Admin API `2026-10` | Latest stable version at time of writing; pinned in `app/shopify.server.ts` and `shopify.app.toml` |
| Auth & sessions | Template's `authenticate.admin` (embedded auth + token exchange) with `@shopify/shopify-app-session-storage-prisma` | No custom auth code |
| UI | Polaris web components (`<s-page>`, `<s-section>`, …) + App Bridge | What the template ships with; renders natively inside Shopify admin |
| Database | PostgreSQL + Prisma 6 | Persistent, multi-instance-safe storage (the template's SQLite default only suits single-instance apps) |
| AI | Provider module (`app/services/ai/`): **Groq** (`openai/gpt-oss-120b`, free tier, the default) or Claude (`claude-opus-5-5`), selected with `AI_PROVIDER` | Server-only; strict structured output plus the same server-side validation for every provider; a labelled mock provider for keyless development |

## Architecture (short)

```
Shopify admin (iframe)
  └─ Catalog Copilot UI (React, Polaris web components)
        │  same-origin requests with a Shopify session token
        ▼
  React Router server (loaders / actions)
    ├─ authenticate.admin(request) → session.shop + Admin GraphQL client
    ├─ Admin GraphQL API ── reads products (live source of truth), later updates them
    ├─ AI provider module ── called only from server code
    └─ Prisma → PostgreSQL
          Session, Shop, Suggestion, PublishAttempt
```

Key rules the code follows:

- **Shopify is the source of truth.** We store only the snapshot a suggestion was based on, the AI output, the merchant's decision, and publish attempts. The catalog itself is never copied.
- **Every record belongs to a shop.** The shop is always derived from the authenticated session (`session.shop`), never from request input. `PublishAttempt` references `Suggestion` by `(id, shopId)`, so the database rejects an attempt that points at another shop's suggestion.
- **Least privilege.** The app requests `read_products` and `write_products` only. `write_products` was added in Phase 4, when publishing arrived; nothing else (orders, customers, themes) is requested.

### Data model (`prisma/schema.prisma`)

- `Session`: required by the Shopify session adapter (unchanged from the template).
- `Shop`: one row per installed store (`domain` is unique); `uninstalledAt` is set by the `app/uninstalled` webhook.
- `Suggestion`: product GID (string), source snapshot (title, description HTML, tags), validated AI output (description, tags, missing info, warnings, model, prompt version), the merchant's approved fields, and a status (`PENDING → PUBLISHING → PUBLISHED`, or `REJECTED`).
- `PublishAttempt`: an append-only log of each publish try (`SUCCEEDED` / `FAILED` / `CONFLICT`) with the payload and any error details.

## Local setup

### Prerequisites

- Node.js ≥ 22.12
- [Shopify CLI](https://shopify.dev/docs/apps/build/cli-for-apps) (`npm i -g @shopify/cli`)
- A [Shopify Partner account](https://partners.shopify.com/) and a [development store](https://shopify.dev/docs/apps/build/dev-dashboard/development-stores)
- Docker (for local PostgreSQL), or any PostgreSQL 14+ instance

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL (creates catalog_copilot and catalog_copilot_test databases)
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env          # DATABASE_URL already matches docker-compose.yml
#    For real AI suggestions set GROQ_API_KEY (free key: https://console.groq.com/keys),
#    or AI_PROVIDER=anthropic with ANTHROPIC_API_KEY.
#    Without a key, set AI_PROVIDER=mock to get clearly labelled placeholder output.

# 4. Apply database migrations
npx prisma migrate deploy

# 5. Link this code to an app in your Partner account (first run only).
#    Choose "create a new app" and name it Catalog Copilot. This fills client_id in shopify.app.toml.
npm run config:link

# 6. Run the app. The CLI opens a tunnel, injects SHOPIFY_API_KEY / SECRET / APP_URL / SCOPES,
#    and gives you a URL to install the app on your development store.
npm run dev
```

Press `p` in the CLI to open the app and install it on the development store. The **Products** page lists your store's products (20 per page) with their status, whether the description is missing, and their tags. Click a product title to open its review page.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the app via Shopify CLI |
| `npm run typecheck` | React Router type generation + `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest, no database needed) |
| `npm run test:integration` | Integration tests against the `catalog_copilot_test` database (needs `docker compose up -d postgres`) |
| `npm run build` | Production build |
| `npm run graphql-codegen` | Regenerate Admin API types from `#graphql` queries |
| `npx prisma migrate dev --name <name>` | Create a new migration after editing the schema |
| `npx prisma studio` | Browse the database |

## Product list (Phase 2)

- `app/services/shopify/products.server.ts` reads products live with cursor pagination (`first`/`after`, `last`/`before`); nothing is stored.
- `app/lib/listing.ts` flags listings with plain code: a description is missing if Shopify's HTML-stripped `description` is empty or whitespace; tags are missing if there are none (or only blank ones).
- Product IDs stay strings. URLs use the numeric suffix (`/app/products/123`), which is validated and turned back into `gid://shopify/Product/123`.
- Auth failures are thrown `Response`s and always propagate; only real API failures are caught and shown as an error banner with **Try again**.
- React 18 sets props on Polaris web components as HTML attributes, so boolean props (`loading`, `disabled`) are only spread in when true, and pagination uses buttons with `onClick` rather than the table's custom `onNextPage` event.

## AI suggestions (Phase 3)

Flow: **Generate** → re-read the product from Shopify → build `ProductFacts` → provider → `validateSuggestionOutput` → save → review screen.

- **Facts only.** `buildProductFacts` sends title, plain-text description, type, vendor, tags, and options. Nothing else is sent. HTML is stripped, so hidden markup or comments in a description never reach the model.
- **Untrusted data.** The system prompt holds every rule. Product data goes in a `<product_facts>` JSON block with `<` escaped, so description text can't close the block. The prompt tells the model to ignore instructions inside the facts and to raise a warning when it finds them.
- **Structured output.** Groq: Chat Completions with `response_format: json_schema, strict: true` (constrained decoding), called with `fetch`. Claude: `client.beta.messages.parse()` with a Zod format returns `description`, `tags`, `missingInformation`, and `warnings`. Server-side fallbacks (`fallbacks: "default"`) retry a declined request on a fallback model inside the same call. The model that actually answered is stored.
- **Server-side validation.** A stricter Zod schema checks every provider's output: lengths, tag count and format, no HTML, no extra fields. Invalid output is never saved or shown. **Passing validation proves the shape, not the facts**, and the review screen says so.
- **Stored safely.** The plain-text description is escaped into `<p>` HTML by the app (`textToSafeHtml`). Every suggestion records its model, prompt version, and the product snapshot.
- **One pending suggestion per product.** Regenerating marks the previous one `SUPERSEDED` in the same transaction.
- **Review screen.** Current and suggested content side by side, an editable description and tags, a choice between **Add to the existing tags** and **Replace all existing tags** with a preview of what will be added or removed, and banners for warnings, missing information, mock output, and products edited since generation. A merchant chooses what to publish (description, tags, or both) and then **Reject** or **Approve & Publish**.

## Publishing and history (Phase 4)

Nothing is written to Shopify until the merchant clicks **Approve & Publish**. Generating a suggestion only reads.

`publishSuggestion` (`app/services/publish.server.ts`):

1. **Lock.** One conditional update moves the suggestion from `PENDING` to `PUBLISHING` and stores the approved fields. If it doesn't match a row (already published, rejected, replaced, in progress, or another shop's), nothing happens. A double click, a second tab, or a replayed request can't publish twice. Both buttons are also disabled while a request is in flight, but the server lock is what guarantees it.
2. **Re-read and compare.** The product is fetched again and its title, description, and tags are compared with the snapshot the suggestion was generated from. If anything changed in Shopify, nothing is sent and the attempt is recorded as `CONFLICT`.
3. **Update.** `productUpdate` sends only the fields the merchant chose. Tags are computed from the product's *current* tags with the chosen mode (add or replace). The merchant's description text is escaped into `<p>` HTML on the server.
4. **Check the result.** Thrown GraphQL errors (throttling, bad input, missing scope) and `userErrors` (returned with HTTP 200) both count as failure.
5. **Record.** Only a confirmed update marks the suggestion `PUBLISHED`. Any failure records a `FAILED` attempt with the error details and returns the suggestion to `PENDING` with the merchant's edits, so it can be retried.

**Reject** marks the suggestion `REJECTED`. The function doesn't receive a Shopify client, so it can't change the product.

**Race-condition limits (honest version):**

- Shopify's `productUpdate` has no "only if unchanged" option. If someone edits the product in Shopify in the moment between the re-read and the update, that edit can be overwritten. The comparison narrows the window but can't close it.
- After a network error we can't know whether Shopify applied the update. The attempt is recorded as `FAILED`, never as success. If the update did land, a retry is stopped by the comparison (the product no longer matches the snapshot) instead of writing twice.
- If the server crashes mid-publish, the lock is treated as abandoned after 5 minutes and can be retried; the comparison protects that retry the same way.

**History** (`/app/history`) lists the shop's published and rejected suggestions and any with failed or conflicting attempts. It shows what was changed, the model, and the last error. It's always filtered by the authenticated shop.

**Interface.** The dashboard scans the 100 most recently updated products (one query, about 4 cost points per product) to show catalog health as square tiles. The tiles also filter the list (`?view=attention|description|tags`). A **Next up** card links to the next incomplete listing. Products show as compact rows with 120 px thumbnails. The review page shows progress steps (generate → review → publish), and its sidebar holds the publish options and a pre-publish checklist.

## Roadmap

1. ✅ **Scaffold, configuration, database, authentication**
2. ✅ **Real Shopify product list** (pagination, missing-description/tag flags, product review page with live facts)
3. ✅ **AI generation and suggestion review** (structured output, server-side validation, side-by-side editable review)
4. ✅ **Approved publishing and history** (conflict check, GraphQL and userErrors handling, duplicate-submit lock, shop-scoped history, integration tests)
5. ⬜ Verification, evaluation set, documentation, deployment guide
