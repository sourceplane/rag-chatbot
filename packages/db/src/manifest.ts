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
  ],
};
