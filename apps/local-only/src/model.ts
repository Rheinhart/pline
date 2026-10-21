import * as http from "node:http";
import * as https from "node:https";
import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "./engine-shared";
import { modelEndpoint, validateSettings, type ModelSettings } from "./policy";

export function wireMessages(messages: readonly AgentMessage[]): Record<string, unknown>[] {
  return messages.flatMap<Record<string, unknown>>((message) => {
    if (message.role === "tool") {
      return message.content.filter((p) => p.type === "tool-result").map((p) => ({
        role: "tool", tool_call_id: p.toolCallId, content: JSON.stringify(p.output),
      }));
    }
    const text = message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
    const calls = message.content.filter((p) => p.type === "tool-call").map((p) => ({
      id: p.toolCallId, type: "function", function: { name: p.toolName, arguments: JSON.stringify(p.input) },
    }));
    return [{ role: message.role, content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }];
  });
}

async function* responseChunks(endpoint: URL, body: string, apiKey: string | undefined, signal?: AbortSignal): AsyncGenerator<string> {
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error("Context exceeds the 2 MiB request limit. Start a new task.");
  signal?.throwIfAborted();
  const secure = endpoint.protocol === "https:";
  // Dedicated native agents ignore HTTP(S)_PROXY, ALL_PROXY, PAC and global agents.
  // Literal IPs avoid DNS; native request does not follow redirects.
  const agent = secure ? new https.Agent({ rejectUnauthorized: true }) : new http.Agent();
  let request: http.ClientRequest | undefined;
  const deadline = setTimeout(() => request?.destroy(new Error("Local model request exceeded five minutes.")), 300_000);
  try {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      request = (secure ? https.request : http.request)(endpoint, {
        method: "POST", agent, signal, rejectUnauthorized: true,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Content-Length": Buffer.byteLength(body),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      }, resolve);
      request.once("error", reject);
      request.setTimeout(120_000, () => request?.destroy(new Error("Local model response timed out.")));
      request.end(body);
    });
    if (response.statusCode !== 200) {
      response.destroy();
      const error = new Error(`Local model returned HTTP ${response.statusCode}. Redirects and cloud fallback are disabled.`);
      Object.assign(error, { statusCode: response.statusCode });
      throw error;
    }
    if (!response.headers["content-type"]?.toLowerCase().includes("text/event-stream")) {
      response.destroy();
      throw new Error("The model must support Chat Completions SSE streaming.");
    }
    response.setEncoding("utf8");
    let bytes = 0;
    for await (const chunk of response) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) throw new Error("Model response exceeded 8 MiB.");
      yield chunk as string;
    }
  } finally {
    clearTimeout(deadline);
    request?.destroy();
    agent.destroy();
  }
}

export function createLocalModel(settings: ModelSettings): AgentModel {
  const config = validateSettings(settings);
  const endpoint = modelEndpoint(config.baseUrl);
  return {
    async *stream(request: AgentModelRequest): AsyncGenerator<AgentModelEvent> {
      const body = JSON.stringify({
        model: config.model, stream: true, max_tokens: config.maxTokens,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.reasoningEffort !== "none" ? { reasoning_effort: config.reasoningEffort } : {}),
        messages: [...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []), ...wireMessages(request.messages)],
        ...(request.tools.length ? { tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
      });
      // UTF-8 byte length is a conservative estimate without a model-specific tokenizer.
      if (Buffer.byteLength(body) > config.contextWindow! - config.maxTokens!) throw new Error("Context exceeds the configured window. Start a new task or increase the window to match the model.");
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let buffer = "";
      let data: string[] = [];
      let finished: string | undefined;
      let done = false;
      const events = function* (payload: string): Generator<AgentModelEvent> {
        if (payload === "[DONE]") { done = true; return; }
        let item: any;
        try { item = JSON.parse(payload); } catch { throw new Error("Invalid JSON in local model SSE response."); }
        if (item.error) throw new Error("The local model reported an inference error.");
        const choice = item.choices?.[0];
        if (choice?.delta?.content) yield { type: "text-delta", text: String(choice.delta.content) };
        for (const part of choice?.delta?.tool_calls ?? []) {
          if (!Number.isInteger(part.index) || part.index < 0 || part.index > 31) throw new Error("Invalid tool call index.");
          const call = calls.get(part.index) ?? { id: "", name: "", args: "" };
          if (part.id) call.id += part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments) call.args += part.function.arguments;
          if (call.args.length > 1_048_576 || call.name.length > 128 || call.id.length > 256) throw new Error("Tool call exceeds limits.");
          calls.set(part.index, call);
        }
        if (choice?.finish_reason) finished = choice.finish_reason;
        if (item.usage) yield { type: "usage", usage: { inputTokens: item.usage.prompt_tokens ?? 0, outputTokens: item.usage.completion_tokens ?? 0 } };
      };
      for await (const chunk of responseChunks(endpoint, body, config.apiKey, request.signal)) {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/u, "");
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
          else if (!line && data.length) { yield* events(data.join("\n")); data = []; }
        }
        if (done) break;
      }
      if (!done || !finished) throw new Error("The local model stream ended incompletely; no tools were executed.");
      if (finished !== "stop" && finished !== "tool_calls" && finished !== "length") throw new Error("Unsupported model finish reason.");
      // Only expose complete, strictly parsed calls; never execute truncated arguments.
      if (finished !== "length") {
        const ids = new Set<string>();
        for (const [index, call] of calls) {
          if (!call.id || !call.name || ids.has(call.id)) throw new Error("Invalid or duplicate tool call.");
          ids.add(call.id);
          let input: unknown;
          try { input = JSON.parse(call.args); } catch { throw new Error("Model produced invalid tool arguments."); }
          yield { type: "tool-call-delta", index, toolCallId: call.id, toolName: call.name, input };
        }
      }
      yield { type: "finish", reason: finished === "length" ? "max-tokens" : calls.size ? "tool-calls" : "stop" };
    },
  };
}

export async function listLocalModels(settings: ModelSettings): Promise<string[]> {
  const config = validateSettings(settings);
  const endpoint = modelEndpoint(config.baseUrl);
  endpoint.pathname = "/v1/models";
  const secure = endpoint.protocol === "https:";
  const agent = secure ? new https.Agent({ rejectUnauthorized: true }) : new http.Agent();
  try {
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = (secure ? https.request : http.request)(endpoint, {
        method: "GET", agent, rejectUnauthorized: true,
        headers: { Accept: "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      }, resolve);
      request.once("error", reject);
      request.setTimeout(10_000, () => request.destroy(new Error("Local model list timed out.")));
      request.end();
    });
    if (response.statusCode !== 200) { response.destroy(); throw new Error(`Local model list returned HTTP ${response.statusCode}.`); }
    let body = "";
    for await (const chunk of response) {
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Local model list exceeded 1 MiB.");
    }
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { data?: unknown }).data)) throw new Error("Invalid local model list.");
    return (parsed as { data: unknown[] }).data.flatMap((item) => {
      const id = item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
      return typeof id === "string" && id.length > 0 && id.length <= 200 && !/[\r\n\0]/u.test(id) ? [id] : [];
    }).slice(0, 500);
  } finally { agent.destroy(); }
}
