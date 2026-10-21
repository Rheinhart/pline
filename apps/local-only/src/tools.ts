import { createTool, type AgentTool } from "./engine-shared";
import { Workspace, type Approval, type Edit } from "./workspace";
import { runIsolated } from "./sandbox";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object arguments.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string argument.");
  return value;
}
export function localTools(workspace: Workspace, approve: Approval, checkpoint: (edit: Edit) => Promise<void>, commands: boolean): AgentTool[] {
  const define = (name: string, description: string, properties: Record<string, unknown>, required: string[], execute: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>): AgentTool => createTool({
    name, description, inputSchema: { type: "object", properties, required, additionalProperties: false },
    retryable: false, maxRetries: 0, timeoutMs: 600_000, executionMode: "sequential",
    async execute(input: unknown, context) {
      try { context.signal?.throwIfAborted(); return { output: await execute(object(input), context.signal) }; }
      catch (error) { return { isError: true, output: { error: error instanceof Error ? error.message : "Tool failed" } }; }
    },
  });
  const text = { type: "string" };
  const tools = [
    define("list_files", "List up to 1000 project files, excluding hidden, secret and generated paths.", { path: text }, [], async (input) => ({ files: await workspace.list(input.path === undefined ? "" : string(input.path)) })),
    define("read_file", "Read one UTF-8 project file up to 256 KiB.", { path: text }, ["path"], async (input) => ({ content: await workspace.read(string(input.path)) })),
    define("search_files", "Find a literal case-sensitive string in project text files. Returns at most 100 matching lines.", { text }, ["text"], async (input) => {
      const needle = string(input.text);
      if (!needle || needle.length > 1024) throw new Error("Search text must be 1–1024 characters.");
      const matches: { path: string; line: number; text: string }[] = [];
      for (const file of await workspace.list()) {
        let content: string;
        try { content = await workspace.read(file); } catch { continue; }
        for (const [i, line] of content.split("\n").entries()) {
          if (line.includes(needle)) matches.push({ path: file, line: i + 1, text: line.slice(0, 500) });
          if (matches.length >= 100) return { matches, truncated: true };
        }
      }
      return { matches, truncated: false };
    }),
    define("write_file", "Propose a full replacement or new text file in an existing directory. A person must review and approve before writing. Read existing files first.", { path: text, content: text }, ["path", "content"], async (input, signal) => {
      const edit = await workspace.propose(string(input.path), string(input.content));
      if (!await approve({ kind: "edit", edit })) return { rejected: true };
      signal?.throwIfAborted();
      await checkpoint(edit);
      await workspace.apply(edit);
      return { written: edit.path };
    }),
  ];
  if (commands) tools.push(define("run_command", "Run an approved Linux command for up to 60 seconds in a new network namespace. Project is read-only at /workspace. Write build outputs to /tmp (for example cmake -S /workspace -B /tmp/build). No host home, credentials, sockets or internet.", { command: text }, ["command"], async (input, signal) => {
    const command = string(input.command);
    if (!await approve({ kind: "command", command })) return { rejected: true };
    signal?.throwIfAborted();
    return await runIsolated(workspace.root, command, signal);
  }));
  return tools;
}
