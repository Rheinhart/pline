import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import * as http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { modelEndpoint } from "../src/policy";
import { createLocalModel } from "../src/model";
import { Workspace } from "../src/workspace";
import { LocalSession, type Event } from "../src/session";
import { localTools } from "../src/tools";
import { History } from "../src/storage";
import { sandboxArguments, runIsolated } from "../src/sandbox";

async function directory(t: any): Promise<string> {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "cline-offline-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}
async function server(t: any, handler: http.RequestListener): Promise<string> {
  const instance = http.createServer(handler);
  instance.listen(0, "127.0.0.1");
  await once(instance, "listening");
  t.after(() => new Promise<void>((resolve) => { instance.closeAllConnections(); instance.close(() => resolve()); }));
  return `http://127.0.0.1:${(instance.address() as any).port}/v1`;
}
function sse(response: http.ServerResponse, delta: unknown, finish = "stop", done = true): void {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  response.end(done ? "data: [DONE]\n\n" : "");
}
const request = { messages: [], tools: [] };

test("endpoint validation rejects public, DNS, metadata, proxies and obfuscated destinations", () => {
  for (const value of ["https://api.openai.com/v1", "https://8.8.8.8/v1", "http://169.254.169.254/v1", "http://0.0.0.0/v1", "http://100.64.0.1/v1", "http://192.168.1.2.evil.test/v1", "http://user:secret@192.168.1.2/v1", "http://192.168.1.2/v1?target=x", "http://192.168.1.2/v1#x", "http://2130706433/v1", "http://0x7f000001/v1", "http://0177.0.0.1/v1", "http://[::ffff:192.168.1.1]/v1", "http://[fe80::1]/v1", "http://127.0.0.2/v1", "http://192.168.1.2/anything", "ftp://192.168.1.2/v1"]) {
    assert.throws(() => modelEndpoint(value), value);
  }
  for (const value of ["http://127.0.0.1:8000/v1", "https://192.168.1.2/v1/", "http://10.0.0.2/v1", "http://172.31.0.1:8080", "http://[::1]:8000/v1", "https://[fd00::1]/v1"]) {
    assert.equal(modelEndpoint(value).pathname, "/v1/chat/completions");
  }
});

test("workspace blocks traversal, symlinks, hard links, secrets, special and oversized files", async (t) => {
  const dir = await directory(t);
  await fs.writeFile(path.join(dir, "main.c"), "int main() { return 0; }\n");
  await fs.writeFile(path.join(dir, ".env"), "SECRET");
  await fs.symlink("/etc/passwd", path.join(dir, "escape"));
  await fs.link(path.join(dir, "main.c"), path.join(dir, "hard"));
  await fs.writeFile(path.join(dir, "large.txt"), "x".repeat(262145));
  const ws = await Workspace.open(dir);
  for (const file of ["../secret", "/etc/passwd", ".env", "escape", "hard", "large.txt"]) await assert.rejects(ws.read(file));
  assert(!(await ws.list()).includes(".env"));
});

test("edits require approval and detect changes made during review", async (t) => {
  const dir = await directory(t);
  await fs.writeFile(path.join(dir, "a.txt"), "before");
  const ws = await Workspace.open(dir);
  let checkpoints = 0;
  const tool = localTools(ws, async () => false, async () => { checkpoints++; }, false).find((v) => v.name === "write_file")!;
  await tool.execute({ path: "a.txt", content: "after" }, { agentId: "test", iteration: 1 });
  assert.equal(await ws.read("a.txt"), "before");
  assert.equal(checkpoints, 0);
  const edit = await ws.propose("a.txt", "after");
  await fs.writeFile(path.join(dir, "a.txt"), "user change");
  await assert.rejects(ws.apply(edit), /changed since review/u);
  assert.equal(await ws.read("a.txt"), "user change");
  await ws.apply(await ws.propose("a.txt", "approved"));
  assert.equal(await ws.read("a.txt"), "approved");
});

test("local model does not follow redirects or environment proxies", async (t) => {
  let diverted = 0;
  const other = await server(t, (_req, res) => { diverted++; sse(res, { content: "bad" }); });
  const local = await server(t, (_req, res) => { res.writeHead(307, { Location: `${other}/chat/completions` }); res.end(); });
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy"];
  const old = keys.map((key) => process.env[key]);
  for (const key of keys) process.env[key] = other;
  t.after(() => { keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }); });
  await assert.rejects(async () => { for await (const _ of await createLocalModel({ baseUrl: local, model: "test" }).stream(request)) {} }, /HTTP 307/u);
  assert.equal(diverted, 0);
  const successful = await server(t, (_req, res) => sse(res, { content: "direct" }));
  let text = "";
  for await (const event of await createLocalModel({ baseUrl: successful, model: "test" }).stream(request)) if (event.type === "text-delta") text += event.text;
  assert.equal(text, "direct");
  assert.equal(diverted, 0);
});

