import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  simulateStreamingMiddleware,
  wrapLanguageModel,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { createWorkersAI, type WorkersAI } from "workers-ai-provider";

// Not upstream's. Upstream named its models as Vercel AI Gateway strings
// ("openai/gpt-4o", "openai/text-embedding-ada-002") and needed a gateway key
// before it could answer anything. Here the models are Workers AI's, through
// the Worker's `AI` binding (wrangler.jsonc): the Cloudflare account the app
// deploys into is the whole AI vendor, so a fresh deploy chats and embeds
// with no key of anyone else's.
//
//   chat        Llama 4 Scout — Meta's function-calling model on Workers AI
//               (the route's three tools), with JSON mode (understandQuery's
//               generateObject).
//   embeddings  BGE base en v1.5, 768 dimensions — the size of the
//               `embeddings.embedding` column (migration
//               020_workers_ai_embeddings). Changing the model is a migration
//               AND a re-embedding of every resource: vectors from two models
//               do not share a space, even at the same size.
//
// AI_GATEWAY_API_KEY is optional. Set (a Worker secret), the CHAT model is
// upstream's own, "openai/gpt-4o" through Vercel's AI Gateway, exactly as
// upstream called it. Embeddings stay on Workers AI either way: the column is
// sized to its model, and a query embedded by one model cannot be compared
// with resources embedded by another.
//
// Both ids are checked against Workers AI's catalog as @cloudflare/workers-types
// lists it (`keyof AiModels`). workers-ai-provider 2.0.2 (the release for AI
// SDK v5) narrows its own id types by an older shape that most current models,
// these two included, no longer match — hence the casts where they are passed.
export const WORKERS_AI_CHAT_MODEL =
  "@cf/meta/llama-4-scout-17b-16e-instruct" satisfies keyof AiModels;
export const WORKERS_AI_EMBEDDING_MODEL =
  "@cf/baai/bge-base-en-v1.5" satisfies keyof AiModels;
export const EMBEDDING_DIMENSIONS = 768;
export const GATEWAY_CHAT_MODEL = "openai/gpt-4o";

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "Workers AI is not available: the Worker has no AI binding (wrangler.jsonc) and AI_GATEWAY_API_KEY is not set",
    );
    this.name = "AiNotConfiguredError";
  }
}

async function aiBinding(): Promise<Ai> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env.AI) return env.AI;
  } catch {
    // Not running under OpenNext (a script, a test): no binding.
  }
  throw new AiNotConfiguredError();
}

/** Which provider answers the chat — reported by /api/health. */
export function chatProvider(): "ai-gateway" | "workers-ai" {
  return process.env.AI_GATEWAY_API_KEY ? "ai-gateway" : "workers-ai";
}

export async function chatModel(): Promise<LanguageModel> {
  if (chatProvider() === "ai-gateway") return GATEWAY_CHAT_MODEL;
  const workersai = createWorkersAI({ binding: await aiBinding() });
  // Every step is one non-streaming `AI.run`, replayed to the client as a
  // stream. workers-ai-provider parses a tool call from a whole response in
  // both shapes Workers AI answers with, but from a STREAMED one only in its
  // older shape; the route chains tools (understandQuery → getInformation →
  // the answer), so a step that streamed a tool call the provider could not
  // read would end the chain with no answer. The answers are a sentence long
  // (the system prompt), so arriving whole costs the reader nothing.
  return wrapLanguageModel({
    model: workersai(WORKERS_AI_CHAT_MODEL as Parameters<WorkersAI["chat"]>[0]),
    middleware: simulateStreamingMiddleware(),
  });
}

export async function embeddingModel(): Promise<EmbeddingModel<string>> {
  const workersai = createWorkersAI({ binding: await aiBinding() });
  return workersai.textEmbedding(
    WORKERS_AI_EMBEDDING_MODEL as Parameters<WorkersAI["textEmbedding"]>[0],
  );
}
