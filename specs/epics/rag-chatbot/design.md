# rag-chatbot — design

## 1. What the template is

Next.js App Router + AI SDK 5. `app/(preview)/page.tsx` is a client
component: `useChat` sends the input to `/api/chat`, shows the pending
tool's name while the assistant works and renders the last assistant
message with Streamdown. `app/(preview)/api/chat/route.ts` is the server:
`streamText` against `openai/gpt-4o` through the Vercel AI Gateway (a model
string, no provider package; the gateway reads `AI_GATEWAY_API_KEY`), with
`stopWhen: stepCountIs(5)` and three tools — `addResource` (the server
action), `getInformation` (cosine-distance retrieval for each similar
question) and `understandQuery` (`generateObject` to produce the similar
questions) — returned as `toUIMessageStreamResponse()`.
`lib/actions/resources.ts` validates with the drizzle-zod schema, inserts the
resource, chunks it on full stops, embeds the chunks with `embedMany`
(`openai/text-embedding-ada-002`) and inserts the vectors.
`lib/ai/embedding.ts` holds the chunking, the embedding calls and the
`1 - cosineDistance` query over `embeddings.embedding` (`vector(1536)`,
HNSW cosine index). `lib/db/index.ts` is `postgres(env.DATABASE_URL)` +
drizzle at module scope; `lib/env.mjs` validates `DATABASE_URL` with
t3-env; `lib/db/migrate.ts` runs drizzle's migrator over
`lib/db/migrations/0000_*.sql` inside the `build` script. Tailwind 3,
shadcn/ui `Input`, Framer Motion, `sonner`.

## 2. The mapping (Vercel → Cloudflare + Supabase)

