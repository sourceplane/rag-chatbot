-- The same SQL as packages/db/src/migrations/020_workers_ai_embeddings/up.sql
-- (which says why), for drizzle-kit (`pnpm db:migrate`) against a local
-- database. Written by hand: upstream's 0000 snapshot never recorded the
-- embeddings table, so drizzle-kit's own output for the resize was a CREATE
-- TABLE. meta/0001_snapshot.json is drizzle-kit's, and records the column at
-- 768 for every later diff.
DO $$
DECLARE
  foreign_vectors bigint;
BEGIN
  SELECT count(*) INTO foreign_vectors FROM "embeddings" WHERE vector_dims("embedding") <> 768;
  IF foreign_vectors > 0 THEN
    RAISE EXCEPTION 'embeddings holds % vector(s) from another embedding model: delete them (DELETE FROM embeddings WHERE vector_dims(embedding) <> 768) and add their resources again, so Workers AI embeds them', foreign_vectors;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(768);
