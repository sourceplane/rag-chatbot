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
- The AI Gateway is used exactly as upstream (model strings, one key); the
  key is a Worker secret instead of a project env var.

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
