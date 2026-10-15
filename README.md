# rag-chatbot

Vercel's [AI SDK RAG template](https://github.com/vercel-labs/ai-sdk-preview-rag)
— a retrieval-augmented chatbot: `useChat` on the client, `streamText` with
tools on the server (`addResource`, `getInformation`, `understandQuery`),
resources chunked and embedded through the Vercel AI Gateway, embeddings
stored in Postgres with pgvector through Drizzle — running on **Cloudflare
Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), with the
database a Supabase project's Postgres reached through Cloudflare Hyperdrive,
both provisioned by Terraform and the schema applied by
[Orun](https://github.com/sourceplane/orun), the way the
[Lumen baseline](https://github.com/sourceplane/lumen) does it.

The template's code is the code. What the port adds is the Workers build, the
monorepo wrapper, a per-call database client over the Hyperdrive binding
(the one change the Workers runtime forces), the migration package and
runner that apply the template's SQL through Supabase's Management API, test
packages, the Supabase and Hyperdrive Terraform roots, and the deploy
contract that threads the Hyperdrive id into the Worker per environment. See
[`specs/epics/rag-chatbot`](specs/epics/rag-chatbot/README.md) for the
design, the milestones and the as-built status.

## What is here

| Surface | Where |
|---|---|
| The chat page and the streaming chat route with its tools | `apps/web/app/(preview)` |
| Resources action, embeddings, the Drizzle schema | `apps/web/lib/{actions,ai,db}` |
| The database client over Hyperdrive (`getDb()`) | `apps/web/lib/db/index.ts` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `apps/web/open-next.config.ts`, `apps/web/wrangler.template.jsonc`, `apps/web/component.yaml` |
| The schema as Orun migrations and their runner | `packages/db` (`@saas/db`), applied by `infra/db-migrate` |
| The Supabase project and the Hyperdrive config (stage, prod) | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive` |
| Tests | `tests/web` (vitest: embedding chunks, the resources action, `getDb`, `cn`), `tests/db` (manifest checksums, offline plan) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # render apps/web/wrangler.jsonc from the offline fixture
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # next build + opennextjs-cloudflare build → apps/web/.open-next
pnpm --filter @saas/db run manifest:check
```

### Local development

The app needs a Postgres with the `vector` extension available and a Vercel
AI Gateway key.

1. A Postgres with pgvector on `localhost:5432`, database `rag`, user and
   password `postgres` (the `localConnectionString` in
   `apps/web/wrangler.template.jsonc`). Either the
   [Supabase CLI](https://supabase.com/docs/guides/local-development)
   (`supabase start`; its Postgres ships pgvector — point the connection
   string at its port) or Docker:

   ```bash
   docker run --name rag-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rag -p 5432:5432 -d pgvector/pgvector:pg17
   ```

2. `apps/web/.env.local` from `apps/web/.env.example`: `DATABASE_URL` for
   drizzle-kit and the migration script, `AI_GATEWAY_API_KEY` for `next dev`.
   `apps/web/.dev.vars` from `apps/web/.dev.vars.example`:
   `AI_GATEWAY_API_KEY` for `wrangler dev`. Neither file is committed.

3. Apply the schema (the template's drizzle migration — the same SQL
   `packages/db` carries for Orun):

   ```bash
   pnpm --filter @app/web db:migrate
   ```

4. Run it:

   ```bash
   pnpm --filter @app/web dev        # http://localhost:3000, Next's dev server; the HYPERDRIVE binding comes from wrangler.jsonc through the platform proxy
   pnpm --filter @app/web preview    # wrangler dev over the built Worker (after `pnpm build`)
   ```

Tell the chatbot something about yourself and it calls `addResource`; ask it
a question and it calls `getInformation` against the embeddings.

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js hosting (the chat route streams with `streamText`) | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets; the route streams through `toUIMessageStreamResponse()` as it did |
| Vercel Postgres with pgvector, `postgres(DATABASE_URL)` at module scope | The Supabase project's Postgres (pgvector built in) through a Hyperdrive config; `getDb()` builds the `postgres` client per call from the `HYPERDRIVE` binding's connection string |
| `tsx lib/db/migrate.ts && next build` (drizzle migrate at build) | `packages/db` + `infra/db-migrate`: the same SQL, applied through Supabase's Management API before the Worker deploys; drizzle-kit stays for local work |
| `AI_GATEWAY_API_KEY` as a project env var | A Worker secret (`.dev.vars` locally, `wrangler secret put` per environment); the AI Gateway is used exactly as upstream |
| A Postgres database created in the dashboard | `infra/terraform/supabase` (one project per environment) + `infra/terraform/cloudflare-hyperdrive` (one config per environment pointing at it), ids published as orun secrets and wiring documents |
| Deploy on push | Orun deploys `rag-chatbot-web-{stage,prod}` on merge to `main` after the migrations have applied (`apps/web/component.yaml`) |

## Deploying

`.github/workflows/checks.yml` runs install, wire, typecheck, lint, test and
build on every push and pull request. `ci.yml` is the Orun pipeline: set
`execution.state.workspace` in `intent.yaml` to this product's workspace
(`orun cloud link`), connect Cloudflare **and Supabase** to that workspace,
and set the `ORUN_CI` repository variable to `true`. A merge to `main` then
applies the Supabase root, the Hyperdrive root, plans and applies the
migrations (`db-migrate`), builds the app with that environment's Hyperdrive
id rendered into `wrangler.jsonc`, and deploys the Worker to `stage`, then
`prod`.

The gateway key is a Worker secret the deploy lane does not set. Once per
environment, after the first deploy:

```bash
wrangler secret put AI_GATEWAY_API_KEY --name rag-chatbot-web-stage
wrangler secret put AI_GATEWAY_API_KEY --name rag-chatbot-web-prod
```
