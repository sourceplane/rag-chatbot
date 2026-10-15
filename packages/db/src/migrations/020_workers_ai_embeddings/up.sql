-- The embeddings column, sized for Workers AI's embedding model.
--
-- Upstream embedded through Vercel's AI Gateway with OpenAI's
-- text-embedding-ada-002, 1536 dimensions, and 010 created the column at that
-- size. The app embeds with Workers AI's @cf/baai/bge-base-en-v1.5 through the
-- Worker's AI binding (apps/web/lib/ai/models.ts), 768 dimensions, so the
-- column is resized here; the HNSW cosine index on it is rebuilt by the ALTER.
-- On a new environment the table is empty and this is instant.
--
-- FIRST, the guard. A vector from another model cannot be resized, and would
-- be meaningless beside Workers AI's if it could: two models do not share a
-- space. If any row holds one, stop and say what to do, changing nothing —
-- the guard runs before the ALTER. Idempotent: on a column already 768 wide
-- the guard finds nothing and the ALTER changes nothing.
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

ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(768);
