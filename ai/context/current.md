# rag-chatbot — where this repository stands

The entry page for anyone (or any agent) picking this repository up. It is
this repository's own state and does not ship to a product built from it; the
two pages that do are [operations.md](operations.md) and
[deployment.md](deployment.md).

## What it is

Vercel's AI SDK RAG chatbot (`ai-sdk-preview-rag`) on Cloudflare Workers +
Static Assets through `@opennextjs/cloudflare`, its memory a pgvector table in
a Supabase project's Postgres reached through Hyperdrive, packaged as an Orun
baseline: `orun new --blueprint repo-blueprint.yaml` builds a new product in
its own repository and takes it to live on stage and prod in one landing
(`01-product`) — the Supabase project, then the Hyperdrive config, then the
migrations, then the Worker — and records what went live (`02-docs`). A fresh
product chats and embeds on Workers AI through its `AI` binding, with no AI
vendor key.

## Release

| | |
|---|---|
| Latest tag | `baseline-v1` (RG5, [#6](https://github.com/sourceplane/rag-chatbot/pull/6)) |
| On `main` since | RG6 — the cirrus standard (no kiox, generated component docs, this context pack) |
| Proven live | No. Everything short of the platform is proven offline in Baseline CI, with stand-ins for Workers AI and Supabase's Management API. The real models, a deploy with the brokered token and its `AI` binding, the Terraform and db-migrate applies and a live bootstrap are still to come (risks RG-J, RG-K) |

## Where to read

| Question | Page |
|---|---|
| What shipped, and every departure from upstream | `specs/epics/rag-chatbot/IMPLEMENTATION-STATUS.md` |
| Why it is built this way | [decisions.md](decisions.md), then `specs/epics/rag-chatbot/design.md` |
| What could still go wrong | [open-risks.md](open-risks.md), then `specs/epics/rag-chatbot/risks-and-open-questions.md` |
| How to instantiate it | `BOOTSTRAP.md`, `docs/phases/` |
| What each component is | `docs/` beside each `component.yaml` — `apps/web`, `packages/db`, `infra/db-migrate`, `infra/terraform/{supabase,cloudflare-hyperdrive}`, `tests/{web,db}` (generated; `python3 tooling/catalog/gen-component-docs.py`) |

## Next

1. Bootstrap one product from the next tag against a workspace with
   Cloudflare and Supabase connected (two free project slots, RG-O): the first
   run of the real models and of the `AI` binding under the brokered deploy
   token, and the first Terraform and db-migrate applies (closes RG-J, RG-K).
2. Cut the next `baseline-vN` with `tag.yml` so the registry can pin RG6.
