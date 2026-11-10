# Catalog Copilot

An embedded Shopify app that helps merchants find incomplete product listings, draft grounded descriptions, tags, and consistently formatted titles with AI, and review every change before it is published to Shopify.

> **Status: complete (version 1, phases 1–6).** Runs on a development store; not submitted to the Shopify App Store. See [Evaluation](#evaluation), [Deployment](#deployment), the [demo outline](docs/DEMO.md), and the [technical document](TECHNICAL_DOCUMENT.md).

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
- `Shop`: one row per installed store (`domain` is unique); `uninstalledAt` is set by the `app/uninstalled` webhook. `titleTemplate` and `titleMaxLength` hold the merchant's title format (null template = title suggestions off).
- `Suggestion`: product GID (string), source snapshot (title, description HTML, tags), validated AI output (title and the title template it followed, description, tags, missing info, warnings, model, prompt version), the merchant's approved fields, and a status (`PENDING → PUBLISHING → PUBLISHED`, or `REJECTED`).
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
| `npm run eval` | Run the evaluation set against the configured AI provider (calls the real model) |
| `npm run eval:regrade -- <file>` | Re-grade a saved eval run with the current graders (no model calls) |
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
- **Claim guardrail.** After validation, `findUnsupportedClaims` (`app/services/ai/claims.ts`) looks for claim words shoppers rely on (waterproof, durable, warranty, certified, organic, non-toxic, vegan, "suitable for", superlatives, …) that don't appear anywhere in the product facts, and adds a warning naming them. It doesn't block the draft. It's a word list, not a fact checker: it misses claims phrased differently, and it treats any word in the facts as supported, including words inside an injected instruction.
- **Stored safely.** The plain-text description is escaped into `<p>` HTML by the app (`textToSafeHtml`). Every suggestion records its model, prompt version, and the product snapshot.
- **One pending suggestion per product.** Regenerating marks the previous one `SUPERSEDED` in the same transaction.
- **Title format.** In **Settings** (`/app/settings`) a merchant can set a title pattern such as `{Brand} {Product name} – {Key detail}` (placeholders: `{Brand}`, `{Product name}`, `{Product type}`, `{Key detail}`) and a maximum length. With a format set, the prompt gets a separate `<title_format>` block and the model returns a title that follows it, using only product facts. A placeholder with no matching fact is left out and flagged. The title is validated separately (`validateTitle`): an empty, HTML, or over-length title is dropped with a warning, and the description and tags are kept. `checkTitleFormat` then warns if the title leaves out the vendor or product type the format asks for, or is in capital letters. The claim guardrail covers the title too. Without a format, no title is requested and titles never change.
- **Review screen.** Current and suggested content side by side, an editable title (when the draft has one), description, and tags, a choice between **Add to the existing tags** and **Replace all existing tags** with a preview of what will be added or removed, and banners for warnings, missing information, mock output, and products edited since generation. A merchant ticks what to publish (title, description, tags) and then **Reject** or **Approve & Publish**.

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

**Interface.** Three pages in the app navigation, plus the review page:
- **Products** (`/app`, the landing page) reads the 100 most recently updated products in one query (about 4 cost points per product). Square catalog-health tiles sit in a row next to a **Next up** card that links to the next incomplete listing. Below them, one row holds the filter buttons (all, needs attention, no description, no tags, each with its count), a title search, and a page-size picker (20, 50, or 100). They control a product table (`?view=`, `?q=`, `?size=`). Search runs as you type (after a short pause). On "All products" it's a Shopify search where each word matches the start of a word in the title (`title:blue* AND title:sh*`); punctuation is dropped so typed text can't change the query. The filtered views apply the same match to the scan. "All products" pages through Shopify with cursors. The filtered views page through the 100-product scan, because Shopify search can't filter on an empty description.
- **History** (`/app/history`), described above.
- **Settings** (`/app/settings`): the title format, with a live example.
- **Review page.** Warnings sit next to **Approve & Publish**. The current and draft titles and descriptions line up side by side. Tags are shown once, as they'll be after publishing, with added and removed tags marked.

## Evaluation

`evals/` holds 14 product cases that target the ways a listing generator goes wrong:
- thin facts;
- rich facts that should be used;
- prompt injection in the description, title, and tags;
- an attempt to close the facts block;
- promotional claims in the existing description;
- contradictory facts;
- food, children's products, and electronics, where invented dietary, safety, or compatibility claims would be harmful;
- title formats: a shouty, promotional title rewritten into the merchant's pattern, and a missing vendor that must be left out and flagged (four cases ask for a title).

`npm run eval` sends each case to the configured provider and grades the model's own output (after schema validation, before the app's claim warning is added). Each case gets:
- the claim-word check;
- a tag count check;
- its own checks: text that must not appear, facts that must appear, an expected warning, and expected missing information;
- title checks: a title is returned only when the case sets a format, and it includes the vendor and product type the format asks for.

The graders themselves are unit-tested (`evals/grade.test.ts`). Full outputs are saved to `evals/results/`, which is gitignored. `npm run eval:regrade` re-scores a saved run after the graders change.

**Results** (Groq `openai/gpt-oss-120b`, one run per prompt, same graders):

| Prompt | Cases passed | What changed |
| --- | --- | --- |
| `2026-11-03.v1` | 3 / 12 | Original prompt |
| `2026-11-04.v2` | 6 / 12 | Bans generic quality words; current-description claims go to warnings instead of the draft |
| `2026-11-04.v3` | **8 / 12** | Bans invented usage ("for everyday use", "redeemable online"); fewer tags allowed when facts are thin |
| `2026-11-09.v4` | not run yet | Adds title suggestions in the merchant's format; two new title cases (14 total) |