test("incomplete SSE never exposes executable tool calls", async (t) => {
  const local = await server(t, (_req, res) => sse(res, { tool_calls: [{ index: 0, id: "call-1", function: { name: "write_file", arguments: '{"path":"a","content":"bad"}' } }] }, "tool_calls", false));
  const events: { type: string }[] = [];
  await assert.rejects(async () => { for await (const event of await createLocalModel({ baseUrl: local, model: "test" }).stream(request)) events.push(event); }, /incompletely/u);
  assert(!events.some((e: any) => e.type === "tool-call-delta"));
});

test("real Cline loop reads, requests approval, edits and resumes with local history", async (t) => {
  const dir = await directory(t);
  const storage = await directory(t);
  await fs.writeFile(path.join(dir, "hello.c"), "int value = 1;\n");
  let turn = 0;
  const received: any[] = [];
  const local = await server(t, (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      assert.equal(req.url, "/v1/chat/completions");
      const parsed = JSON.parse(body); received.push(parsed);
      if (turn++ === 0) sse(res, { tool_calls: [{ index: 0, id: "read-1", function: { name: "read_file", arguments: '{"path":"hello.c"}' } }] }, "tool_calls");
      else if (turn === 2) sse(res, { tool_calls: [{ index: 0, id: "write-1", function: { name: "write_file", arguments: JSON.stringify({ path: "hello.c", content: "int value = 2;\n" }) } }] }, "tool_calls");
      else sse(res, { content: "已完成本地修改。" });
    });
  });
  const events: Event[] = [];
  let approvals = 0;
  const settings = { baseUrl: local, model: "local-test" };
  const session = await LocalSession.create(dir, settings, async () => { approvals++; return true; }, (event) => events.push(event), undefined, storage);
  await session.run("Change value to 2.");
  assert.equal(await fs.readFile(path.join(dir, "hello.c"), "utf8"), "int value = 2;\n");
  assert.equal(approvals, 1);
  assert.equal(received.length, 3);
  assert.equal(events.at(-1)?.status, "completed");
  assert(received[1].messages.some((m: any) => m.role === "tool" && m.content.includes("int value = 1")));
  assert(!received[0].tools.some((t: any) => /web|browser|mcp|command/u.test(t.function.name)));
  const restored = await LocalSession.create(dir, settings, async () => true, () => {}, session.id, storage);
  await restored.run("Summarize.");
  assert(received.at(-1).messages.length > received[0].messages.length);
  await restored.undo();
  assert.equal(await fs.readFile(path.join(dir, "hello.c"), "utf8"), "int value = 1;\n");
  const history = await History.open(dir, storage);
  assert.deepEqual(await history.list(), [session.id]);
});

test("sandbox policy cannot silently use the host shell or inherited environment", () => {
  const args = sandboxArguments("/project", "true");
  assert(args.includes("--unshare-all"));
  assert(args.includes("--clearenv"));
  assert(args.includes("--cap-drop"));
  assert(!args.includes("--share-net"));
  assert(!args.includes("--bind"));
});

