import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "@/lib/env.mjs";

// The one departure from upstream in lib/, forced by the Workers runtime.
// Upstream opened one `postgres(env.DATABASE_URL)` client at module scope and
// exported `db`; on Cloudflare the connection string is the HYPERDRIVE
// binding's (Hyperdrive pools the real Postgres connections at the edge), and
// a `postgres` socket opened in one request cannot be used by another
// ("Cannot perform I/O on behalf of a different request"), so every caller
// builds its own:
//
//   const db = await getDb();
//
// Without a Cloudflare context — drizzle-kit, `lib/db/migrate.ts`, tests —
// DATABASE_URL is the connection string, exactly as upstream. `next dev` has
// the context (initOpenNextCloudflareForDev in next.config.mjs) and so uses
// the binding's localConnectionString from wrangler.jsonc.
async function connectionString(): Promise<string> {
  try {
    const { env: bindings } = await getCloudflareContext({ async: true });
    if (bindings.HYPERDRIVE?.connectionString) {
      return bindings.HYPERDRIVE.connectionString;
    }
  } catch {
    // Not running under OpenNext: fall through to DATABASE_URL.
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set and no HYPERDRIVE binding is available");
  }
  return env.DATABASE_URL;
}

export async function getDb() {
  // Hyperdrive pools on its side; a Worker request holds few connections,
  // skips the pg_types round trip and sends plain (unprepared) statements.
  const client = postgres(await connectionString(), {
    max: 5,
    fetch_types: false,
    prepare: false,
  });
  return drizzle(client);
}
