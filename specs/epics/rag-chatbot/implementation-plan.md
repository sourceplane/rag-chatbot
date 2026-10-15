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

## Sequencing note

RG1's component already names the Hyperdrive wiring and depends on
db-migrate; RG2 and RG3 are the halves that make those names true. Applying
either needs a workspace with Supabase and Cloudflare connections; until
then the Orun lane is gated and `Checks` is the merge gate. RG4 is
documentation over all three.