test("actual sandbox either isolates commands or fails closed", async (t) => {
  const dir = await directory(t);
  await fs.writeFile(path.join(dir, "visible.txt"), "visible");
  await fs.writeFile(path.join(dir, ".env"), "private");
  const result = await runIsolated(dir, "test -f /workspace/visible.txt && test ! -e /workspace/.env && test ! -e /run && test ! -e /etc/resolv.conf && ! touch /workspace/escape && printf isolated");
  if (result.exitCode !== 0) {
    assert.match(result.output, /bwrap:|namespace|Operation not permitted|Permission denied/u);
    t.diagnostic("Host disallows namespaces: verified fail-closed behavior; successful isolation needs a supported Fedora host.");
  } else assert.match(result.output, /isolated/u);
  await assert.rejects(fs.access(path.join(dir, "escape")));
});

test("sandbox cannot connect to a host loopback service or inherit user environment", async (t) => {
  const dir = await directory(t);
  let leaked = 0;
  const local = await server(t, (_req, res) => { leaked++; res.end("unexpected"); });
  const port = new URL(local).port;
  process.env.CLINE_LOCAL_TEST_SECRET = "must-not-inherit";
  t.after(() => { delete process.env.CLINE_LOCAL_TEST_SECRET; });
  const command = `node -e 'if(process.env.CLINE_LOCAL_TEST_SECRET)process.exit(5);const net=require("net");const socket=net.connect(${port},"127.0.0.1");socket.on("connect",()=>process.exit(3));socket.on("error",()=>{console.log("blocked");process.exit(0)});setTimeout(()=>process.exit(4),1000)'`;
  const result = await runIsolated(dir, command);
  if (result.exitCode !== 0 && /bwrap:.*(?:namespace|Operation not permitted|Permission denied)/su.test(result.output)) t.diagnostic("Namespace unavailable; command failed closed.");
  else { assert.equal(result.exitCode, 0, result.output); assert.match(result.output, /blocked/u); }
  assert.equal(leaked, 0);
});

test("cancelled approval cannot write even if a late approval arrives", async (t) => {
  const dir = await directory(t);
  const storage = await directory(t);
  await fs.writeFile(path.join(dir, "a.txt"), "before");
  const local = await server(t, (_req, res) => sse(res, { tool_calls: [{ index: 0, id: "edit-1", function: { name: "write_file", arguments: '{"path":"a.txt","content":"after"}' } }] }, "tool_calls"));
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => { reached = resolve; });
  let decide!: (answer: boolean) => void;
  const events: Event[] = [];
  const session = await LocalSession.create(dir, { baseUrl: local, model: "test" }, () => { reached(); return new Promise((resolve) => { decide = resolve; }); }, (event) => events.push(event), undefined, storage);
  const running = session.run("Edit a.txt");
  await waiting;
  session.abort(); decide(true);
  await running;
  assert.equal(await fs.readFile(path.join(dir, "a.txt"), "utf8"), "before");
  assert.equal(events.at(-1)?.status, "aborted");
});

test("packaged stdio protocol starts without network, completes a task and exits on EOF", async (t) => {
  const dir = await directory(t);
  const configDir = await directory(t);
  const local = await server(t, (_req, res) => sse(res, { content: "local protocol works" }));
  const config = path.join(configDir, "config.json");
  await fs.writeFile(config, JSON.stringify({ baseUrl: local, model: "test" }), { mode: 0o600 });
  const bundleDir = path.dirname(fileURLToPath(import.meta.url));
  const executable = process.env.CLINE_LOCAL_TEST_BINARY;
  const child = spawn(executable ?? process.execPath, [...(executable ? [] : [path.join(bundleDir, "server.mjs")]), "--workspace", dir, "--config", config, "--history-dir", path.join(configDir, "history")], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  const exit = once(child, "exit");
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const events: any[] = [];
  const completed = new Promise<void>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const event = JSON.parse(line); events.push(event);
      if (event.type === "ready") child.stdin.write(JSON.stringify({ type: "prompt", text: "Hello" }) + "\n");
      if (event.type === "error") reject(new Error(event.message));
      if (event.type === "done") { child.stdin.end(); resolve(); }
    });
    child.once("error", reject);
    child.once("exit", (code) => { if (!events.some((e) => e.type === "done")) reject(new Error(`Core exited ${code}: ${stderr}`)); });
  });
  await completed;
  assert.equal((await exit)[0], 0, stderr);
  assert(events.some((event) => event.type === "text" && event.text === "local protocol works"));
  assert.equal(events.find((event) => event.type === "done")?.status, "completed");
});
