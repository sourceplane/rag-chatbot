# rag-chatbot — risks and open questions

## RG-A — A `postgres` client per request on Workers (RESOLVED)

A module-level pool is what the template has and what Workers refuse: a
socket opened in one request cannot be used by another ("Cannot perform I/O
on behalf of a different request"; Lumen task 0134 tried and reverted).
`getDb()` builds a client per call with `max: 5`, `fetch_types: false`,
`prepare: false`; Hyperdrive holds the real pool and keeps the connections
warm, so the per-request cost is one handshake to the nearest Hyperdrive
edge, not to Supabase. The clients are not `end()`ed explicitly: the
request's isolate goes away with them, and Hyperdrive reclaims the origin
side.

## RG-B — pgvector on Supabase through the Management API (RESOLVED)

The migration starts with `CREATE EXTENSION IF NOT EXISTS vector`. Supabase
installs pgvector on every project and the Management API's
`/database/query` runs as a role that may enable it, so the statement is
both valid and idempotent there. The runner sends the file as one request;
the `--> statement-breakpoint` lines drizzle-kit wrote are SQL comments and
pass through — the file is kept byte-for-byte with upstream's.

## RG-C — t3-env at Worker boot (RESOLVED)

`lib/env.mjs` runs `createEnv` when `lib/db/index.ts` is first imported —
on the Worker, at the first chat request. With `DATABASE_URL` optional and
`NODE_ENV` defaulted it validates with nothing set, so the Worker boots
without a `DATABASE_URL`; `next build` prerenders only the page, which does
not import it. `dotenv.config({ path: ".env.local" })` finds no file on
the Worker and returns its error object silently. Verified under `wrangler
dev`: `/` 200, `POST /api/chat` reaches the route.

## RG-D — The 1536-dimension embedding model (SUPERSEDED by RG-H)

`openai/text-embedding-ada-002` through the gateway fixed the vector width
the schema declared. RG5 moved the embeddings to Workers AI, 768 dimensions:
migration `020_workers_ai_embeddings` resizes the column (refusing while a
row holds another model's vector), exactly the "new migration and a
re-embedding" this entry foresaw.

## RG-E — The gateway key is set by hand (SUPERSEDED by RG-H)

There is no key to set: the models are Workers AI's. `AI_GATEWAY_API_KEY`
remains an optional Worker secret an owner sets by hand to put the chat on
upstream's gateway model.

## RG-F — Node ≥ 25 stub `localStorage` at prerender (SETTLED)

Nothing in this template reads `localStorage` at prerender; the page is a
client component whose shell renders without it. CI builds on Node 22.

## RG-G — The verify lane has no database (RESOLVED)

`next build` touches neither Postgres nor the gateway: the page is
pre-rendered without data and the route is dynamic. The verify lane renders
`wrangler.jsonc` from the fixture and builds; db-migrate `plan`s offline.

## RG-H — Workers AI as the default models (RESOLVED, RG5)

The platform brokers no AI vendor, so a product must chat on a fresh build
with only Cloudflare and Supabase connected. Workers AI is in every
Cloudflare account and needs no key: `lib/ai/models.ts` binds
`@cf/meta/llama-4-scout-17b-16e-instruct` (function calling, JSON mode) for
the chat and `@cf/baai/bge-base-en-v1.5` (768 dimensions) for the
embeddings, through `workers-ai-provider` 2.0.2 — the release for AI SDK v5.
Its model-id types are narrowed by an older catalog shape, so the ids are
checked against `keyof AiModels` (workers-types 5.20261015) and cast where
passed. `AI_GATEWAY_API_KEY`, if set, switches the chat — never the
embeddings — back to `openai/gpt-4o` through the gateway.

## RG-I — Tool calls streamed from Workers AI (RESOLVED, RG5)

`workers-ai-provider` 2.0.2 streams every step after a tool result and reads
a streamed tool call only from Workers AI's older top-level `tool_calls`
chunks. The route chains tools across steps, so a model that streamed the
OpenAI-style `choices[].delta.tool_calls` would end the chain with no answer.
The chat model is wrapped in `simulateStreamingMiddleware`: every step is one
whole `AI.run`, whose tool calls the provider parses in both shapes. The
client still receives a UI message stream; the answer arrives whole.

## RG-J — The models are verified only against a stand-in (OPEN)

Workers AI has no local mode, and the e2e has no Cloudflare account. It
binds `AI` to `testing/lib/fake-workers-ai.js` — a Worker whose `run()`
answers in the shapes the catalog types for the two models: bag-of-words
embeddings at 768 dimensions and a scripted tool-calling model. So the
provider, the tool loop, the SQL and the stream are proven; whether Llama 4
Scout calls the tools as the system prompt asks, whether its tool calls carry
the `id` the provider needs to read them as OpenAI-style calls, whether Workers
AI's JSON mode accepts the AI SDK's JSON schema for understandQuery, and how
well bge-base-en-v1.5 retrieves are not. `tests/web` covers the same shapes
offline. A bootstrap against a real account is the first live check.

## RG-K — The Workers AI binding and the brokered deploy token (OPEN)

The `workers-deploy` template grants Workers Scripts and KV write. Uploading
a script with an `ai` binding is expected to need nothing more — the binding
is the account's own — but no deploy with a brokered token has been run. If
Cloudflare asks for a Workers AI permission at upload, the deploy fails with
an authentication error naming the binding (BOOTSTRAP.md, Troubleshooting),
and the template needs the permission group.

## RG-L — The build and Workers AI's remote-only binding (RESOLVED, RG5)

Wrangler treats an `ai` binding as remote-only, and its platform proxy opens
a session to the account whenever one is configured — under
`initOpenNextCloudflareForDev()` at `next build`, and under `opennextjs-cloudflare
populateCache local`, which starts the proxy only to read string vars. With
no credential (Checks, the verify lanes) both failed the build. The proxy now
starts only under `next dev` (`next.config.mjs` checks the phase), and the
build's last step copies the static-assets cache itself
(`scripts/populate-static-assets-cache.mjs`, OpenNext's own `CACHE_DIR`).
`next dev`, `wrangler dev` and `opennextjs-cloudflare preview` need `wrangler
login` for the AI binding; the README says so.

## RG-M — Row-level security (RESOLVED, RG5)

Supabase's Data API serves `public` to the project's anon key. Migration
`030_row_level_security` enables RLS with no policy on `resources` and
`embeddings`, after a guard that refuses if `postgres` (Hyperdrive's role)
would be locked out. `tests/db` fails on any table in `public` without RLS;
the e2e proves `anon` and `authenticated` read nothing while the app wrote
and read through its own connection.

## RG-N — pgvector in the e2e's Postgres stand-in (ACCEPTED)

On Supabase `postgres` creates pgvector itself (supautils). The e2e's
stand-in has no supautils and its `postgres` is no superuser, so the
superuser creates the extension up front and migration 010's `CREATE
EXTENSION IF NOT EXISTS vector` skips there. `tests/db` runs that statement
for real (PGlite with `@electric-sql/pglite-pgvector`); a db-migrate apply
against a real project is the first time it runs as `postgres`.

## RG-O — Two Supabase projects per product (ACCEPTED, documented)

Each product creates `<reponame>-stage` and `<reponame>-prod`. Supabase's
free plan allows two active projects per organization, so the organization
must have room for both; the card's description and BOOTSTRAP.md say so.

## RG-P — The page's Open Graph base URL is upstream's (ACCEPTED)

`app/(preview)/layout.tsx` keeps upstream's `metadataBase`
(`https://ai-sdk-preview-rag.vercel.app`), so a shared link's preview image
resolves to upstream's copy of the same image. Nothing in the app knows its
own origin per environment; a product that wants its own sets
`metadataBase` to its domain.