| Vercel primitive the template uses | Here |
|---|---|
| Next.js hosting: a Vercel Function per route, the chat route streaming (`maxDuration = 30`) | Cloudflare Workers + Static Assets; the Worker is `@opennextjs/cloudflare`'s output, assets bound as `ASSETS`. The chat route streams `toUIMessageStreamResponse()` unchanged — a Worker returns a streaming `Response` as a function does; `maxDuration` is inert |
| Postgres with pgvector (Vercel Postgres / Neon), `postgres(DATABASE_URL)` once at module scope | The Supabase project's Postgres (pgvector is installed on every Supabase database; the migration's `CREATE EXTENSION IF NOT EXISTS vector` enables it) behind a Cloudflare Hyperdrive config. `lib/db/index.ts` exports `getDb()`: a `postgres` client built per call from `getCloudflareContext().env.HYPERDRIVE.connectionString` (`max: 5`, `fetch_types: false`, `prepare: false`), drizzle over it; the two callers do `const db = await getDb()`. Without a Cloudflare context (drizzle-kit, `lib/db/migrate.ts`, tests) `DATABASE_URL` is used, as upstream |
| `tsx lib/db/migrate.ts && next build` — drizzle's migrator applies `lib/db/migrations` at build, on Vercel's builder, with `DATABASE_URL` | `packages/db` (`@saas/db`, Lumen's runner) carries the same SQL verbatim as `010_rag_initial/up.sql` with its checksum in `src/manifest.ts`; `infra/db-migrate` plans it on pull requests and applies it on merge through Supabase's Management API, before the Worker deploys (`apps/web/component.yaml` depends on it). The build script is `next build` + the OpenNext build; drizzle-kit and `lib/db/migrations` stay for local work |
| `DATABASE_URL`, `AI_GATEWAY_API_KEY` as project env vars | The database is the `HYPERDRIVE` binding (no `DATABASE_URL` on the Worker; `lib/env.mjs` makes it optional). `AI_GATEWAY_API_KEY` is a Worker secret: `.dev.vars` locally, `wrangler secret put` per environment — the gateway is used exactly as upstream, the key stays the SaaS key it is |
| A database created in the dashboard and attached to the project | `infra/terraform/supabase` (one project per environment; ref, password, connection URI and keys published as orun secrets) and `infra/terraform/cloudflare-hyperdrive` (one Hyperdrive config per environment whose origin is that database; its id published as the wiring document `{hyperdrive_id, hyperdrive_name}`) |
| Deploy on push | Orun: `apps/web/component.yaml` (`cloudflare-workers-assets-turbo`) renders `wrangler.jsonc` from the wiring document and deploys `rag-chatbot-web-{stage,prod}` on merge to `main`, after db-migrate has applied |

## 3. The request flow

```
browser ── useChat ──► POST /api/chat                 (the Worker: .open-next/worker.js)
                         streamText(openai/gpt-4o)  ──► AI Gateway (AI_GATEWAY_API_KEY, Worker secret)
                           tool understandQuery      ──► generateObject → AI Gateway
                           tool getInformation       ──► embed(question) → AI Gateway
                                                         getDb() → postgres(env.HYPERDRIVE.connectionString)
                                                           SELECT content, 1 - (embedding <=> $1) … ORDER BY … LIMIT 4
                           tool addResource          ──► createResource: getDb(); INSERT resources;
                                                         embedMany(chunks) → AI Gateway; INSERT embeddings
                         toUIMessageStreamResponse() ◄── streamed back as the tools finish
                                                           │
                                   Hyperdrive config ◄─────┘ pools and keeps the Postgres connections warm
                                   Supabase Postgres (pgvector): resources, embeddings + HNSW index
```

Every `getDb()` call opens its own `postgres` client for that request;
Hyperdrive, not the Worker, holds the pool. A `postgres` socket opened in one
request cannot be used by another on Workers ("Cannot perform I/O on behalf
of a different request"), which is why the module-level client goes.

## 4. The env and secret flow

```
infra/terraform/supabase ──apply──► orun secrets (project/<env>): SUPABASE_PROJECT_REF,
                                    SUPABASE_DB_PASSWORD, SUPABASE_DB_URL, SUPABASE_URL,
                                    SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, WIRING_SUPABASE
        │                                       │
        ▼                                       ▼
infra/terraform/cloudflare-hyperdrive     infra/db-migrate (packages/db)
  origin = db.<ref>.supabase.co             SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF → Management API
  ──apply──► WIRING_CLOUDFLARE_HYPERDRIVE   plan on PRs, apply on merge: 000_control, 010_rag_initial
        │
        ▼
apps/web/component.yaml secretEnv: WIRING_CLOUDFLARE_HYPERDRIVE_{STAGE,PROD}
  → tooling/wire/live.mjs --env $ORUN_ENVIRONMENT → wrangler.jsonc: hyperdrive[0].id
  AI_GATEWAY_API_KEY: wrangler secret put, once per environment (not in the lane)
```

`wrangler.template.jsonc` carries the
`@@wiring(cloudflare-hyperdrive/__ENV__:hyperdrive_id)@@` token and a
`localConnectionString` (`postgres://postgres:postgres@localhost:5432/rag`)
for `wrangler dev` and `next dev`. The verify lane (and `pnpm run
wire:fixture`) renders it from `wiring.fixture.json`; the deploy lane from
the live document. The rendered `wrangler.jsonc` is git-ignored.

## 5. The repository

```
apps/web                      the template (app/(preview), components/, lib/) + the Workers build
  lib/db/index.ts             getDb(): the per-call client over HYPERDRIVE, DATABASE_URL fallback
  component.yaml              render wrangler from the wiring doc, build with turbo, deploy; dependsOn hyperdrive + db-migrate
  wrangler.template.jsonc     worker name, nodejs_compat, ASSETS, the HYPERDRIVE binding (token + local string)
  wiring.fixture.json         offline Hyperdrive ids for the verify lane
  cloudflare-env.d.ts         HYPERDRIVE: Hyperdrive, ASSETS: Fetcher on CloudflareEnv
  open-next.config.ts         static-assets incremental cache (the pre-rendered shell), nothing to provision
packages/db                   @saas/db: the manifest, 000_control + 010_rag_initial (upstream's SQL verbatim), the runner
infra/db-migrate              applies packages/db through Supabase's Management API; dependsOn db, supabase
infra/terraform/supabase      the Supabase project per environment
infra/terraform/cloudflare-hyperdrive  the Hyperdrive config per environment over that project's Postgres
tests/web                     vitest: embedding chunks, the resources action, getDb, cn — AI SDK, postgres and OpenNext mocked
tests/db                      vitest: manifest checksums, offline plan, applied-set skipping
```

## 6. Out of scope

Rate limiting (the page's `onError` toast assumes one; the template ships
none), persistence of chats (the template keeps no chat table), a custom
domain, and caching gateway responses. Supabase Auth, RLS and PostgREST are
not used: the app speaks SQL through Hyperdrive as the `postgres` role.

## 7. Rejected alternatives

**Cloudflare Vectorize for the embeddings.** The template's retrieval is
pgvector SQL — `vector(1536)`, an HNSW cosine index, a drizzle
`cosineDistance` query joined to the resources table by foreign key. Moving
the vectors to Vectorize would rewrite the schema, both queries and the
insert path, and split the data across two stores for one table's worth of
rows. Supabase Postgres already has pgvector; the SQL runs as written.

**Workers AI for the embeddings and the chat model.** The template is
gateway-shaped: model strings (`openai/gpt-4o`,
`openai/text-embedding-ada-002`) resolved by the AI Gateway with one key.
Workers AI would change the models (and the embedding dimension, so the
schema), the calls and the key; the gateway works from a Worker exactly as
from a function.

**A module-level `postgres` pool over Hyperdrive.** Tried on Lumen (task
0134) and reverted: the Workers runtime refuses a socket opened in one
request from another. Per-call clients with Hyperdrive holding the pool is
the Lumen shape.
