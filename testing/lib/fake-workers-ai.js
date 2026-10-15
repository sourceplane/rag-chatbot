// A stand-in for Workers AI, for `wrangler dev` with no Cloudflare account.
//
// Workers AI has no local mode: the AI binding always calls the account, and
// the e2e has none. So the e2e binds `AI` to THIS Worker instead — a service
// binding to its default entrypoint, whose `run(model, inputs, options)` is
// reached over RPC exactly as the real binding's is — and the app's own code
// (lib/ai/models.ts, the real workers-ai-provider, the real AI SDK) cannot
// tell the difference in shape. What it answers is deterministic, not
// intelligent, and that is the point: the e2e asserts the app's path end to
// end, so every answer must be predictable.
//
//   @cf/baai/bge-base-en-v1.5      { shape: [n, 768], data, pooling } — a
//       bag-of-words embedding: each lowercase word hashed (FNV-1a) into one
//       of 768 dimensions, the vector L2-normalised. Two texts' cosine
//       similarity is their shared words over the geometric mean of their
//       lengths, so "What is the capital of Atlantis?" is close to "The
//       capital of Atlantis is Poseidonia" and far from "My favourite colour
//       is teal" — retrieval by similarity is real, the space is not a
//       model's.
//   @cf/meta/llama-4-scout-17b-16e-instruct
//       { response, tool_calls?, usage } — Llama 4 Scout's catalog shape. A
//       script, by the last message:
//         user "Remember: <text>"   → calls addResource { content: <text> }
//         user "<question>?"        → calls understandQuery { query }
//         tool understandQuery      → calls getInformation { question,
//                                     similarQuestions: what it returned }
//         tool getInformation       → answers with the closest chunk, or
//                                     "Sorry, I don't know." when none came back
//         tool addResource          → answers with the tool's own reply
//       and, in JSON mode (generateObject), { questions: [<the query>] }.
//       It never streams: the app asks for whole responses
//       (simulateStreamingMiddleware), and a request to stream is refused
//       here so that a change to that is caught.
//
// Every call is logged as one `fake-workers-ai {…}` line, which the e2e reads
// back from wrangler's output.
import { WorkerEntrypoint } from "cloudflare:workers";

const CHAT = "@cf/meta/llama-4-scout-17b-16e-instruct";
const EMBEDDING = "@cf/baai/bge-base-en-v1.5";
const DIMENSIONS = 768;

function fnv1a(word) {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function embed(text) {
  const v = new Array(DIMENSIONS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    v[fnv1a(word) % DIMENSIONS] += 1;
  }
  const norm = Math.hypot(...v);
  if (norm === 0) {
    v[0] = 1; // no words: a fixed unit vector, never the zero vector cosine cannot measure
    return v;
  }
  return v.map((x) => x / norm);
}

const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
const say = (response) => ({ response, usage });
const call = (n, name, args) => ({
  response: "",
  tool_calls: [{ id: `call_${n}`, type: "function", function: { name, arguments: args } }],
  usage,
});

function chat(inputs) {
  const messages = inputs.messages ?? [];
  if (inputs.response_format) {
    // understandQuery's generateObject: `Analyze this query: "<query>". …`
    const prompt = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    const query = /Analyze this query: "([^"]*)"/.exec(prompt)?.[1] ?? prompt;
    return say({ questions: [query] });
  }
  const offered = (inputs.tools ?? []).map((t) => t.function?.name);
  const last = messages.at(-1) ?? { role: "user", content: "" };
  const n = messages.length;

  if (last.role === "user") {
    const text = String(last.content).trim();
    const remember = /^remember\b[:,]?\s*/i.exec(text);
    if (remember && offered.includes("addResource")) {
      return call(n, "addResource", { content: text.slice(remember[0].length) });
    }
    if (text.endsWith("?") && offered.includes("understandQuery")) {
      return call(n, "understandQuery", { query: text, toolsToCallInOrder: ["getInformation"] });
    }
    return say('Tell me something to remember ("Remember: …"), or ask me a question.');
  }

  if (last.role === "tool") {
    const output = JSON.parse(last.content);
    if (String(output.type).startsWith("error")) {
      return say(`The ${last.name} tool failed: ${JSON.stringify(output.value)}`);
    }
    if (last.name === "understandQuery") {
      const question = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
      return call(n, "getInformation", { question, similarQuestions: output.value });
    }
    if (last.name === "getInformation") {
      const found = output.value ?? [];
      return say(found.length ? `${String(found[0].name).trim()}.` : "Sorry, I don't know.");
    }
    return say(String(output.value));
  }
  return say("");
}

export default class FakeWorkersAi extends WorkerEntrypoint {
  async run(model, inputs, _options) {
    if (inputs?.stream) {
      console.log(`fake-workers-ai ${JSON.stringify({ model, refused: "stream" })}`);
      throw new Error("fake Workers AI answers whole responses only, and the app asked it to stream");
    }
    if (model === EMBEDDING) {
      const texts = Array.isArray(inputs.text) ? inputs.text : [inputs.text];
      console.log(`fake-workers-ai ${JSON.stringify({ model, texts })}`);
      return { shape: [texts.length, DIMENSIONS], data: texts.map(embed), pooling: "mean" };
    }
    if (model === CHAT) {
      const answer = chat(inputs);
      console.log(
        `fake-workers-ai ${JSON.stringify({
          model,
          json: Boolean(inputs.response_format),
          tools: (inputs.tools ?? []).map((t) => t.function?.name),
          last: inputs.messages?.at(-1)?.role,
          called: answer.tool_calls?.[0]?.function.name ?? null,
        })}`,
      );
      return answer;
    }
    console.log(`fake-workers-ai ${JSON.stringify({ model, refused: "unknown model" })}`);
    throw new Error(`fake Workers AI does not serve ${model}`);
  }

  async fetch() {
    return new Response("a stand-in for Workers AI; bind it as AI and call run()", { status: 404 });
  }
}
