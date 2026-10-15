import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/ai/embedding.ts chunks a resource on full stops before embedding it
// (`generateChunks`, module-private upstream) and embeds a query after
// flattening newlines. Both are exercised through the exported functions
// with the AI SDK mocked: no gateway, no model.
const embedMany = vi.fn();
const embed = vi.fn();
vi.mock("ai", () => ({
  embedMany: (...args: unknown[]) => embedMany(...args),
  embed: (...args: unknown[]) => embed(...args),
}));
vi.mock("@/lib/db", () => ({
  getDb: vi.fn(async () => {
    throw new Error("the database is not used by these paths");
  }),
}));

describe("generateEmbeddings (lib/ai/embedding.ts)", () => {
  beforeEach(() => {
    embedMany.mockReset();
    embed.mockReset();
  });

  it("splits the resource into sentence chunks and pairs each with its embedding", async () => {
    embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((_, i) => [i, i + 0.5]),
    }));
    const { generateEmbeddings } = await import("@/lib/ai/embedding");
    const result = await generateEmbeddings("  I like pizza. I live in Berlin.  ");
    expect(embedMany).toHaveBeenCalledWith({
      model: "openai/text-embedding-ada-002",
      values: ["I like pizza", " I live in Berlin"],
    });
    expect(result).toEqual([
      { content: "I like pizza", embedding: [0, 0.5] },
      { content: " I live in Berlin", embedding: [1, 1.5] },
    ]);
  });

  it("drops the empty chunks a trailing or doubled full stop produces", async () => {
    embedMany.mockImplementation(async ({ values }: { values: string[] }) => ({
      embeddings: values.map(() => [0]),
    }));
    const { generateEmbeddings } = await import("@/lib/ai/embedding");
    const result = await generateEmbeddings("One..Two.");
    expect(result.map((r) => r.content)).toEqual(["One", "Two"]);
  });

  it("generateEmbedding flattens newlines before embedding the query", async () => {
    embed.mockResolvedValue({ embedding: [0.1, 0.2] });
    const { generateEmbedding } = await import("@/lib/ai/embedding");
    await expect(generateEmbedding("where\ndo I\nlive")).resolves.toEqual([0.1, 0.2]);
    expect(embed).toHaveBeenCalledWith({
      model: "openai/text-embedding-ada-002",
      value: "where do I live",
    });
  });
});
