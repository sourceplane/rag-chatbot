import { beforeEach, describe, expect, it, vi } from "vitest";

// The chat route (app/(preview)/api/chat/route.ts) on Workers AI: the real
// route, the real AI SDK and the real workers-ai-provider, the AI binding a
// script, and the two helpers that reach Postgres (createResource,
// findRelevantContent) mocked — the e2e runs them for real. What is checked
// is the route's own wiring: the model it chats with, the tools it hands it,
// the tool results it feeds back, and the answer it streams to useChat.
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));
const createResource = vi.fn();
vi.mock("@/lib/actions/resources", () => ({
  createResource: (...args: unknown[]) => createResource(...args),
}));
const findRelevantContent = vi.fn();
vi.mock("@/lib/ai/embedding", () => ({
  findRelevantContent: (...args: unknown[]) => findRelevantContent(...args),
}));

type Msg = { role: string; content: string; name?: string };
type Inputs = { messages: Msg[]; tools?: Array<{ function: { name: string } }>; response_format?: unknown };
const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

function call(id: string, name: string, args: Record<string, unknown>) {
  return { response: "", tool_calls: [{ id, type: "function", function: { name, arguments: args } }], usage };
}

async function chat(text: string) {
  const { POST } = await import("@/app/(preview)/api/chat/route");
  const body = {
    id: "chat_1",
    trigger: "submit-message",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }],
  };
  const res = await POST(new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body) }));
  const raw = await res.text();
  const chunks = raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
  return { res, raw, chunks, text: chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("") };
}

describe("POST /api/chat on Workers AI", () => {
  beforeEach(() => {
    vi.resetModules();
    getCloudflareContext.mockReset();
    createResource.mockReset();
    findRelevantContent.mockReset();
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it("answers a question from the knowledge base: understandQuery, getInformation, then the answer", async () => {
    const seen: Inputs[] = [];
    const run = vi.fn(async (model: string, inputs: Inputs) => {
      expect(model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
      seen.push(inputs);
      if (inputs.response_format) return { response: { questions: ["capital of Atlantis?"] }, usage };
      const last = inputs.messages.at(-1)!;
      if (last.role === "user") return call("c1", "understandQuery", { query: last.content, toolsToCallInOrder: ["getInformation"] });
      if (last.name === "understandQuery") {
        return call("c2", "getInformation", { question: "What is the capital of Atlantis?", similarQuestions: ["capital of Atlantis?"] });
      }
      const found = JSON.parse(last.content) as { value: Array<{ name: string }> };
      return { response: `${found.value[0]!.name.trim()}.`, usage };
    });
    getCloudflareContext.mockResolvedValue({ env: { AI: { run } } });
    findRelevantContent.mockResolvedValue([{ name: " The capital of Atlantis is Poseidonia", similarity: 0.83 }]);

    const { res, chunks, text } = await chat("What is the capital of Atlantis?");
    expect(res.status).toBe(200);
    expect(text).toBe("The capital of Atlantis is Poseidonia.");
    expect(findRelevantContent).toHaveBeenCalledWith("capital of Atlantis?");
    const tools = chunks.filter((c) => c.type === "tool-input-available").map((c) => c.toolName);
    expect(tools).toEqual(["understandQuery", "getInformation"]);
    // The three upstream tools, offered on every step; JSON mode for the one
    // structured call (understandQuery's generateObject).
    expect(seen[0]!.tools!.map((t) => t.function.name).sort()).toEqual(["addResource", "getInformation", "understandQuery"]);
    expect(seen.filter((i) => i.response_format)).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("adds what the user tells it through addResource", async () => {
    const run = vi.fn(async (_model: string, inputs: Inputs) => {
      const last = inputs.messages.at(-1)!;
      if (last.role === "user") return call("c1", "addResource", { content: "My favourite colour is teal." });
      return { response: "Saved.", usage };
    });
    getCloudflareContext.mockResolvedValue({ env: { AI: { run } } });
    createResource.mockResolvedValue("Resource successfully created and embedded.");
    const { chunks, text } = await chat("My favourite colour is teal.");
    expect(createResource).toHaveBeenCalledWith({ content: "My favourite colour is teal." });
    expect(chunks).toContainEqual(expect.objectContaining({ type: "tool-output-available", output: "Resource successfully created and embedded." }));
    expect(text).toBe("Saved.");
  });

  it("answers 503 with its reason, not a 500, when there is no AI binding and no gateway key", async () => {
    getCloudflareContext.mockResolvedValue({ env: {} });
    const { res, raw } = await chat("hello");
    expect(res.status).toBe(503);
    expect(JSON.parse(raw).error).toMatch(/no AI binding/);
  });
});
