import { beforeEach, describe, expect, it, vi } from "vitest";

// The `createResource` server action (lib/actions/resources.ts) — the
// chat route's `addResource` tool — validates its input with the drizzle-zod
// schema, inserts the resource, embeds it and inserts the embeddings. The
// database (`getDb`) and the AI SDK are mocked: no Postgres, no model.
type Row = Record<string, unknown>;
const inserts: Array<{ table: unknown; values: Row | Row[] }> = [];
function fakeDb() {
  return {
    insert: (table: unknown) => ({
      values: (values: Row | Row[]) => {
        inserts.push({ table, values });
        const done = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<Row[]>;
        };
        done.returning = async () => [{ id: "res_1", ...(values as Row) }];
        return done;
      },
    }),
  };
}
const getDb = vi.fn(async () => fakeDb());
vi.mock("@/lib/db", () => ({ getDb: () => getDb() }));

const embedMany = vi.fn();
vi.mock("ai", () => ({
  embedMany: (...args: unknown[]) => embedMany(...args),
  embed: vi.fn(),
}));
vi.mock("@/lib/ai/models", () => ({
  embeddingModel: async () => ({ modelId: "@cf/baai/bge-base-en-v1.5" }),
}));

describe("createResource (lib/actions/resources.ts)", () => {
  beforeEach(() => {
    inserts.length = 0;
    getDb.mockClear();
    embedMany.mockReset();
    embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((_, i) => [i]),
    }));
  });

  it("inserts the resource, then one embedding row per chunk, and reports success", async () => {
    const { createResource } = await import("@/lib/actions/resources");
    const reply = await createResource({ content: "I like pizza. I live in Berlin" });
    expect(reply).toBe("Resource successfully created and embedded.");
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values).toEqual({ content: "I like pizza. I live in Berlin" });
    expect(inserts[1]?.values).toEqual([
      { resourceId: "res_1", content: "I like pizza", embedding: [0] },
      { resourceId: "res_1", content: " I live in Berlin", embedding: [1] },
    ]);
  });

  it("rejects input the schema does not accept before touching the database", async () => {
    const { createResource } = await import("@/lib/actions/resources");
    const reply = await createResource({ content: 42 as unknown as string });
    expect(reply).not.toBe("Resource successfully created and embedded.");
    expect(reply).toMatch(/expected string/i);
    expect(getDb).not.toHaveBeenCalled();
    expect(embedMany).not.toHaveBeenCalled();
  });

  it("returns the error's message when the database insert fails", async () => {
    getDb.mockResolvedValueOnce({
      insert: () => ({
        values: () => ({
          returning: async () => {
            throw new Error("connection attempt failed");
          },
        }),
      }),
    } as unknown as ReturnType<typeof fakeDb>);
    const { createResource } = await import("@/lib/actions/resources");
    await expect(createResource({ content: "x" })).resolves.toBe("connection attempt failed");
  });
});
