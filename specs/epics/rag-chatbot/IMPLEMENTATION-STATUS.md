# rag-chatbot (RG) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md` or from the upstream template.

| Milestone | State | PR |
|---|---|---|
| RG0 — the spec | ✅ Shipped | [#1](https://github.com/sourceplane/rag-chatbot/pull/1) |
| RG1 — the chatbot on Workers | ✅ Shipped | [#2](https://github.com/sourceplane/rag-chatbot/pull/2) |
| RG2 — the schema through db-migrate | ✅ Shipped (planned offline; apply gated on a linked workspace) | [#3](https://github.com/sourceplane/rag-chatbot/pull/3) |
| RG3 — Supabase and Hyperdrive from Terraform | ✅ Shipped (validated; apply gated on a linked workspace) | [#4](https://github.com/sourceplane/rag-chatbot/pull/4) |
| RG4 — ready to instantiate | ✅ Shipped | [#5](https://github.com/sourceplane/rag-chatbot/pull/5) |
| RG5 — a baseline | ✅ Shipped | [#6](https://github.com/sourceplane/rag-chatbot/pull/6) (RG-6), tagged `baseline-v1` |
| RG6 — the cirrus standard | ✅ Shipped | [#7](https://github.com/sourceplane/rag-chatbot/pull/7) (RG-7), [#8](https://github.com/sourceplane/rag-chatbot/pull/8) (RG-8), tagged `baseline-v2` |

## Departures from the upstream template

### `getDb()` in place of the module-level `db` (forced by the Workers runtime)

Upstream's `lib/db/index.ts` is `const client = postgres(env.DATABASE_URL!);
export const db = drizzle(client);`. On Workers a `postgres` socket opened in
one request cannot be used by another, and the connection string is the
`HYPERDRIVE` binding's, not an env var. The file now exports an async
`getDb()` that builds `postgres(connectionString, { max: 5, fetch_types:
false, prepare: false })` + drizzle per call, the connection string from
`getCloudflareContext({ async: true }).env.HYPERDRIVE.connectionString`
when a Cloudflare context exists and `env.DATABASE_URL` otherwise (throwing
when neither is set). The two callers changed by one line each:
`lib/actions/resources.ts` (`const db = await getDb()` after the schema
parse) and `lib/ai/embedding.ts` (`findRelevantContent`, after the query
embedding). The schema, the queries, the cosine-distance SQL and the chat
route are as written.

### `DATABASE_URL` optional (`lib/env.mjs`), `drizzle.config.ts` reads `env.DATABASE_URL ?? ""`

t3-env validated `DATABASE_URL: z.string().min(1)` at import; the Worker has
no `DATABASE_URL` (the database is the binding), so it is
`z.string().optional()`. That makes it `string | undefined` for drizzle-kit's
config, which now reads `env.DATABASE_URL ?? ""`. t3-env's `createEnv` runs
unchanged at module load on the Worker and validates with nothing set
(`NODE_ENV` is defaulted); `dotenv.config({ path: ".env.local" })` finds no
file there and returns silently — verified under `wrangler dev`.

### drizzle's migrator leaves the build script

`"build": "tsx lib/db/migrate.ts && next build"` became `next build &&
opennextjs-cloudflare build --skipBuild --skipWranglerConfigCheck &&
opennextjs-cloudflare populateCache local`. The schema is applied by
`infra/db-migrate` from `packages/db` before the Worker deploys;
`lib/db/migrate.ts` stays as `pnpm --filter @app/web db:migrate` for a local
Postgres, and drizzle-kit (`db:generate`, `db:push`, `db:studio`, …) and
`lib/db/migrations` stay for development.

### eslint-config-next 16 flat config

The template's `.eslintrc.json` (`extends: next/core-web-vitals`) and `next
lint` have no Next 16 equivalent. `eslint.config.mjs` is what
`create-next-app` writes for Next 16 (`defineConfig`, `core-web-vitals`,
`typescript`), with two rules off rather than the template rewritten:
`react-hooks/set-state-in-effect` (new in 16; flags the page's
`setIsExpanded` and `setShowLoading` effects) and
`@typescript-eslint/no-empty-object-type` (shadcn's `InputProps extends
React.InputHTMLAttributes<HTMLInputElement> {}` in `components/ui/input.tsx`).
The `lint` script is `eslint .`.

### `tailwind.config.ts` imports, not requires

`require("tailwindcss/defaultTheme")`, `require("tailwindcss-animate")` and
`module.exports` — which the TypeScript ESLint rules reject — are `import`s
and `export default`. That leaves one `import/no-anonymous-default-export`
warning (0 errors); it is kept rather than restructuring the template's
config object.

### `tsconfig.json` rewritten by Next 16; `cloudflare-env.d.ts` added

`next build` set `jsx` to `react-jsx` and added `.next/dev/types/**/*.ts`
to `include` (Next 16's mandatory change). `cloudflare-env.d.ts` declares
`HYPERDRIVE: Hyperdrive` and `ASSETS: Fetcher` on the `CloudflareEnv`
interface `@opennextjs/cloudflare` types `env` with, over
`@cloudflare/workers-types`.

### Not departures, for the record

- `packages/db/src/migrations/010_rag_initial/up.sql` is byte-for-byte
  upstream's `lib/db/migrations/0000_yielding_bloodaxe.sql`, including
  `CREATE EXTENSION IF NOT EXISTS vector` and drizzle-kit's
  `--> statement-breakpoint` comment lines (the runner posts the file whole;
  they are SQL comments).
- The chat route, its tools and system prompt, the page, the components and
  the styles are unchanged. `export const maxDuration = 30` remains and is
  inert on Workers.
- (RG1–RG4) The AI Gateway was used exactly as upstream (model strings, one
  key); the key was a Worker secret instead of a project env var. RG5
  replaced it as the default with Workers AI — below.

### Versions

| Package | Version | Why |
|---|---|---|
| next, eslint-config-next | 16.3.8 | upstream 15.5.7; newest inside `@opennextjs/cloudflare` 1.20.11's range (16.4.x fails at Worker boot) |
| react, react-dom | ^19.2.1 | Next 16.3's peer; upstream ^19.0.0 |
| @opennextjs/cloudflare | ^1.20.11 | the adapter; static-assets incremental cache + `populateCache local` |
| wrangler | ^4.151.0 | dev and deploy |
| @cloudflare/workers-types | ^5.20261006.1 | wrangler 4.151's peer; `Hyperdrive`, `Fetcher` |
| eslint, typescript | ^9.27.0, ^5.8.3 | flat config; upstream ^9.16.0, ^5.7.2 |
| ai, @ai-sdk/react, drizzle-orm, drizzle-zod, postgres, zod, @t3-oss/env-nextjs, streamdown, framer-motion, nanoid, sonner, tailwindcss, tailwind-merge | upstream's ranges | unchanged (`@t3-oss/env-nextjs` 0.11.1 warns about zod 4's peer, as it did upstream) |

## Verified

- Local: `pnpm run wire:fixture`, `pnpm typecheck` (5 packages), `pnpm
  lint` (0 errors, the one tailwind warning), `pnpm test` (12 in
  `tests/web` — utils 2, embedding 3, resources action 3, `getDb` 4 — and 3
  in `tests/db`), `pnpm build` (`/` and `/_not-found` static, `/api/chat`
  dynamic; Worker + static assets) green. `pnpm --filter @saas/db run
  manifest:check` green; `node packages/db/dist/runner/cli.js plan --env
  stage` lists `000_control_baseline` and `010_rag_initial`.
- `wrangler dev` on the built Worker with the fixture Hyperdrive id (its
  `localConnectionString` pointing at a localhost Postgres that was not
  running) and a throwaway `AI_GATEWAY_API_KEY`: `/` 200 ("Retrieval
  Augmented Generation Preview", "Ask me anything..."), `/nope` 404, `POST
  /api/chat` with one user message 200 `text/event-stream` — `start`,
  `error "An error occurred."`, `[DONE]` — the Worker log naming the cause:
  `GatewayError: Unauthenticated. Configure AI_GATEWAY_API_KEY` (the key is
  rejected before any tool runs, so that probe did not reach Hyperdrive;
  `getDb()`'s binding and fallback paths are covered by `tests/web`). Local
  workerd logged a runtime crash and restart after the stream error.
- `terraform init -backend=false && terraform validate` green on
  `infra/terraform/supabase` (supabase/supabase 1.5.1, random 3.9.1,
  external 2.4.2) and `infra/terraform/cloudflare-hyperdrive`
  (cloudflare/cloudflare 4.52.9).
- CI: `Checks` green on #2, #3 and #4; the Orun jobs skip until the product
  is linked.
- Not verified: an apply of the Supabase and Hyperdrive roots, a db-migrate
  apply (and so `CREATE EXTENSION vector` through the Management API), a
  live deploy, and an end-to-end chat against a real pgvector database with
  a real gateway key — all need the product linked to an Orun workspace with
  Supabase and Cloudflare connections (`ORUN_CI`) and `AI_GATEWAY_API_KEY`
  set per environment with `wrangler secret put` (README → Deploying).

## RG5 — a baseline (RG-6)

The repository is an Orun baseline on the Lumen conventions, built the way
cirrus-baseline v22 builds a product — ONE landing — and copied closely from
saas-starter's SA5 (sourceplane/saas-starter#6). `blueprint.yaml` is the card
(`requires: [github, cloudflare, supabase]`; the five brokered keys —
`CLOUDFLARE_API_TOKEN` workers-deploy, `CLOUDFLARE_HYPERDRIVE_TOKEN`
hyperdrive-edit, `CLOUDFLARE_ACCOUNT_ID` account-id, `SUPABASE_ACCESS_TOKEN`
management-access, `SUPABASE_ORG_ID` org-id — as a preview; programme
`01-product`, `02-docs`; the two-Supabase-projects prerequisite in its
description); `repo-blueprint.yaml` places every module in `01-product`,
brands it, links the repository, reconciles the five keys and lands it as
one pull request, then awaits the convergence, the four published secrets on
stage and prod and `/` + `/api/health`; `02-docs` restores the promotion gate
and dev's lanes and renders the record. The machinery is
portfolio-starter-kit's (`baseline-v2`) by way of saas-starter — `.baseline/`,
the rename engine, the bootstrap helpers, the deployment-record hook,
`ai/context/`, `testing/`, `baseline.yml`, `tag.yml`, `ci.yml`'s `linked`
gate.

### Departures, in the product

- **The models are Workers AI's** (`lib/ai/models.ts`, new). Upstream named
  `openai/gpt-4o` and `openai/text-embedding-ada-002` as AI Gateway strings
  and could answer nothing without `AI_GATEWAY_API_KEY`; the platform brokers
  no AI vendor. The Worker binds Workers AI as `AI` (`wrangler.jsonc`) and
  `workers-ai-provider` 2.0.2 (the AI SDK v5 release) serves
  `@cf/meta/llama-4-scout-17b-16e-instruct` to the chat and to
  understandQuery's `generateObject` (function calling, JSON mode) and
  `@cf/baai/bge-base-en-v1.5` to the embeddings. The chat model is wrapped in
  `simulateStreamingMiddleware` — every step one whole `AI.run` (RG-I).
  `AI_GATEWAY_API_KEY` is optional: set, the chat (only) is upstream's
  `openai/gpt-4o` through the gateway. With neither a binding nor a key the
  route answers 503 with the reason and the page's toast shows it (upstream's
  toast assumed a rate limit). The route and `lib/ai/embedding.ts` change only
  where they name a model; the tools, the system prompt, the chunking and the
  retrieval SQL are upstream's.
- **The embeddings column is 768 wide** (migration
  `020_workers_ai_embeddings`, drizzle-kit twin `0001` — written by hand,
  because upstream's 0000 snapshot never recorded `embeddings`; `0001`'s
  snapshot is drizzle-kit's). It resizes `vector(1536)` to `vector(768)`, the
  HNSW index rebuilt by the ALTER, after a guard that refuses while any row
  holds another model's vector. `010_rag_initial` stays upstream's, byte for
  byte. `schema/embeddings.ts` says `dimensions: 768`.
- **Row-level security on every table in `public`** (migration
  `030_row_level_security`, twin `0002`, `.enableRLS()` on both tables), with
  no policy and saas-starter's guard (RG-M). `tests/db` (PGlite with
  pgvector) and the e2e hold it.
- **The page's public origin is the environment's own** (RG-P):
  `metadataBase` is `NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`),
  not upstream's demo origin, and the deploy's build sets it to `SITE_URL`
  from the environment's `env:` (a custom domain) or else its workers.dev URL
  — so the pre-rendered page's `og:image` names the product's own Worker.
- **`/api/health`** (new, `app/(preview)/api/health`): 200 only when the
  database behind the HYPERDRIVE binding answers, both tables exist and the
  embeddings column is the embedding model's size; it reports `chat`
  (`workers-ai` | `ai-gateway`) and calls no model. The deploy's smoke, both
  phases' probes and the deployment record read it.
- **The product's name is one seam** (`lib/site.ts`, `SITE_NAME`), the page's
  `<title>` (upstream's literal "Retrieval Augmented Generation Preview"). The
  overview card's link to the AI SDK guide — whose path ends in this
  baseline's slug — stays upstream's; the rename engine protects it.
- **`apps/web/wrangler.jsonc` is committed** — the fixture render of the
  template, now with the `ai` binding — because the composition checks for it
  before the build. The stage and prod lanes re-render it from their wiring
  document; dev verifies with the fixture. `tests/web` holds the two equal.
- **The build needs no Cloudflare credential** (RG-L): `next.config.mjs`
  starts OpenNext's platform proxy only under `next dev`, and the build's last
  step is `scripts/populate-static-assets-cache.mjs` — the copy `populateCache
  local` makes for the static-assets cache, without the proxy that command
  opens first (which, with an AI binding, demands an account).
- **The deploy order is enforced on main** (`dependsOn` with `mode: enforced`
  and an advisory `modeRules` entry for pull requests): `cloudflare-hyperdrive`
  → `supabase`; `db-migrate` → `supabase`, `cloudflare-hyperdrive`; `web` →
  `cloudflare-hyperdrive`, `db-migrate`. `web`'s smoke reads `/api/health`.
- **The supabase root publishes Lumen's three outputs** and no longer reads
  the project's API keys; both roots carry Lumen's `.terraform.lock.hcl`.
- **stack-tectonic 0.19.0** (was 0.18.2; not 0.20.0), **`checks.yml` on pull
  requests only**, `ci.yml`'s `linked` gate in place of the `ORUN_CI`
  variable and its lanes on v2.78.4. `packages/db`'s runner reads
  `SUPABASE_API_URL` so the e2e can point it at a stand-in.
- `apps/web/README.md` describes the app as it runs here; `intent.yaml`'s docs
  pages are the product's `ai/context/` pages. Task contracts carry
  `metadata.name`/`title`.


### Verified (RG5)

- The repository's checks: `pnpm install --frozen-lockfile`, `wire:fixture`
  (the committed `wrangler.jsonc` unchanged), typecheck (5 packages), lint (0
  errors, the one tailwind warning), test — 45: 32 in `tests/web` (the
  models and the chat route over a scripted AI binding through the real
  provider, the wrangler config, the page's public origin, plus the RG1
  suites) and 13 in `tests/db`
  (every migration on PGlite with pgvector: `vector(768)`, cosine ranking,
  020's and 030's guards, RLS against a role with the Data API's grants) —
  and build, with no Cloudflare credential. `manifest:check`, `drizzle-kit
  check` and a `drizzle-kit generate` that finds nothing to generate; the
  drizzle-kit twins applied by `pnpm db:migrate` to a local Postgres with
  pgvector.
- Every `testing/*.test.sh`: manifest, phases, coverage, rebrand, retouch,
  bootstrap-defer and leak green; placement green at orun v2.58.11, v2.78.4
  and 2.79.0 (the product's push-to-main plan supabase → cloudflare-hyperdrive
  → db-migrate → web, enforced; the pull request's plan advisory at ≥ the
  lane pin; exactly the five minted keys; `--resume` a no-op); e2e green at
  v2.78.4 (the CI pin) — the db-migrate lane's own steps apply all four
  migrations and re-apply nothing; the web lane's steps, structure check
  included, build in the staged job tree; `wrangler dev` with no `.dev.vars`
  and `AI` bound to the Workers AI stand-in passes the smoke, `/`, a 404 and
  `/api/health`, serves an `og:image` on the product's own stage origin (not
  vercel.app), adds a document (1 resource, 3 `vector(768)` rows), answers a
  question about it from the one chunk ranked above 0.3 (0.83), answers
  "Sorry, I don't know." to one it was never told, and `anon` /
  `authenticated` read neither table and write neither.
- `orun new --status` at v2.58.11, v2.78.4 and 2.79.0; `orun validate`;
  `orun work check` clean. `terraform fmt -check`, `init -backend=false` and
  `validate` on both roots, Lumen's lock files unchanged by `init`.
- Verified only offline (RG-J, RG-K): the models themselves — the e2e's
  Workers AI is a deterministic stand-in answering in the catalog's shapes —
  and the deploy token's ability to attach an AI binding; a Terraform apply,
  a db-migrate apply against a real Supabase project (so `CREATE EXTENSION
  vector` as `postgres` there), a live deploy and a live bootstrap.

## The cirrus standard (RG6)

Nothing about the chatbot changed. What changed is the baseline around it:

| What | Before | After | Why |
|---|---|---|---|
| orun pin | `kiox.yaml` (v2.15.0) + `kiox.lock`, shipped to every product | gone; orun is pinned where it runs, the `orun-action` `version:` in each workflow | nothing ran the kiox pin, and it disagreed with the lanes (v2.78.4) |
| `root-kiox`, `root-kiox-lock` modules | in `01-product` | removed (`testing/phases.test.sh` and the rebrand's skip list follow) | a product is placed with 145 files: no kiox, plus the docs below |
| component docs | none | `docs/overview.md`, `architecture.md`, `runbook.md` beside each of the seven `component.yaml` files (`apps/web`, `packages/db`, `infra/db-migrate`, `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `tests/web`, `tests/db`) — 21 pages | cirrus-baseline documents every component; the workspace Docs library renders `docs/` beside each `component.yaml` |
| how the docs stay true | — | `tooling/catalog/gen-component-docs.py` derives them from the manifest, the Worker config, Terraform, migrations and package scripts; Baseline CI runs it with `--check` | a hand-written copy of a manifest drifts silently |
| context pack | `operations.md`, `deployment.md` | plus `current.md`, `decisions.md`, `open-risks.md` | cirrus-baseline's shape; the three new pages are this repository's own and no module places them (the leak gate still allows exactly two) |
| status | RG5 "in review" on its branch | RG5 shipped ([#6](https://github.com/sourceplane/rag-chatbot/pull/6)) and tagged `baseline-v1` | the tag existed; the documents had not caught up |

### The subdomain from the Cloudflare connection (RG-8)

`subdomain` was the one input an operator typed that the platform could
answer itself: it belongs to the Cloudflare account the same way its id does,
and it has exactly one right answer. A typed one could only be wrong, and
wrong showed up after deploy — in the public origin the Open Graph image link
is built from (RG-P), the deploy's smoke, the phase probes and the console's
verify URLs. `blueprint.yaml` now declares
`from: connection.cloudflare.workersSubdomain`, as cirrus-baseline does since
baseline-v23: the Cloudflare integration reads the subdomain at connect and on
its hourly health check, and the bootstrap door fills the input from the
connection the build is bound to — the same one `CLOUDFLARE_ACCOUNT_ID` and the
deploy tokens mint from. The console renders no field for it, and an account
with no workers.dev subdomain is refused at the door with the fix named.

- `testing/manifest.test.sh` takes cirrus-baseline's rule verbatim: the source
  is accepted, and only when `spec.requires.integrations` lists its provider.
- `repo-blueprint.yaml` keeps the input and its default; it, `BOOTSTRAP.md`
  and `docs/phases/README.md` say only a hand-run build passes
  `--set subdomain`.
- Nothing a product carries changes: the rename writes the value where it
  always did (`workersDevSubdomain`, the build line's site URL, the URLs), and
  the probes read it as before.

Verified:

- `testing/{manifest,phases,coverage,rebrand,retouch,bootstrap-defer}.test.sh`
  green; `gen-component-docs.py --check` green (7 components).
- Mutation: with `cloudflare` dropped from `spec.requires.integrations`,
  `manifest.test.sh` fails with exactly one finding, naming
  `inputs[subdomain]`; restored, it passes.
- At v2.58.11 (the blueprint job's pin, placement included):
  `orun new --status` reads the document (`01-product` pending, 145 files);
  `testing/leak.test.sh` 145 files derived, 141 text files read;
  `testing/placement.test.sh` 145 files placed, both landings, the product's
  own plan orders supabase → cloudflare-hyperdrive → db-migrate → web on
  stage and prod; exactly the five minted keys; `--resume` a no-op.
- `orun task check RG-8` complete.

## Verified (RG6)

- `testing/{manifest,phases,coverage,rebrand,retouch,bootstrap-defer}.test.sh`
  green; `gen-component-docs.py --check` green (7 components, 21 pages).
- `testing/leak.test.sh` at v2.58.11 (the blueprint job's pin): 145 files
  derived (the 2 kiox files out, the 21 docs pages in), 141 text files read;
  `ai/context` still exactly the two declared pages; none of the 15 factory
  paths ships or is named by a shipped file, the generated pages included.
- `testing/placement.test.sh` at v2.58.11: 145 files placed, both landings,
  branded and re-tenanted; the product's own push-to-main plan supabase →
  cloudflare-hyperdrive → db-migrate → web, enforced, on stage and prod;
  exactly the five minted keys; `--resume` a no-op.
- `pnpm install --frozen-lockfile`, `wire:fixture` (the committed
  `wrangler.jsonc` unchanged), typecheck (5 packages), lint (0 errors, the one
  tailwind warning), test — 45: 32 in `tests/web`, 13 in `tests/db` — and
  build green.
- `testing/e2e.test.sh` at v2.78.4 (the product job's pin) green: the
  db-migrate lane applies all four migrations and a second apply applies
  nothing; the web lane's steps build in the staged job tree; `wrangler dev`
  with `AI` on the stand-in passes the smoke, adds a document (1 resource, 3
  `vector(768)` rows), answers from the chunk ranked 0.83, and `anon` /
  `authenticated` read and write nothing.
- `orun task check RG-7` complete.
