# rag-chatbot

Vercel's [AI SDK RAG template](https://github.com/vercel-labs/ai-sdk-preview-rag)
— a chatbot that keeps what you tell it and answers from it: `useChat` on the
page, `streamText` with three tools on the server (`addResource`,
`getInformation`, `understandQuery`), resources chunked and embedded,
embeddings stored in Postgres with pgvector through Drizzle — on **Cloudflare
Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare). The models are
**Workers AI**'s, through the Worker's `AI` binding, so it needs no AI vendor
key; the knowledge base is a **Supabase** project's Postgres reached through
**Cloudflare Hyperdrive**. Terraform provisions both per environment and
Orun's `db-migrate` applies the schema, all on every merge to `main`.

## Live deployment

<!-- 02-docs:begin -->
Not recorded yet. The bootstrap's last phase writes the live URLs, the
workspace, the model the chat runs on and the secrets the product uses into
[ai/context/deployment.md](ai/context/deployment.md); how the product deploys
and how to operate it is in
[ai/context/operations.md](ai/context/operations.md).
<!-- 02-docs:end -->

## What is here

| Surface | Where |
|---|---|
| The product's name | `apps/web/lib/site.ts` |
| The chat page and the chat route with its tools | `apps/web/app/(preview)` |
| The models — Workers AI by default, a vendor chat model if you add its key | `apps/web/lib/ai/models.ts` |
| Chunking, embedding, retrieval, the resources action | `apps/web/lib/ai/embedding.ts`, `apps/web/lib/actions/resources.ts` |
| Drizzle schema and the per-call client | `apps/web/lib/db` (`index.ts` is `getDb()`) |
| The database check the deploy smoke-tests | `apps/web/app/(preview)/api/health/route.ts` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc`, `component.yaml` |
| The schema as migrations, and their runner | `packages/db` (`@saas/db`) |
| The Supabase project, the Hyperdrive config, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (it is committed)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # next build + opennextjs-cloudflare build → apps/web/.open-next
```

The build needs no database and no model: nothing pre-renders against
either. The tests run the chat route, the real AI SDK and the real Workers AI
provider against a scripted binding, and every migration on an in-process
Postgres with pgvector.

## Running it locally

You need a Postgres with the `vector` extension available, and a Cloudflare
login for the models.

1. **A Postgres with pgvector** on `localhost:5432`, database `rag`, user and
   password `postgres` — the `localConnectionString` in
   `apps/web/wrangler.template.jsonc`. Docker is the quickest:

   ```bash
   docker run --name rag-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rag -p 5432:5432 -d pgvector/pgvector:pg17
   ```

   The [Supabase CLI](https://supabase.com/docs/guides/local-development)
   (`supabase start`) works too — its Postgres ships pgvector; point the
   connection string at its port.

2. **Environment.** Copy `apps/web/.env.example` to `apps/web/.env.local`:
   `DATABASE_URL` is for drizzle-kit and the migration script. The Worker
   never reads it: its database is the `HYPERDRIVE` binding.

3. **Schema.** drizzle-kit applies the migrations locally — the `vector`
   extension, `resources`, `embeddings` at 768 dimensions, row-level
   security:

   ```bash
   pnpm --filter @app/web db:migrate
   ```

   The same SQL lives in `packages/db/src/migrations`, which is what CI
   applies to the real databases.

4. **Models.** Workers AI has no local mode: the `AI` binding always reaches
   your Cloudflare account, so `wrangler login` once. That is all — no key.

5. **Run.** Either Next's dev server, which gets the Worker's bindings
   through `getCloudflareContext()`:

   ```bash
   pnpm --filter @app/web dev          # http://localhost:3000
   ```

   or the built Worker under `wrangler dev`, which reads
   `apps/web/.dev.vars` (copy `.dev.vars.example`; every key is optional):

   ```bash
   pnpm build
   pnpm --filter @app/web preview      # http://localhost:8787
   ```

Tell the chatbot something about yourself and it calls `addResource`; ask it
a question and it calls `getInformation` against the embeddings. With no
`AI` binding and no gateway key, the chat answers 503 with the reason and
the page shows it.

## How it deploys

Merges to `main` converge through [Orun](https://github.com/sourceplane/orun):
`.github/workflows/ci.yml` plans the changed components and runs each lane
against the workspace in `intent.yaml`. Per environment the order is
enforced — **the Supabase project, then the Hyperdrive config over its
database, then the migrations, then the Worker** — because each reads what
the one before it published: the project's ref and password, the Hyperdrive
id the Worker binds, the schema the app queries. `stage` deploys first and
`prod` once stage has converged on the same commit; `dev` only verifies.
Every deploy is smoke-tested over HTTP, `/api/health` included, which
answers only when the Worker reaches a migrated database.

The pipeline holds one credential, GitHub's own `GITHUB_TOKEN`. The
Cloudflare tokens and account id and the Supabase access token and org id
are brokered per run from the workspace's connections; the Supabase
project's credentials and the Hyperdrive id are published by the Terraform
applies as orun secrets. Workers AI needs nothing: the `AI` binding is the
account the Worker deploys into, billed to it after its free daily
allocation. Nothing provider-shaped is stored in the repository or in
GitHub.

## Use a vendor model instead

The chat runs on Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`)
unless the environment's Worker has an `AI_GATEWAY_API_KEY` — a
[Vercel AI Gateway](https://vercel.com/ai-gateway) key. With one, the chat is
`openai/gpt-4o` through the gateway, the model the upstream template shipped
with. Per environment:

```bash
wrangler secret put AI_GATEWAY_API_KEY --name rag-chatbot-web-prod
wrangler secret put AI_GATEWAY_API_KEY --name rag-chatbot-web-stage
```

Worker secrets survive every later deploy; the next request sees them, and
`/api/health` reports `"chat":"ai-gateway"`. Locally, put the key in
`apps/web/.dev.vars` (or `.env.local` for `next dev`).

The embeddings stay on Workers AI (`@cf/baai/bge-base-en-v1.5`) either way:
the knowledge base's column is sized to that model's 768 dimensions, and a
question embedded by one model cannot be compared with resources embedded by
another. Changing the embedding model is a migration plus re-adding every
resource; `ai/context/operations.md` says how.

## Custom domain

The app answers on workers.dev from its first deploy. To serve it on your
own domain, attach the domain to the Worker in Cloudflare (Workers & Pages →
`rag-chatbot-web-prod` → Settings → Domains & Routes), then set `SITE_URL`
under that environment's `env:` in `intent.yaml` — the page's Open Graph
image link is absolute, and the build bakes the origin in — and merge.

The repository names the domain in one more place, `BASE_DOMAIN` in
`intent.yaml` (one line per environment), which the product was born with as
the reserved placeholder `rag-chatbot.example.com`. Replace it with your
domain in the same change.

## CI

| Workflow | What it runs |
|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes — the app built and dry-deployed for each environment, both Terraform roots checked and planned, the migrations planned — with nothing applied or deployed. No lane runs the `typecheck`, `lint` or `test` scripts: run them yourself (above) before you push. A merge applies, migrates and deploys stage → prod |
