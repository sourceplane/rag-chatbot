import { nanoid } from "@/lib/utils";
import { index, pgTable, text, varchar, vector } from "drizzle-orm/pg-core";
import { resources } from "./resources";

// 768 dimensions: Workers AI's @cf/baai/bge-base-en-v1.5 (lib/ai/models.ts).
// Upstream's 1536 was OpenAI's text-embedding-ada-002 through the gateway;
// migration 020_workers_ai_embeddings resizes the column.
//
// Row-level security is ENABLED with no policy (`.enableRLS()`, migration
// 030_row_level_security), as on every table in `public`: Supabase's Data API
// serves that schema to anyone holding the project's anon key, and with RLS
// and no policy it serves nothing from here. The app connects through
// Hyperdrive as the table's owner, which RLS does not apply to.
export const embeddings = pgTable(
  "embeddings",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    resourceId: varchar("resource_id", { length: 191 }).references(
      () => resources.id,
      { onDelete: "cascade" },
    ),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
  },
  (table) => ({
    embeddingIndex: index("embeddingIndex").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  }),
).enableRLS();
