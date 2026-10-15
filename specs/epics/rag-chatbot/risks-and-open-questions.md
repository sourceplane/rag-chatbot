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

## RG-D — The 1536-dimension embedding model (ACCEPTED)

`openai/text-embedding-ada-002` through the gateway fixes the vector width
the schema declares. A later model with another width is a new migration
(`ALTER COLUMN ... TYPE vector(n)` is a rewrite of the table) and a
re-embedding of every resource; nothing in the port makes that harder or
easier than upstream.

## RG-E — The gateway key is set by hand (ACCEPTED, documented)

The workers-assets composition's parameters do not carry runtime secrets,
so `AI_GATEWAY_API_KEY` is `wrangler secret put` once per environment after
the first deploy (README → Deploying). Until it is set the Worker boots and
serves the page; `/api/chat` streams an authentication error.

## RG-F — Node ≥ 25 stub `localStorage` at prerender (SETTLED)

Nothing in this template reads `localStorage` at prerender; the page is a
client component whose shell renders without it. CI builds on Node 22.

## RG-G — The verify lane has no database (RESOLVED)

`next build` touches neither Postgres nor the gateway: the page is
pre-rendered without data and the route is dynamic. The verify lane renders
`wrangler.jsonc` from the fixture and builds; db-migrate `plan`s offline.
