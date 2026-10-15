# apps/web — the app

A retrieval-augmented chatbot from Vercel's
[AI SDK RAG template](https://github.com/vercel-labs/ai-sdk-preview-rag)
(MIT, see `LICENSE`), running on Cloudflare Workers + Static Assets:

- One chat page (`/`, `app/(preview)/page.tsx`): `useChat` and a streamed
  answer
- The chat route (`/api/chat`): `streamText` with three tools —
  `addResource` (chunk a resource on full stops, embed each chunk, store the
  vectors), `getInformation` (embed the question, retrieve the closest chunks
  by cosine similarity), `understandQuery` (rephrase the question with
  `generateObject`) — as upstream wrote them
- The knowledge base: `resources` and `embeddings` in Postgres with pgvector,
  through Drizzle — the column `vector(768)` under an HNSW cosine index
- `/api/health`, which answers 200 only when the database is reachable through
  Hyperdrive and migrated; it calls no model

The models are Workers AI's through the Worker's `AI` binding
(`lib/ai/models.ts`): `@cf/meta/llama-4-scout-17b-16e-instruct` for the chat,
`@cf/baai/bge-base-en-v1.5` for the embeddings. An `AI_GATEWAY_API_KEY`
Worker secret switches the chat — never the embeddings — to upstream's
`openai/gpt-4o` through Vercel's AI Gateway. The product's name is
`lib/site.ts`. The database client is built per call over the `HYPERDRIVE`
binding (`lib/db/index.ts`). The AI SDK guide that builds this template
step by step: <https://ai-sdk.dev/docs/guides/rag-chatbot>.

```bash
pnpm dev          # next dev on http://localhost:3000 (Workers AI needs `wrangler login`)
pnpm build        # next build + opennextjs-cloudflare build → .open-next/
pnpm preview      # wrangler dev over the built Worker
pnpm db:migrate   # drizzle-kit, against DATABASE_URL (a Postgres with pgvector)
```

How it runs locally, how it deploys — per environment, after the Supabase
project, the Hyperdrive config and the migrations, on merge to `main` — and
how to use a vendor model instead are the repository's README and
`component.yaml` beside this file.
