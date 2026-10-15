import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embedMany, generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

// lib/ai/models.ts: Workers AI through the Worker's AI binding is the default
// chat model and the only embedding model; AI_GATEWAY_API_KEY, when set,
// switches the CHAT to upstream's gateway model. These run the real AI SDK and
// the real workers-ai-provider against a stand-in binding — an object with
// Workers AI's `run(model, inputs, options)` answering in the shapes the
// catalog types for these two models — so what is checked is what the
// provider sends the binding and what it makes of the answer.
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

type Run = (model: string, inputs: Record<string, unknown>, options?: unknown) => Promise<unknown>;
function binding(run: Run) {
  return { run: vi.fn(run) };
}
const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };

describe("lib/ai/models.ts", () => {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  beforeEach(() => {
    vi.resetModules();
    getCloudflareContext.mockReset();
    delete process.env.AI_GATEWAY_API_KEY;
  });
  afterEach(() => {
    if (gatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = gatewayKey;
  });

  it("sizes the embeddings for the Workers AI model it names", async () => {
    const models = await import("@/lib/ai/models");
    expect(models.WORKERS_AI_EMBEDDING_MODEL).toBe("@cf/baai/bge-base-en-v1.5");
    expect(models.EMBEDDING_DIMENSIONS).toBe(768);
    expect(models.WORKERS_AI_CHAT_MODEL).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(models.chatProvider()).toBe("workers-ai");
  });

  it("embeds through the AI binding: one run per batch, the vectors as Workers AI returns them", async () => {
    const vectors = [Array(768).fill(0.1), Array(768).fill(0.2)];
    const ai = binding(async () => ({ shape: [2, 768], data: vectors, pooling: "mean" }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { embeddingModel } = await import("@/lib/ai/models");
    const { embeddings } = await embedMany({ model: await embeddingModel(), values: ["a", "b"] });
    expect(embeddings).toEqual(vectors);
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0]![0]).toBe("@cf/baai/bge-base-en-v1.5");
    expect(ai.run.mock.calls[0]![1]).toEqual({ text: ["a", "b"] });
  });

  it("chats through the AI binding with the chat model, and never asks it to stream", async () => {
    const ai = binding(async () => ({ response: "Hello.", usage }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { chatModel } = await import("@/lib/ai/models");
    const result = streamText({ model: await chatModel(), prompt: "Hi" });
    expect(await result.text).toBe("Hello.");
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [model, inputs] = ai.run.mock.calls[0]!;
    expect(model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(inputs.stream).toBeUndefined();
    expect(inputs.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("reads Llama 4 Scout's tool calls and runs the next step with the tool's result", async () => {
    let step = 0;
    const ai = binding(async (_model, inputs) => {
      step += 1;
      if (step === 1) {
        expect((inputs.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)).toEqual([
          "lookup",
        ]);
        return {
          response: "",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: { q: "capital" } } }],
          usage,
        };
      }
      const messages = inputs.messages as Array<{ role: string; content: string }>;
      expect(messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("Poseidonia") });
      return { response: "Poseidonia.", usage };
    });
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { chatModel } = await import("@/lib/ai/models");
    const lookup = vi.fn(async ({ q }: { q: string }) => `the ${q} is Poseidonia`);
    const result = streamText({
      model: await chatModel(),
      prompt: "What is the capital?",
      stopWhen: stepCountIs(5),
      tools: { lookup: tool({ description: "look up", inputSchema: z.object({ q: z.string() }), execute: lookup }) },
    });
    expect(await result.text).toBe("Poseidonia.");
    expect(lookup).toHaveBeenCalledWith({ q: "capital" }, expect.anything());
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("asks the binding for JSON mode for a structured answer", async () => {
    const ai = binding(async () => ({ response: { questions: ["a?", "b?"] }, usage }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { chatModel } = await import("@/lib/ai/models");
    const { generateObject } = await import("ai");
    const { object } = await generateObject({
      model: await chatModel(),
      schema: z.object({ questions: z.array(z.string()) }),
      prompt: "q",
    });
    expect(object).toEqual({ questions: ["a?", "b?"] });
    const inputs = ai.run.mock.calls[0]![1] as { response_format?: { type: string } };
    expect(inputs.response_format?.type).toBe("json_schema");
  });

  it("uses upstream's gateway model for the chat when AI_GATEWAY_API_KEY is set, without the binding", async () => {
    process.env.AI_GATEWAY_API_KEY = "vck_test";
    const models = await import("@/lib/ai/models");
    expect(models.chatProvider()).toBe("ai-gateway");
    await expect(models.chatModel()).resolves.toBe("openai/gpt-4o");
    expect(getCloudflareContext).not.toHaveBeenCalled();
  });

  it("keeps the embeddings on Workers AI when AI_GATEWAY_API_KEY is set", async () => {
    process.env.AI_GATEWAY_API_KEY = "vck_test";
    const ai = binding(async () => ({ shape: [1, 768], data: [Array(768).fill(0)] }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { embeddingModel } = await import("@/lib/ai/models");
    const model = await embeddingModel();
    expect(typeof model).not.toBe("string");
    await embedMany({ model, values: ["x"] });
    expect(ai.run.mock.calls[0]![0]).toBe("@cf/baai/bge-base-en-v1.5");
  });

  it("says plainly when there is neither a binding nor a key", async () => {
    getCloudflareContext.mockRejectedValue(new Error("no cloudflare context"));
    const { chatModel, embeddingModel, AiNotConfiguredError } = await import("@/lib/ai/models");
    await expect(chatModel()).rejects.toBeInstanceOf(AiNotConfiguredError);
    await expect(embeddingModel()).rejects.toThrow(/no AI binding/);
    getCloudflareContext.mockResolvedValue({ env: {} });
    await expect(chatModel()).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("generateText works on the same model (a step without tools)", async () => {
    const ai = binding(async () => ({ response: "ok", usage }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { chatModel } = await import("@/lib/ai/models");
    const { text } = await generateText({ model: await chatModel(), prompt: "x" });
    expect(text).toBe("ok");
  });
});
