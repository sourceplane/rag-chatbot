# rag-chatbot — operating contract (for humans and agents)

This is the standing guide to how this product is deployed and operated.
Instance facts (live URLs, workspace, which model the chat runs on, the
secrets it uses) live in [deployment.md](deployment.md), rendered from
probed reality by the bootstrap's `02-docs` phase; this file is the contract
that stays true between deployments. It is written to give an agent with
repository read access enough context to reason about and operate the product
without any other source.

## What this system is

Vercel's AI SDK RAG chatbot — a chat that keeps what you tell it and answers
from it: `useChat` on the page, `streamText` with three tools on the server
(`addResource` chunks a resource on full stops, embeds each chunk and stores
the vectors; `getInformation` embeds the question and retrieves the closest
chunks by cosine similarity; `understandQuery` rephrases the question) — on
Cloudflare Workers. Its models are **Workers AI's**, through the Worker's
`AI` binding: `@cf/meta/llama-4-scout-17b-16e-instruct` for the chat and
`@cf/baai/bge-base-en-v1.5` (768 dimensions) for the embeddings
(`apps/web/lib/ai/models.ts`). Its knowledge base is a Supabase project's
Postgres with pgvector, reached through Cloudflare Hyperdrive. Expressed as
an Orun component-native desired-state repo. Seven components:

- **`infra/terraform/supabase`** (`supabase`) — one Supabase project per
  environment. Its apply publishes `SUPABASE_PROJECT_REF`,
  `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL` onto the environment's secret
  rung.
