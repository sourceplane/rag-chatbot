import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { EMBEDDING_DIMENSIONS, chatProvider } from "@/lib/ai/models";

// Not upstream's: the deploy's smoke check and the bootstrap's probe read
// this. A chat page that renders proves the Worker deployed; this proves what
// the page never touches until somebody chats — the HYPERDRIVE binding names
// a real config, Hyperdrive reaches the Supabase database, and db-migrate
// applied the schema: both tables, and the embeddings column at the size of
// the embedding model the app calls (020_workers_ai_embeddings). It does not
// call a model. `chat` says which provider would answer (lib/ai/models.ts).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const [row] = await db.execute<{
      resources: string | null;
      embeddings: string | null;
      dimensions: number | null;
    }>(
      sql`select to_regclass('public.resources')::text as resources,
                 to_regclass('public.embeddings')::text as embeddings,
                 (select a.atttypmod from pg_attribute a
                   where a.attrelid = to_regclass('public.embeddings')
                     and a.attname = 'embedding') as dimensions`,
    );
    const ok = Boolean(
      row?.resources && row?.embeddings && Number(row?.dimensions) === EMBEDDING_DIMENSIONS,
    );
    return Response.json(
      { ok, database: "reachable", schema: ok ? "migrated" : "missing", chat: chatProvider() },
      { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("health: database check failed", error);
    return Response.json(
      { ok: false, database: "unreachable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
