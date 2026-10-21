import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { LocalSession, type Event } from "./session";
import { ensureConfig, History, readSettings } from "./storage";
import { Workspace } from "./workspace";

// Local stdio only. No HTTP, WebSocket server, discovery or background daemon.
const rootFlag = process.argv.indexOf("--workspace");
if (rootFlag < 0 || !process.argv[rootFlag + 1]) throw new Error("--workspace is required.");
const root = (await Workspace.open(resolve(process.argv[rootFlag + 1]))).root;
// Explicit launch flags for administrators/testing; never read these from project files or model output.
const argument = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  if (!process.argv[index + 1]) throw new Error(`${flag} requires a path.`);
  return resolve(process.argv[index + 1]);
};
const configFile = argument("--config");
const historyBase = argument("--history-dir");
const send = (event: Event) => process.stdout.write(JSON.stringify(event) + "\n");
let session: LocalSession | undefined;
let busy = false;
const approvals = new Map<string, (accepted: boolean) => void>();
const cancel = () => { session?.abort(); for (const answer of approvals.values()) answer(false); approvals.clear(); };
const approve = async (request: any): Promise<boolean> => await new Promise((resolve) => {
  const id = randomUUID();
  const timer = setTimeout(() => { approvals.delete(id); resolve(false); }, 300_000);
  approvals.set(id, (accepted) => { clearTimeout(timer); approvals.delete(id); resolve(accepted); });
  send({ type: "approval", id, ...request });
});

await ensureConfig(configFile);
send({ type: "ready" });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  void (async () => {
    if (line.length > 128 * 1024) throw new Error("Input exceeds limit.");
    const message = JSON.parse(line);
    if (message.type === "cancel") { cancel(); return; }
    if (message.type === "approval") { approvals.get(message.id)?.(message.accepted === true); return; }
    if (busy) throw new Error("A task is already running.");
    busy = true;
    try {
      if (message.type === "new") { session = undefined; send({ type: "notice", text: "New task ready." }); }
      else if (message.type === "history") { send({ type: "history", ids: await (await History.open(root, historyBase)).list() }); }
      else if (message.type === "resume") { session = await LocalSession.create(root, await readSettings(configFile), approve, send, message.id, historyBase); }
      else if (message.type === "undo") { if (!session) throw new Error("No active session."); await session.undo(); }
      else if (message.type === "prompt") {
        session ??= await LocalSession.create(root, await readSettings(configFile), approve, send, undefined, historyBase);
        await session.run(message.text);
      } else throw new Error("Unknown local command.");
    } finally { busy = false; }
  })().catch((error) => send({ type: "error", message: error instanceof Error ? error.message : "Local task failed" }));
});
input.once("close", () => { cancel(); process.exit(0); });
process.once("SIGTERM", () => { cancel(); process.exit(0); });
