# rag-chatbot — implementation plan

Milestones land in order; each task is one pull request on an
`orun/RG-n-<slug>` branch with an `Orun-Task: RG-n` trailer.

## RG0 — the spec ✅

This doc set, `epic.yaml` and the task contracts, merged to `main`.

**Done when**
- the five documents and `epic.yaml` are on `main`
- `tasks/RG-1..RG-5.TaskContract.yaml` exist

## RG1 — the chatbot on Workers ✅

`apps/web` is the upstream template with the Workers build around it:
`lib/db/index.ts` exports `getDb()` over the `HYPERDRIVE` binding,
`lib/env.mjs` makes `DATABASE_URL` optional, the build script is `next
build` + the OpenNext build (drizzle's migrator leaves the build);
`wrangler.template.jsonc` + `wiring.fixture.json` render the config;
`tests/web` exercises the chunking, the resources action and `getDb()`.

**Done when**
- `pnpm install && pnpm run wire:fixture && pnpm typecheck && pnpm lint && pnpm test && pnpm build` is green locally and in `Checks`
- `wrangler dev` answers `/` with the chat page; `POST /api/chat` reaches the Hyperdrive binding and the gateway (and fails on them, without a database or a key)
- the template's code is unchanged except for `getDb()`, its two callers and the optional `DATABASE_URL`

## RG2 — the schema through db-migrate ✅

`packages/db` (`@saas/db`) carries the template's SQL verbatim as
`010_rag_initial/up.sql` with its checksum in the manifest; `tests/db`
verifies the manifest; `infra/db-migrate` applies it per environment.

**Done when**
- `pnpm --filter @saas/db run manifest:check` passes
- `node packages/db/dist/runner/cli.js plan --env stage` lists `000_control_baseline` and `010_rag_initial`
- `tests/db` is green

## RG3 — Supabase and Hyperdrive from Terraform ✅

`infra/terraform/supabase` provisions a project per environment and
publishes its secrets; `infra/terraform/cloudflare-hyperdrive` provisions a
Hyperdrive config per environment over it and publishes the wiring document;
`apps/web/component.yaml` depends on both (and on db-migrate) and declares
the `secretEnv` the render reads.

**Done when**
- `terraform validate` passes on both roots
- the component's `secretEnv` keys match the Hyperdrive root's `secretOutputs`
- the fixture's wiring keys match the template's tokens (`wire:fixture` renders)

## RG4 — ready to instantiate ✅

README (local Postgres with pgvector, the gateway key, run, test, preview,
deploy, the Worker secret), `IMPLEMENTATION-STATUS.md` with PRs and
departures, epic `completed`.

**Done when**
- the README quick start works from a fresh clone with a `.env.local`, a `.dev.vars` and a local Postgres
- the status file lists every PR and departure

## RG5 — a baseline ✅

The repository becomes an Orun baseline on the Lumen conventions, built the
way cirrus-baseline v22 builds a product — in ONE landing — and copied
closely from saas-starter's SA5:

- `blueprint.yaml` (the card: `requires [github, cloudflare, supabase]`, the
  five brokered secrets as a preview, the programme `01-product`, `02-docs`,
  the two-Supabase-projects prerequisite) and `repo-blueprint.yaml` (every
  module placed by `01-product` and landed as one pull request; `02-docs`
  hook-only);
- the components' edges `mode: enforced` on a push to main, advisory on a
  pull request, so one convergence runs supabase → cloudflare-hyperdrive →
  db-migrate → web per environment;
- the models on Workers AI through an `AI` binding — the platform brokers no
  AI vendor — with the embeddings column resized to the model's 768
  dimensions (migration `020_workers_ai_embeddings`) and the gateway key
  optional, for the chat only;
- row-level security on every table in `public` (migration
  `030_row_level_security`), held by tests/db and the e2e;
- `wrangler.jsonc` committed as the fixture render, so the composition's
  pre-build structure check passes in a fresh checkout; `/api/health` for the
  smoke and the probes;
- `.baseline/`, the rename engine, the bootstrap helpers, the deployment
  record, `ai/context/`, `testing/` (with a Workers AI stand-in for the e2e)
  and the `baseline.yml` / `tag.yml` lanes.

**Done when**
- orun reads the build document at the bootstrap floor (v2.58.11), the lane
  pin (v2.78.4) and 2.79.0, and the card agrees with it
- the product's own `orun plan --trigger github-push-main` shows the order,
  enforced; a pull request's plan holds the same edges advisory
- the e2e tier migrates a local Postgres with pgvector with the product's own
  runner, builds in the job tree orun stages, and — with no AI vendor key —
  adds a document through the chat, retrieves it by similarity and answers
  from it

## RG6 — the cirrus standard ✅

Bring the baseline to cirrus-baseline's standard, with nothing about the
chatbot itself changing.

- **No kiox.** `kiox.yaml`/`kiox.lock` pinned an orun (v2.15.0) that nothing
  ran: every workflow installs orun itself through `orun-action` with its own
  `version:`. The files, their two modules and the rebrand's skip entry go.
- **Component docs.** `tooling/catalog/gen-component-docs.py` writes each
  component's `docs/overview.md`, `docs/architecture.md` and `docs/runbook.md`
  from what the component declares, as cirrus-baseline's do; the pages ship
  with the component. Baseline CI runs it with `--check`.
- **The context pack.** `ai/context/current.md`, `decisions.md` and
  `open-risks.md` beside the two pages a product ships with — this
  repository's own, so no module places them.
- **Status that agrees with the tags.** RG5 is shipped and tagged.
- **The subdomain from the Cloudflare connection (RG-8).** The card declares
  `subdomain` as `from: connection.cloudflare.workersSubdomain`, as
  cirrus-baseline does since baseline-v23, so the console asks for nothing the
  connection already knows; `testing/manifest.test.sh` requires the source's
  provider in `spec.requires.integrations`.

**Done when**
- `git grep -i kiox` finds nothing outside this milestone's own record
  (`specs/`, `tasks/`, `ai/context/`), and the leak gate and the offline
  bootstrap pass without the two modules
- the docs check is green in Baseline CI
- this file, the status file and `epic.yaml` agree

## RG7 — the domain is set later (RG-9) ✅

**Done when** the console card asks for no domain; `productdomain` is an
optional build input, empty by default; a product built without one is branded
with the reserved placeholder `<reponame>.example.com` where the domain goes
(`BASE_DOMAIN` in `intent.yaml`) and its README says how an owner sets the real one;
Baseline CI places, leak-checks and plans a product built with no domain.
Shipped in `baseline-v3`.

## Sequencing note

RG1's component already names the Hyperdrive wiring and depends on
db-migrate; RG2 and RG3 are the halves that make those names true. Applying
either needs a workspace with Supabase and Cloudflare connections; until
then the Orun lane is gated and `Checks` is the merge gate. RG4 is
documentation over all three.
