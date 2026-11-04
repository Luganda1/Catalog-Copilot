# Catalog Copilot

An embedded Shopify app that helps merchants find incomplete product listings, draft grounded descriptions and tags with AI, and review every change before it is published to Shopify.

> **Status: Phase 3 of 5 (AI suggestions and review).**
> Publishing approved changes and the change history are not implemented yet. See [Roadmap](#roadmap).

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
- **Least privilege.** Phases 1–3 only request `read_products`. `write_products` is added in Phase 4, when publishing exists.

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
| `npm test` | Unit tests (Vitest) |
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
- **Review screen.** Current and suggested content side by side, an editable description and tags, a choice between **Add to the existing tags** and **Replace all existing tags** with a preview of what will be added or removed, and banners for warnings, missing information, mock output, and products edited since generation. Reject and Approve & Publish arrive in Phase 4.

## Roadmap

1. ✅ **Scaffold, configuration, database, authentication**
2. ✅ **Real Shopify product list** (pagination, missing-description/tag flags, product review page with live facts)
3. ✅ **AI generation and suggestion review** (structured output, server-side validation, side-by-side editable review)
4. ⬜ Approved publishing (conflict check, error handling, duplicate-submit lock) and history
5. ⬜ Verification, evaluation set, documentation, deployment guide
