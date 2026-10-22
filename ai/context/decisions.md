# rag-chatbot — decisions

The choices that shape this repository, one line each, with where the full
reasoning lives. Superseded decisions stay listed, marked, so the history
reads in order.

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | OpenNext on Workers + Static Assets, the static-assets incremental cache | The template is a Next.js App Router app; the pre-rendered shell needs nothing provisioned | `specs/epics/rag-chatbot/design.md` §2 |
| 2 | `getDb()` builds a `postgres` client per call over the `HYPERDRIVE` binding; no module-level pool | Workers refuse a socket opened in another request; Hyperdrive holds the pool | risk RG-A, design.md §3, §7 |
| 3 | pgvector stays; not Vectorize | The template's retrieval is pgvector SQL; Vectorize would rewrite the schema, both queries and the insert path | design.md §7 |
| 4 | The database comes from Terraform (a Supabase project and a Hyperdrive config per environment) and the schema from db-migrate (`@saas/db`) before the Worker deploys, not from drizzle's migrator inside `next build` | Lumen's roots and runner; the build stays credential-free | design.md §2, §4 |
| 5 | Workers AI through an `AI` binding is the default for both models (Llama 4 Scout chat, bge-base-en-v1.5 at 768 dimensions), each step one whole `AI.run`; `AI_GATEWAY_API_KEY` is optional and switches only the chat. Supersedes RG1–RG4's gateway-only models | The platform brokers no AI vendor; a key that switched the embeddings would orphan every stored vector | risks RG-H, RG-I, design.md §7 |
| 6 | The embeddings column is resized to 768 by a new migration; `010_rag_initial` stays upstream's byte for byte | Migrations are immutable once applied | IMPLEMENTATION-STATUS (RG5) |
| 7 | `apps/web/wrangler.jsonc` is committed as the fixture render; the stage and prod lanes re-render it from the Hyperdrive wiring document | The composition checks the file exists before the build | design.md §4 |
| 8 | Row-level security with no policy on every table in `public` | Supabase's Data API serves `public` to the anon key; the app, as owner, is not subject to it | risk RG-M |
| 9 | One landing (`01-product`) then the record (`02-docs`); one convergence runs supabase → cloudflare-hyperdrive → db-migrate → web, enforced on `main`, advisory on a pull request | A job resolves its secrets when it starts, so each apply must finish before its reader | design.md §4, `repo-blueprint.yaml` |
| 10 | `ci.yml` plans nothing while `intent.yaml` names `ws_CHANGE_ME` | A bootstrap cannot set a repository variable (replaced the `ORUN_CI` gate) | IMPLEMENTATION-STATUS (RG5), `.github/workflows/ci.yml` |
| 11 | stack-tectonic 0.19.0, not 0.20.0 | 0.20.0's lane-scoped install links `node_modules` out of the job tree, which Next 16's Turbopack refuses | `intent.yaml`, `BOOTSTRAP.md` (Troubleshooting) |
| 12 | orun is pinned only where it runs (the `orun-action` `version:` in each workflow); no kiox. Component docs are generated from the manifests and checked in CI | `kiox.yaml` pinned a version nothing ran; a hand-written copy of the dependency graph and bindings drifts silently | IMPLEMENTATION-STATUS (RG6), `tooling/catalog/gen-component-docs.py` |
| 13 | `subdomain` is read from the Cloudflare connection (`from: connection.cloudflare.workersSubdomain`), never asked | It belongs to the account like its id and has one right answer; a typed one could only be wrong, and showed up after deploy in the Open Graph origin, the smoke and the probes | `blueprint.yaml`, IMPLEMENTATION-STATUS (RG-8) |
| 14 | The console asks for no domain; an empty `productdomain` brands the placeholder `<reponame>.example.com` | The product goes live on workers.dev and nothing in the build needs a domain; attaching one is an owner's step, and the placeholder keeps every place the domain goes in the repository, ready to replace | `repo-blueprint.yaml`, `tooling/rebrand/rebrand.mjs`, IMPLEMENTATION-STATUS (RG-9) |
