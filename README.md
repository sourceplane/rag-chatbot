# rag-chatbot

Vercel's [AI SDK RAG template](https://github.com/vercel-labs/ai-sdk-preview-rag)
— a retrieval-augmented chatbot: `useChat` on the page, `streamText` with
three tools on the server (`addResource`, `getInformation`,
`understandQuery`), resources chunked and embedded, embeddings stored in
Postgres with pgvector through Drizzle — running on **Cloudflare Workers +
Static Assets** through [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
chatting and embedding with **Workers AI** through the Worker's `AI` binding,
its knowledge base a **Supabase** project's database reached through
**Cloudflare Hyperdrive**, both provisioned by Terraform through
[Orun](https://github.com/sourceplane/orun) and the schema applied by Orun's
`db-migrate` — the way the [Lumen baseline](https://github.com/sourceplane/lumen)
does it — and packaged as an **Orun baseline**: one command takes a new
product from nothing to live on stage and prod, in its own repository, under
its own name, in ONE landing.

The template's code is the code. What the port changes is what the Workers
runtime and a fresh, unattended deployment force: the database client is
built per call over the Hyperdrive binding (`lib/db/index.ts`), and the
models are Workers AI's (`lib/ai/models.ts`) — the platform brokers no AI
vendor, and the Cloudflare account the app deploys into already is one — so
the chat, the embeddings and the knowledge base work on a fresh build with
only Cloudflare and Supabase connected. The embeddings column is sized to
Workers AI's embedding model (768 dimensions, migration
`020_workers_ai_embeddings`); upstream's gateway model stays available for
the chat behind an optional key. What the baseline adds is everything needed
to make a copy of it somebody else's — built the way
[cirrus-baseline](https://github.com/sourceplane/cirrus-baseline) builds a
product, in one landing. See [`specs/epics/rag-chatbot`](specs/epics/rag-chatbot/README.md)
for the design, the milestones and the as-built status, including every
departure.

## Instantiating a product

```bash
git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/rag-chatbot
cd rag-chatbot
orun new --blueprint repo-blueprint.yaml --out ~/products/acme-rag --run-hooks --resume \
  --set reponame=acme-rag --set productname="Acme Answers" \
  --set githuborg=acme-inc --set subdomain=<workers-dev-subdomain>
```

Or, once the platform's registry lists it, from the Orun console (Baselines →
`rag-chatbot` → Build). Two phases: **`01-product`** creates the repository,
mints the five brokered credentials (Cloudflare and Supabase) and lands the
whole product as one pull request, whose convergence on `main` provisions and
deploys it per environment in a fixed order —

```
supabase ──▶ cloudflare-hyperdrive ──▶ db-migrate ──▶ web
```

— each edge `mode: enforced` on a push to main and advisory on a pull
request; then **`02-docs`** records the live deployment from probed facts.
**[BOOTSTRAP.md](BOOTSTRAP.md)** is the operator guide;
[docs/phases/](docs/phases/README.md) has a page per phase.

**It creates two Supabase projects**, `<reponame>-stage` and
`<reponame>-prod`. Supabase's free plan allows two active projects per
organization, so the connected organization needs room for both
(BOOTSTRAP.md, §0).

The new repository receives the **product only** — the app, the Terraform
roots, the migrations, the tests, its CI, its tooling, a README of its own
and its operating contract — renamed throughout to the product's name,
repository, Worker, Supabase project and Hyperdrive config. None of this
repository's machinery ships. **No AI vendor key is asked for**: Workers AI
needs none, and a vendor chat model is the owner's to add afterwards (the
product's README, "Use a vendor model instead").

| What makes it a baseline | Where |
|---|---|
| The console card (inputs, secrets, programme) | `blueprint.yaml` |
| The build document (modules, phases, hooks) | `repo-blueprint.yaml` |
| This tree's identity, the product's README and the bootstrap's task contracts | `.baseline/` |
| The rename engine (product-name seam: `apps/web/lib/site.ts`) | `tooling/rebrand/rebrand.mjs` |
| The bootstrap's helpers (deferrals, redeploy marker, work-tree strip) | `tooling/bootstrap/` |
| The deployment-record renderer | `hooks/render-deployment-docs.sh` |
| The product's context pack | `ai/context/` |
| The baseline's tests: contract, leak, offline bootstrap and plans, end to end (with a Workers AI stand-in) | `testing/`, `.github/workflows/baseline.yml` |
| Cutting a `baseline-vN` tag | `.github/workflows/tag.yml` |

## What is here (the product)

| Surface | Where |
|---|---|
| The product's name | `apps/web/lib/site.ts` |
| The chat page, the chat route and its tools, `/api/health` | `apps/web/app/(preview)` |
| The models: Workers AI, or a vendor chat model behind an optional key | `apps/web/lib/ai/models.ts` |
| Chunking, embedding, retrieval, the resources action | `apps/web/lib/ai/embedding.ts`, `apps/web/lib/actions/resources.ts` |
| Drizzle schema and the per-call client | `apps/web/lib/db` (`index.ts` is `getDb()`) |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc` (committed), `component.yaml` |
| The schema as migrations, and Lumen's runner | `packages/db` (`@saas/db`) |
| The Supabase project, the Hyperdrive config, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (committed; this changes nothing)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # next build + opennextjs-cloudflare build → apps/web/.open-next
pnpm --filter @saas/db run manifest:check
```

The build needs no database, no model and no Cloudflare credential. Running
it locally — a Postgres with pgvector on `localhost:5432`, `pnpm --filter
@app/web db:migrate`, `wrangler login` for Workers AI, `next dev` or
`wrangler dev` — is in the product's README (`.baseline/product/README.md`),
which is what a product built from here carries.

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js hosting (the chat route streams with `streamText`) | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets; the route streams through `toUIMessageStreamResponse()` as it did |
| `"openai/gpt-4o"` and `"openai/text-embedding-ada-002"` through Vercel's AI Gateway, `AI_GATEWAY_API_KEY` required | Workers AI through the `AI` binding: `@cf/meta/llama-4-scout-17b-16e-instruct` for the chat, `@cf/baai/bge-base-en-v1.5` (768 dimensions) for the embeddings, no key. `AI_GATEWAY_API_KEY`, if set, switches the chat — not the embeddings — back to upstream's gateway model |
| Vercel Postgres with pgvector, `postgres(DATABASE_URL)` at module scope | The Supabase project's Postgres (pgvector built in) through a Hyperdrive config; `getDb()` builds the `postgres` client per call from the `HYPERDRIVE` binding's connection string |
| `tsx lib/db/migrate.ts && next build` (drizzle migrate at build) | `packages/db` + `infra/db-migrate`: the same SQL, plus the resize to 768 dimensions and row-level security, applied through Supabase's Management API after the project and the Hyperdrive config exist, before the Worker deploys; drizzle-kit stays for local work |
| A Postgres database created in the dashboard | `infra/terraform/supabase` (one project per environment) + `infra/terraform/cloudflare-hyperdrive` (one config per environment), ids and credentials as orun secrets |
| "Deploy with Vercel" (clone the template) | `orun new --blueprint repo-blueprint.yaml` — a new repository, branded, provisioned, deployed |

## CI

| Workflow | What it runs | Ships to a product |
|---|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow a product carries: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes (the app built and dry-deployed per environment, both Terraform roots checked and planned, the migrations planned); no lane runs the `typecheck`, `lint` or `test` scripts — `baseline.yml`'s e2e tier runs them on the bootstrapped product before every tag, and a product's developers run them before they push. The bootstrap's own landings (`orun/BASE-*`) run `plan` alone and nothing waits for it — the landing was checked in the build box; a merge applies, migrates and deploys stage → prod. It plans nothing while `intent.yaml` names the placeholder workspace `ws_CHANGE_ME`, as this repository does. A manual run (Orunbase's Deploy button, or Run workflow on `main`) plans the environment and components it names under the push-to-main trigger, so they deploy as a merge deploys them | yes |
| `baseline.yml` | the baseline's own tiers: contract tests; the blueprint read by the pinned orun, the leak gate, the offline bootstrap and the product's own plans; the product built, migrated into a local Postgres with pgvector, dry-deployed, served with Workers AI stood in for, told a document and asked about it | no |
| `tag.yml` | cuts a `baseline-vN` tag (manual) | no |
