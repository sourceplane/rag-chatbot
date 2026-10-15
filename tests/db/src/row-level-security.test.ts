import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";

// Supabase's Data API (PostgREST) serves the `public` schema to anyone holding
// the project's anon key. Migration 030 enables row-level security, with no
// policy, on every table there: `anon` and `authenticated` get nothing, and the
// app — which owns the tables — keeps everything. These run every migration
// db-migrate applies, in the manifest's order, on a real Postgres in process
// (PGlite: Postgres compiled to WASM, with pgvector), and read the catalog it
// leaves.
const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
const sqlOf = (rel: string) => readFileSync(path.join(migrationsDir, rel), "utf8");
const fresh = () => new PGlite({ extensions: { vector } });

async function migrated(): Promise<PGlite> {
  const db = fresh();
  for (const entry of manifest.migrations) {
    await db.exec(sqlOf(entry.path));
  }
  return db;
}

type Rel = { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean };
const PUBLIC_TABLES = `
  select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
   order by c.relname`;

describe("row-level security on public (after every migration)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migrated();
  }, 60_000);

  it("leaves no table in public without row-level security", async () => {
    const { rows } = await db.query<Rel>(PUBLIC_TABLES);
    // Not vacuous: the template's tables are all there.
    expect(rows.map((r) => r.relname)).toEqual(expect.arrayContaining(["embeddings", "resources"]));
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("adds no policy and forces none — the owner is never subject to it", async () => {
    const { rows } = await db.query<Rel>(PUBLIC_TABLES);
    expect(rows.filter((r) => r.relforcerowsecurity).map((r) => r.relname)).toEqual([]);
    const policies = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_policies where schemaname = 'public'",
    );
    expect(policies.rows[0]!.n).toBe(0);
  });

  it("gives a role with the Data API's grants nothing, and the owner everything", async () => {
    await db.exec("insert into resources (id, content) values ('r1', 'owner row')");
    await db.exec(
      `insert into embeddings (id, resource_id, content, embedding)
       values ('e1', 'r1', 'owner row', array_fill(0.1, array[768])::vector)`,
    );
    // What Supabase grants `anon` on public by default — so a refusal below is
    // row-level security's, not a missing grant's.
    await db.exec(`
      create role anon nologin;
      grant usage on schema public to anon;
      grant select, insert, update, delete on all tables in schema public to anon;
      grant usage on all sequences in schema public to anon;`);
    await db.exec("set role anon");
    try {
      for (const table of ["resources", "embeddings"]) {
        const seen = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
        expect(seen.rows[0]!.n, table).toBe(0);
      }
      await expect(
        db.exec("insert into resources (id, content) values ('anon', 'x')"),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.exec("reset role");
    }
    const owner = await db.query<{ n: number }>("select count(*)::int as n from embeddings");
    expect(owner.rows[0]!.n).toBe(1);
  });
});

describe("the embeddings column (pgvector)", () => {
  it("is vector(768) — Workers AI's bge-base-en-v1.5 — with upstream's HNSW cosine index", async () => {
    const db = await migrated();
    const col = await db.query<{ type: string }>(
      `select format_type(atttypid, atttypmod) as type from pg_attribute
        where attrelid = 'public.embeddings'::regclass and attname = 'embedding'`,
    );
    expect(col.rows[0]!.type).toBe("vector(768)");
    const idx = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'embeddings' and indexname = 'embeddingIndex'`,
    );
    expect(idx.rows[0]!.indexdef).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    await expect(
      db.exec(`insert into embeddings (id, content, embedding) values ('x', 'x', array_fill(0.1, array[1536])::vector)`),
    ).rejects.toThrow(/expected 768 dimensions/);
  }, 60_000);

  it("ranks by cosine similarity the way lib/ai/embedding.ts asks (1 - <=>, above 0.3)", async () => {
    const db = await migrated();
    const unit = (i: number) => `array_cat(array_cat(array_fill(0, array[${i}]), array[1]), array_fill(0, array[${767 - i}]))::real[]::vector`;
    await db.exec(`insert into resources (id, content) values ('r', 'doc')`);
    await db.exec(`
      insert into embeddings (id, resource_id, content, embedding) values
        ('a', 'r', 'near', ${unit(0)}),
        ('b', 'r', 'far', ${unit(1)})`);
    const { rows } = await db.query<{ content: string; similarity: number }>(
      `select content, 1 - (embedding <=> ${unit(0)}) as similarity from embeddings
        where 1 - (embedding <=> ${unit(0)}) > 0.3 order by similarity desc limit 4`,
    );
    expect(rows).toEqual([{ content: "near", similarity: 1 }]);
  }, 60_000);

  it("migration 020 refuses while a row holds another model's vector, changing nothing", async () => {
    const db = fresh();
    for (const entry of manifest.migrations.filter((m) => m.id < "020")) {
      await db.exec(sqlOf(entry.path));
    }
    await db.exec(
      `insert into embeddings (id, content, embedding) values ('ada', 'x', array_fill(0.1, array[1536])::vector)`,
    );
    await expect(db.exec(sqlOf("020_workers_ai_embeddings/up.sql"))).rejects.toThrow(
      /1 vector\(s\) from another embedding model/,
    );
    const col = await db.query<{ type: string }>(
      `select format_type(atttypid, atttypmod) as type from pg_attribute
        where attrelid = 'public.embeddings'::regclass and attname = 'embedding'`,
    );
    expect(col.rows[0]!.type).toBe("vector(1536)");
  }, 60_000);
});

describe("migration 030's guard", () => {
  // The guard names `postgres`, the role Hyperdrive connects as, which PGlite
  // cannot take SUPERUSER from. Pointed instead at a role that neither owns the
  // tables nor bypasses RLS, it must refuse — and enable nothing.
  const migration = sqlOf("030_row_level_security/up.sql");
  const aimedAt = (role: string) =>
    migration.replaceAll("rolname = 'postgres'", `rolname = '${role}'`).replaceAll("<> 'postgres'", `<> '${role}'`);

  async function beforeRls(): Promise<PGlite> {
    const db = fresh();
    for (const entry of manifest.migrations.filter((m) => m.id < "030")) {
      await db.exec(sqlOf(entry.path));
    }
    return db;
  }

  it("refuses when the app's role would be locked out, enabling nothing", async () => {
    const db = await beforeRls();
    await db.exec("create role app_without_bypass nologin");
    await expect(db.exec(aimedAt("app_without_bypass"))).rejects.toThrow(/would lock the app out/);
    const { rows } = await db.query<Rel>(PUBLIC_TABLES);
    expect(rows.filter((r) => r.relrowsecurity)).toEqual([]);
  }, 60_000);

  it("passes for a role with BYPASSRLS", async () => {
    const db = await beforeRls();
    await db.exec("create role app_with_bypass nologin bypassrls");
    await db.exec(aimedAt("app_with_bypass"));
    const { rows } = await db.query<Rel>(PUBLIC_TABLES);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  }, 60_000);
});