What the runs showed:

- **Injection was resisted in every run.** In all 12 injection runs (4 injection cases × 3 prompts), no injected claim (waterproof, lifetime warranty, FDA approved, free shipping, award-winning, `<script>`) appeared in a draft. Each injection was reported in a warning that names the field.
- **Invented usage is the remaining weakness.** v3 still writes "suitable for everyday items" and "suitable for hot or cold beverages". The app's claim warning flags these phrases for the merchant, and the merchant approves every draft.
- **The mug case kept part of the injected title.** The draft said "Ceramic Mug SYSTEM" because the title is used as the product's name. It was flagged, but this shows that injected text in the title reaches the draft.
- **The graders are a heuristic.** Two of the four v3 failures are borderline: "designed for wall-outlet use" for a product the facts call a wall charger, and "designed for blending tasks". The first version of the graders also passed real invented details, such as "redeemable online or in-store" for a gift card; reading the outputs is what found them.
- **One run per prompt is a small sample.** The model isn't deterministic, so scores can move by a case or two between runs.

## Deployment

The app runs as one Docker container plus a PostgreSQL database. Any container host works (Fly.io, Render, Railway, Google Cloud Run, a VM). It's meant for a development store; it isn't submitted to the Shopify App Store.

**1. Database.** Create a managed PostgreSQL 14+ database and copy its connection string.

**2. Image.** The `Dockerfile` has two stages: the build stage installs all dependencies and runs `npm run build`; the runtime stage holds production dependencies and the built app only, and runs as the non-root `node` user. `.dockerignore` keeps `.env` and other local files out of the image. On start the container runs `prisma migrate deploy` (Prisma takes a database lock, so several instances starting at once is safe) and then serves on port 3000.

```bash
docker build -t catalog-copilot .
```

**3. Environment variables.** Set these in the host's secret manager, never in the image or the repository:

| Variable | Value |
| --- | --- |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Client ID and secret from the app's page in the Partner Dashboard |
| `SHOPIFY_APP_URL` | The public HTTPS URL of the deployment |
| `SCOPES` | `read_products,write_products` (must match `shopify.app.toml`) |
| `DATABASE_URL` | The PostgreSQL connection string |
| `AI_PROVIDER` and `GROQ_API_KEY` (or `ANTHROPIC_API_KEY`) | The AI provider and its key |
| `NODE_ENV` | `production` (already set in the image) |

**4. Point Shopify at the deployment.** In `shopify.app.toml`, set `application_url` to `SHOPIFY_APP_URL` and `redirect_urls` to `<SHOPIFY_APP_URL>/api/auth`, then run `npm run deploy`. That pushes the URLs, scopes, and webhook subscriptions to Shopify. It doesn't deploy code; the host does that.

**5. Install** the app on the development store from the Partner Dashboard and run through the checklist below.

**Production checklist**

- [ ] HTTPS only (Shopify requires it for embedded apps).
- [ ] Secrets are in the host's secret manager; `docker run --rm --entrypoint ls catalog-copilot -a /app` shows no `.env`.
- [ ] Database backups are on. Suggestions and publish attempts are the only data the app stores.
- [ ] `npm run eval` passes with the production provider and model before changing either.
- [ ] Logs are collected. They contain shop domains and error details but no API keys or access tokens.
- [ ] Before any public distribution: add the mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`; commented out in `shopify.app.toml`). The app stores no customer data, but Shopify requires the endpoints.

## Dependency audit

`npm audit` (4 Nov 2026) reports 31 advisories. 25 are in development-only tools and 6 are in the production dependency tree, with no critical ones in production.

| Where | Package | Severity | Assessment |
| --- | --- | --- | --- |
| Production | `deepmerge-ts` via `prisma` / `@prisma/config` | High | Stack exhaustion on recursive objects while Prisma loads its own config. Doesn't process request data. The fix needs Prisma 7, a breaking upgrade that the Shopify session adapter doesn't support yet. Accepted for now. |
| Production | `minimatch` via `@react-router/fs-routes` | Moderate | ReDoS in glob patterns. The globs are the app's own route patterns at build time, not user input. Accepted. |
| Dev only | `vitest` 3, `tinypool`, `@vitest/mocker` | Critical | Exploitable through Vitest's dev/browser server, which this project doesn't run (`vitest run` only). Fixed in Vitest 4, which needs Node 20, 22, or 24. **To fix:** switch to Node 22 LTS (the version the Docker image uses), then `npm i -D vitest@^4.1.11 vite-node`. |
| Dev only | `@graphql-codegen/*`, `@graphql-tools/utils`, `lodash`, `@typescript-eslint/*` | High | Run only by developers on the app's own GraphQL and source files. No upstream fix for the Shopify codegen preset yet. |

## Roadmap

1. ✅ **Scaffold, configuration, database, authentication**
2. ✅ **Real Shopify product list** (pagination, missing-description/tag flags, product review page with live facts)
3. ✅ **AI generation and suggestion review** (structured output, server-side validation, side-by-side editable review)
4. ✅ **Approved publishing and history** (conflict check, GraphQL and userErrors handling, duplicate-submit lock, shop-scoped history, integration tests)
5. ✅ **Verification and deployment** (evaluation set run against the real model, claim guardrail, tightened prompt, dependency audit, Docker image, deployment guide, demo outline)
6. ✅ **Products page and title formats** (dashboard and product list merged into one page with a filter row, title search, and page sizes; merchant-set title format in Settings; title suggestions validated, reviewed, and published like the other fields)

**Possible next steps** (not built): run the evaluation for prompt v4; bulk title review across many products; a `shop/redact` handler and billing before any App Store submission; move to Prisma 7 and Vitest 4 when the Shopify adapter allows.