- **`infra/terraform/cloudflare-hyperdrive`** (`cloudflare-hyperdrive`) — one
  Hyperdrive config per environment over that database. Its apply publishes
  `WIRING_CLOUDFLARE_HYPERDRIVE` (the config's id and name).
- **`infra/db-migrate`** (`db-migrate`) — applies `packages/db`'s migrations
  to the environment's database through Supabase's Management API: the
  `vector` extension, `resources`, `embeddings` (`vector(768)` with an HNSW
  cosine index) and row-level security. Each migration is recorded with its
  checksum in `_migrations.applied`; only the missing ones apply.
- **`packages/db`** (`db`) — the migrations and their runner.
- **`apps/web`** (`web`) — the app: Next.js built by `@opennextjs/cloudflare`
  into one Worker plus Static Assets. It reaches Postgres through its
  `HYPERDRIVE` binding, one client per call (`lib/db/index.ts`), and its
  models through its `AI` binding.
- **`tests/web`**, **`tests/db`** — vitest suites, verified on the `dev` rung.

Environments: **`stage`** and **`prod`** are deployed; **`dev` is
verify-only by design** — lanes build and test, nothing deploys.

## Identity and tenancy

Every remote operation runs against ONE Orun workspace, declared in
`intent.yaml` under `execution.state.workspace` — committed, enforced, and
what CI uses. Do not remove it; headless credentials depend on it. If it
reads `ws_SET_ME`, the bootstrap had no workspace to write: set the real one
before anything else.

## How deployment works

1. Merge (or push) to `main`.
2. CI (`.github/workflows/ci.yml`) runs `orun plan --changed` — only
   components whose files changed are planned — then runs each planned lane
   with `orun run --remote-state`, authenticated by GitHub OIDC (the
   exchange resolves this repository's linked workspace server-side).
3. Per environment, in this order — each edge `mode: enforced` on a push to
   main, advisory on a pull request (which deploys nothing):
   **`supabase` → `cloudflare-hyperdrive` → `db-migrate` → `web`.** A job
   resolves its secrets when it starts, so each one reads what the apply
   before it published. The app's deploy re-renders `apps/web/wrangler.jsonc`
   from `WIRING_CLOUDFLARE_HYPERDRIVE` before it builds, deploys
   `rag-chatbot-web-<env>`, and smoke-tests it: the chat page, and
   `/api/health`, which answers 200 only when the database is reachable
   through Hyperdrive and migrated (the embeddings column at 768
   dimensions). Neither calls a model.
4. `prod` deploys after `stage` has converged on the same commit
   (`environments.prod.promotion` in intent.yaml).
5. **The convergence run is the deployment.** A green run means every
   planned lane applied. Failed lanes are retried with
   `gh run rerun --failed`, which resumes the same execution.

Caveats that matter:

- A push that touches no component files plans zero lanes — that run is
  green and deployed nothing. Never treat "latest run green" as "product
  converged"; probe the URLs instead.
- `apps/web/wrangler.jsonc` is committed as the render of
  `wrangler.template.jsonc` from `wiring.fixture.json` (a placeholder
  Hyperdrive id): edit the template and run `pnpm run wire:fixture`. The
  deploy lanes render the real one in their own job tree; never commit a
  real id.
- **The embedding model and the column are one decision.** `embeddings` is
  `vector(768)` because `@cf/baai/bge-base-en-v1.5` is 768-dimensional.
  Changing the model means a new migration that resizes the column, AND
  re-adding every resource: vectors from two models share no space, even at
  the same size. Changing the CHAT model is a one-line change in
  `lib/ai/models.ts`, with no migration.
- Every table in `public` has row-level security and no policy. Supabase's
  Data API serves `public` to the anon key, so this is what keeps every
  resource and embedding out of it; the app is unaffected because it
  connects as `postgres`, the tables' owner. Give a new table
  `.enableRLS()`; never `FORCE` it, and never add a policy for `anon` without
  meaning to publish that table.
- A migration is immutable once applied: its checksum is in
  `packages/db/src/manifest.ts` and in the database's ledger. Change the
  schema with a NEW migration (in `packages/db/src/migrations`, and its
  drizzle-kit twin in `apps/web/lib/db/migrations` for local databases).

## Secrets model

- **Brokered provider secrets**, minted per run from the workspace's
  connections — no long-lived values at rest, nothing to rotate by hand:
  `CLOUDFLARE_API_TOKEN` (Workers deploy, the AI binding included),
  `CLOUDFLARE_HYPERDRIVE_TOKEN` (Hyperdrive — the deploy token deliberately
  cannot touch it), `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN` (project
  create and migrations) and `SUPABASE_ORG_ID`.
- **Published by the applies** onto the stage and prod rungs:
  `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`,
  `WIRING_CLOUDFLARE_HYPERDRIVE`.
- **No model key.** Workers AI is the Cloudflare account the Worker runs in;
  it bills that account after its free daily allocation.
- **Optional, the owner's:** `AI_GATEWAY_API_KEY`, a Worker secret, switches
  the chat to a vendor model (below). No platform brokers it.
- Inspect by NAME only: `orun secrets list --org <ws> --project` and
  `--env stage|prod`. No tooling in this repository prints a secret value,
  and no document in `ai/context/` may contain one.

## Use a vendor model instead

The chat runs on Workers AI unless the environment's Worker has an
`AI_GATEWAY_API_KEY`. With one, the chat is `openai/gpt-4o` through Vercel's
AI Gateway (https://vercel.com/ai-gateway) — the model the upstream template
shipped with. Per environment (`stage`, `prod`):

```bash
wrangler secret put AI_GATEWAY_API_KEY --name rag-chatbot-web-<env>
```

Worker secrets survive every later deploy; nothing in CI touches them. The
next request chats on the gateway's model, and `/api/health` reports
`"chat":"ai-gateway"`. To go back, `wrangler secret delete AI_GATEWAY_API_KEY
--name rag-chatbot-web-<env>`. **Embeddings stay on Workers AI either way**:
the knowledge base's column is sized to its model. Re-running the bootstrap's
`02-docs` phase records the change in [deployment.md](deployment.md).

## Verifying the system

```bash
# the app and its database path on each environment (also recorded, probed, in deployment.md)
curl -s -o /dev/null -w '%{http_code}\n' https://rag-chatbot-web-stage.your-workers-subdomain.workers.dev/
curl -s https://rag-chatbot-web-prod.your-workers-subdomain.workers.dev/api/health

# the whole path, models included: tell it something, then ask
#   (the chat page does this; so does POST /api/chat with useChat's body)

# workspace readiness (integrations + repository link)
orun integrations list --org <ws> --json && orun cloud check --org <ws>
```

## Common operations

| task | how |
|---|---|
| deploy a change | merge to `main`; watch the run; failed lanes → `gh run rerun --failed` |
| deploy by hand | Orunbase's Deploy button, or `gh workflow run ci.yml --ref main -f environment=<env> [-f component=<a,b>]` — the named components (blank: every one) run in that environment as a merge runs them; started off `main` it is refused |
| change the schema | add the table under `apps/web/lib/db/schema/` with `.enableRLS()`, `pnpm --filter @app/web db:generate`, copy the SQL into a new `packages/db/src/migrations/<nnn>_<name>/up.sql` and the manifest (`pnpm --filter @saas/db run manifest:fix` for its checksum), merge — db-migrate applies it before the app deploys. `pnpm test` fails on a table in `public` without row-level security |
| change the chat model | `WORKERS_AI_CHAT_MODEL` in `apps/web/lib/ai/models.ts` — a Workers AI model with function calling and JSON mode |
| change the embedding model | a new migration resizing `embeddings.embedding`, `WORKERS_AI_EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` in `lib/ai/models.ts`, then re-add every resource |
| redeploy without a change | edit the last line of the component's `component.yaml` (`# orun: redeploy <reason> <stamp>`) and merge — it is a deploy trigger, nothing reads it |
| use a vendor chat model | above |
| serve a custom domain | attach it to the Worker in Cloudflare, then set `SITE_URL` under that environment's `env:` in `intent.yaml` (the page's Open Graph link is absolute), replace the placeholder `rag-chatbot.example.com` in its `BASE_DOMAIN` with the domain, and merge |
| headless credentials | `ORUN_TOKEN` (workspace-scoped) + `GITHUB_TOKEN` |

The deployment record is the bootstrap's `02-docs` phase. Re-running it (the
Orun console's Retry on that phase, or `orun new … --phase 02-docs`)
re-probes the URLs and re-renders [deployment.md](deployment.md); it is
idempotent.

## Evolution

Structural changes (a second Worker, a queue, another data store) follow the
same contract that deployed the product: add a component under `apps/`,
`infra/` or `packages/` with a `component.yaml` — declaring `dependsOn` on
any infrastructure whose published secrets it reads, enforced on main — land
it as a pull request, and the convergence run applies it.
