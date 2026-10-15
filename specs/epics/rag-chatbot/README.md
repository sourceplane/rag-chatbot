# Epic: rag-chatbot (RG)

**Vercel's AI SDK RAG template is a chatbot whose memory is a Postgres table of pgvector embeddings. Its chat route streams `streamText` with three tools; its server action chunks a resource, embeds it through the AI Gateway and inserts the vectors; its retrieval is one cosine-distance query. None of that cares whether the server is a Vercel function or a Cloudflare Worker, and the gateway is reached by API key either way. The port keeps the code and moves the three things that are Vercel's: where the app runs (an OpenNext Worker + Static Assets), how it reaches Postgres (a Supabase project's database, which ships pgvector, through a Hyperdrive config — the one change the Workers runtime forces is that the `postgres` client is built per call from the binding rather than once at module scope), and when the schema is applied (Orun's db-migrate component before the deploy, instead of `drizzle migrate` inside `next build`).**

The upstream code stays the code: the chat page, the route and its tools, the resources action, the embedding helpers, the Drizzle schema and the generated SQL. The port adds the Workers build, the monorepo wrapper, `getDb()`, the migration package and runner (`@saas/db`, Lumen's), test packages that exercise the chunking, the action and the client with the database and the gateway mocked, the Supabase and Hyperdrive Terraform roots, and the deploy contract that renders the Hyperdrive id into the Worker per environment.

## Status

| Field | Value |
|-------|-------|
| Status | Draft — RG0 in review |
| Cluster | **RG** (RG0–RG4) |
| Owner(s) | `apps/web` (the app) · `packages/db` + `infra/db-migrate` (the schema) · `tests/web`, `tests/db` · `infra/terraform/{supabase,cloudflare-hyperdrive}` (the database) |
| Builds on | `lumen` conventions — the `supabase` and `cloudflare-hyperdrive` roots, `@saas/db` with the db-migrate composition, the per-request Hyperdrive client; `supabase-starter` for the repository and the rendered-wrangler shape |
| Upstream | [vercel-labs/ai-sdk-preview-rag](https://github.com/vercel-labs/ai-sdk-preview-rag) |
| Changes | Adds the Workers build, the monorepo wrapper, tests, the migration package, both Terraform roots and the deploy contract; in the template's code: `lib/db/index.ts` exports `getDb()` instead of `db`, its two callers await it, `DATABASE_URL` is optional in `lib/env.mjs` |
| Decisions locked | (1) OpenNext on Workers + Static Assets, static-assets incremental cache. (2) Postgres through Hyperdrive, a `postgres` client per call; no module-level pool. (3) pgvector stays: the schema is the template's SQL, applied by db-migrate; not Vectorize. (4) The AI Gateway stays; `AI_GATEWAY_API_KEY` is a Worker secret. (5) `wrangler.jsonc` is rendered per environment from the wiring document; never committed. |
| Gate | RG1 is the first user-visible rung. RG2 and RG3 need a workspace with Supabase and Cloudflare connections to apply; both are verified by `plan` and `validate`. |
| Shipped as | — |

## Read order

1. `design.md` — what maps to what, the request flow, the env/secret flow, what was rejected
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| RG0 — the spec | this doc set and the task contracts | merged on `main` |
| RG1 — the chatbot on Workers | `apps/web` built by OpenNext with `getDb()`, rendered wrangler config, `tests/web` | `wrangler dev` serves `/`; `/api/chat` reaches the binding; Checks green |
| RG2 — the schema through db-migrate | `packages/db`, `tests/db`, `infra/db-migrate` | the manifest checks; the offline plan lists the schema |
| RG3 — Supabase and Hyperdrive from Terraform | both roots, the app's `dependsOn` and `secretEnv` | both roots validate; the wiring keys match the template's tokens |
| RG4 — ready to instantiate | README, as-built status | a reader can run, test, preview and deploy it |
