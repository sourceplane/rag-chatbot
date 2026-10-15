import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/db/index.ts is the port's one forced change: `getDb()` builds a
// `postgres` client per call from the HYPERDRIVE binding's connection string
// when a Cloudflare context exists, and from DATABASE_URL otherwise.
const postgres = vi.fn((connectionString: string, options: unknown) => ({
  connectionString,
  options,
}));
vi.mock("postgres", () => ({ default: (...args: [string, unknown]) => postgres(...args) }));
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (client: unknown) => ({ client }),
}));
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

const hyperdriveOptions = { max: 5, fetch_types: false, prepare: false };

describe("getDb (lib/db/index.ts)", () => {
  const databaseUrl = process.env.DATABASE_URL;
  beforeEach(() => {
    vi.resetModules();
    postgres.mockClear();
    getCloudflareContext.mockReset();
  });
  afterEach(() => {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  });

  it("connects through the HYPERDRIVE binding when a Cloudflare context exists", async () => {
    process.env.DATABASE_URL = "postgres://should-not-be-used";
    getCloudflareContext.mockResolvedValue({
      env: { HYPERDRIVE: { connectionString: "postgres://hyperdrive/db" } },
    });
    const { getDb } = await import("@/lib/db");
    const db = (await getDb()) as unknown as { client: { connectionString: string; options: unknown } };
    expect(getCloudflareContext).toHaveBeenCalledWith({ async: true });
    expect(db.client.connectionString).toBe("postgres://hyperdrive/db");
    expect(db.client.options).toEqual(hyperdriveOptions);
  });

  it("falls back to DATABASE_URL without a Cloudflare context", async () => {
    process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/rag";
    getCloudflareContext.mockRejectedValue(new Error("no cloudflare context"));
    const { getDb } = await import("@/lib/db");
    const db = (await getDb()) as unknown as { client: { connectionString: string } };
    expect(db.client.connectionString).toBe("postgres://postgres:postgres@localhost:5432/rag");
  });

  it("builds a new client on every call", async () => {
    getCloudflareContext.mockResolvedValue({
      env: { HYPERDRIVE: { connectionString: "postgres://hyperdrive/db" } },
    });
    const { getDb } = await import("@/lib/db");
    await getDb();
    await getDb();
    expect(postgres).toHaveBeenCalledTimes(2);
  });

  it("refuses to run with neither a binding nor DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    getCloudflareContext.mockRejectedValue(new Error("no cloudflare context"));
    const { getDb } = await import("@/lib/db");
    await expect(getDb()).rejects.toThrow(/DATABASE_URL is not set/);
  });
});
