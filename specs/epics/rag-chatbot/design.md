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
| `DATABASE_URL`, `AI_GATEWAY_API_KEY` as project env vars | The database is the `HYPERDRIVE` binding (no `DATABASE_URL` on the Worker; `lib/env.mjs` makes it optional). The models are Workers AI's through the Worker's `AI` binding (RG5, `lib/ai/models.ts`): `@cf/meta/llama-4-scout-17b-16e-instruct` for the chat and understandQuery, `@cf/baai/bge-base-en-v1.5` (768 dimensions) for the embeddings — no key. `AI_GATEWAY_API_KEY` is optional: a Worker secret that switches the CHAT back to upstream's `openai/gpt-4o` through the gateway; the embeddings stay on Workers AI, the column being sized to its model |
| `openai/gpt-4o`, `openai/text-embedding-ada-002` (1536) as model strings | `createWorkersAI({ binding: env.AI })` from `workers-ai-provider` 2.0.2 (the AI SDK v5 release), the chat model wrapped in `simulateStreamingMiddleware` so every step is one whole `AI.run` (the provider parses tool calls from a whole response in both of Workers AI's shapes, from a stream only in the older one); `embeddings.embedding` resized to `vector(768)` by migration `020_workers_ai_embeddings` |
| A database created in the dashboard and attached to the project | `infra/terraform/supabase` (one project per environment; ref, password and connection URI published as orun secrets — Lumen's three, RG5) and `infra/terraform/cloudflare-hyperdrive` (one Hyperdrive config per environment whose origin is that database; its id published as the wiring document `{hyperdrive_id, hyperdrive_name}`) |
| Deploy on push | Orun: `apps/web/component.yaml` (`cloudflare-workers-assets-turbo`) renders `wrangler.jsonc` from the wiring document and deploys `rag-chatbot-web-{stage,prod}` on merge to `main`, after the Hyperdrive config and db-migrate — every edge `mode: enforced` on main, advisory on a pull request (RG5) |

## 3. The request flow

```
browser ── useChat ──► POST /api/chat                 (the Worker: .open-next/worker.js)
                         streamText(llama-4-scout)  ──► env.AI.run — Workers AI, one whole response per step
                                                         (AI_GATEWAY_API_KEY set: openai/gpt-4o → AI Gateway)
                           tool understandQuery      ──► generateObject → env.AI.run, JSON mode
                           tool getInformation       ──► embed(question) → env.AI.run(bge-base-en-v1.5)
                                                         getDb() → postgres(env.HYPERDRIVE.connectionString)
                                                           SELECT content, 1 - (embedding <=> $1) … ORDER BY … LIMIT 4
                           tool addResource          ──► createResource: getDb(); INSERT resources;
                                                         embedMany(chunks) → env.AI.run(bge-base-en-v1.5); INSERT embeddings
                         toUIMessageStreamResponse() ◄── streamed back as the tools finish
                                                           │
                                   Hyperdrive config ◄─────┘ pools and keeps the Postgres connections warm
                                   Supabase Postgres (pgvector): resources, embeddings vector(768) + HNSW index
```

Every `getDb()` call opens its own `postgres` client for that request;
Hyperdrive, not the Worker, holds the pool. A `postgres` socket opened in one
request cannot be used by another on Workers ("Cannot perform I/O on behalf
of a different request"), which is why the module-level client goes.

## 4. The env and secret flow

```
infra/terraform/supabase ──apply──► orun secrets (project/<env>): SUPABASE_PROJECT_REF,
                                    SUPABASE_DB_PASSWORD, SUPABASE_DB_URL
        │                                       │
        ▼                                       ▼
infra/terraform/cloudflare-hyperdrive     infra/db-migrate (packages/db)
  origin = db.<ref>.supabase.co             SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF → Management API
  ──apply──► WIRING_CLOUDFLARE_HYPERDRIVE   plan on PRs, apply on merge: 000_control, 010_rag_initial, 020_workers_ai_embeddings, 030_row_level_security
        │
        ▼
apps/web/component.yaml secretEnv: WIRING_CLOUDFLARE_HYPERDRIVE_{STAGE,PROD}
  → tooling/wire/live.mjs --env $ORUN_ENVIRONMENT → wrangler.jsonc: hyperdrive[0].id
  AI: the Workers AI binding — no secret, the account the deploy targets
  AI_GATEWAY_API_KEY: optional, wrangler secret put by the owner (not in the lane)
```

`wrangler.template.jsonc` carries the
`@@wiring(cloudflare-hyperdrive/__ENV__:hyperdrive_id)@@` token and a
`localConnectionString` (`postgres://postgres:postgres@localhost:5432/rag`)
for `wrangler dev` and `next dev`, and the `ai` binding. `pnpm run
wire:fixture` renders it from `wiring.fixture.json` into the COMMITTED
`wrangler.jsonc` — the composition checks that file exists before the build,
in a fresh checkout — which `wrangler dev`, `next dev` and the dev verify lane
use; the stage and prod lanes re-render it from the live document for
`$ORUN_ENVIRONMENT` before they build (RG5; it was git-ignored before).

On a push to main the four components converge in one run, per environment,
in the order the arrows above imply — `supabase → cloudflare-hyperdrive →
db-migrate → web` — because each component that reads another's output
declares `dependsOn` on it with `mode: enforced` (advisory on a pull request).
A job resolves its secrets when it starts, so what an apply published is
there for the next.

## 5. The repository

```
apps/web                      the template (app/(preview), components/, lib/) + the Workers build
  lib/db/index.ts             getDb(): the per-call client over HYPERDRIVE, DATABASE_URL fallback
  lib/ai/models.ts            the models: Workers AI through AI, or the gateway's chat model with AI_GATEWAY_API_KEY (RG5)
  lib/site.ts                 the product's name, the rebrand's seam (RG5)
  app/(preview)/layout.tsx    metadataBase from NEXT_PUBLIC_SITE_URL, which the deploy's build sets per environment (RG5)
  app/(preview)/api/health    the database check the deploy smoke-tests and the bootstrap probes (RG5)
  component.yaml              render wrangler from the wiring doc, build with turbo, deploy; dependsOn hyperdrive + db-migrate, enforced on main
  wrangler.template.jsonc     worker name, nodejs_compat, ASSETS, the HYPERDRIVE binding (token + local string), the AI binding
  wrangler.jsonc              its committed fixture render (RG5)
  wiring.fixture.json         offline Hyperdrive ids for the verify lane
  cloudflare-env.d.ts         HYPERDRIVE, AI, ASSETS on CloudflareEnv
  open-next.config.ts         static-assets incremental cache (the pre-rendered shell), nothing to provision
  scripts/populate-static-assets-cache.mjs   the build's cache copy, which needs no Cloudflare credential (RG5)
packages/db                   @saas/db: the manifest, 000_control, 010_rag_initial (upstream's SQL verbatim), 020_workers_ai_embeddings, 030_row_level_security, the runner
infra/db-migrate              applies packages/db through Supabase's Management API; dependsOn db, supabase, cloudflare-hyperdrive
infra/terraform/supabase      the Supabase project per environment
infra/terraform/cloudflare-hyperdrive  the Hyperdrive config per environment over that project's Postgres
tests/web                     vitest: embedding chunks, the resources action, getDb, cn, the models and the chat route over a scripted AI binding, the wrangler config
tests/db                      vitest: manifest checksums, offline plan, drizzle twins; every migration on PGlite with pgvector — vector(768), cosine ranking, the guards, RLS
```

## 6. Out of scope

Rate limiting (the page's `onError` toast assumes one; the template ships
none), persistence of chats (the template keeps no chat table), a custom
domain, and caching model responses. Supabase Auth and PostgREST are not
used: the app speaks SQL through Hyperdrive as the `postgres` role. Row-level
security IS on every table in `public` (RG5, migration
`030_row_level_security`), with no policy — only so that Supabase's Data API,
which serves `public` to the anon key, serves none of it; the app, as the
tables' owner, is not subject to it.

## 7. Rejected alternatives

**Cloudflare Vectorize for the embeddings.** The template's retrieval is
pgvector SQL — a `vector` column (768 here), an HNSW cosine index, a drizzle
`cosineDistance` query joined to the resources table by foreign key. Moving
the vectors to Vectorize would rewrite the schema, both queries and the
insert path, and split the data across two stores for one table's worth of
rows. Supabase Postgres already has pgvector; the SQL runs as written.

**The AI Gateway as the only model provider** (RG1–RG4's choice, reversed in
RG5). The template is gateway-shaped: model strings resolved by Vercel's AI
Gateway with one key, which works from a Worker exactly as from a function.
But as a baseline the product must chat on a fresh build with only the
connections the platform brokers — Cloudflare and Supabase — and no
platform brokers an AI vendor. Workers AI is in every Cloudflare account and
needs no key, so it is the default for both models; the price is the
embedding dimension (768, not 1536: a migration) and a provider package. The
gateway stays, optional, for the chat only — a key that switches the
embeddings too would orphan every vector already stored.

**Streaming each step from Workers AI.** `workers-ai-provider` 2.0.2 streams
a step after a tool result, and reads a streamed tool call only in Workers
AI's older top-level `tool_calls` chunk shape. The route chains tools across
steps (understandQuery → getInformation → the answer), so a streamed tool
call in the other shape would end the chain silently. Whole responses
(`simulateStreamingMiddleware`) cost nothing a reader would see: the answers
are a sentence long by the system prompt's instruction.

**A module-level `postgres` pool over Hyperdrive.** Tried on Lumen (task
0134) and reverted: the Workers runtime refuses a socket opened in one
request from another. Per-call clients with Hyperdrive holding the pool is
the Lumen shape.
