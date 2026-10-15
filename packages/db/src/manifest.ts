import type { MigrationManifest } from "./types.js";

// Every migration the runner applies, in order, with the sha256 of its file.
// `pnpm --filter @saas/db run manifest:check` verifies the checksums;
// `manifest:fix` rewrites them after a migration file changes (only ever
// before that migration has been applied anywhere — an applied migration's
// checksum is immutable).
export const manifest: MigrationManifest = {
  version: 1,
  migrations: [
    {
      id: "000_control_baseline",
      context: "control",
      path: "000_control/up.sql",
      checksum:
        "2a5d7f30684c99e3ff441ca8a2c38038dedd1bab4db4a40e92cd36bb22be297f",
      description:
        "Baseline control migration — creates the migration tracking schema",
    },
    {
      id: "010_rag_initial",
      context: "app",
      path: "010_rag_initial/up.sql",
      checksum:
        "5def7715b235fb55fce39bf0183df3663032f28acaf0e35598824822120cdc01",
      description:
        "The RAG schema, verbatim from upstream lib/db/migrations/0000_yielding_bloodaxe.sql: the vector extension, resources, embeddings (vector(1536)) with its HNSW cosine index",
    },
    {
      id: "020_workers_ai_embeddings",
      context: "app",
      path: "020_workers_ai_embeddings/up.sql",
      checksum:
        "f98dd7e190fe08bcfc9207b04130ec9c5beed0d00220ef3eb2f8ddc76cee2c06",
      description:
        "embeddings.embedding resized to vector(768), Workers AI's @cf/baai/bge-base-en-v1.5 (apps/web/lib/ai/models.ts), its HNSW index rebuilt; refuses while a row holds another model's vector. lib/db/migrations/0001_workers_ai_embeddings.sql is the same SQL for drizzle-kit",
    },
    {
      id: "030_row_level_security",
      context: "app",
      path: "030_row_level_security/up.sql",
      checksum:
        "ade1d0352484260abf82e4e982a107019e5f0e915bf9f32e41d03ff224829713",
      description:
        "Row-level security, with no policies, on every table in public (resources, embeddings) — closed to Supabase's Data API (anon, authenticated), open to the app, which owns them; refuses to run if the app's role would be locked out. lib/db/migrations/0002_row_level_security.sql is the same SQL for drizzle-kit",
    },
  ],
};
