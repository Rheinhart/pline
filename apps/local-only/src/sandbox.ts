import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Workspace } from "./workspace";

export function sandboxArguments(workspace: string, command: string): string[] {
  if (process.platform !== "linux") throw new Error("Command execution is supported only on Linux with bubblewrap.");
  if (!existsSync("/usr/bin/bwrap")) throw new Error("Install bubblewrap using your approved offline system packages. Commands remain disabled.");
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
    "--ro-bind", "/usr", "/usr"];
  for (const dir of ["/bin", "/sbin", "/lib", "/lib64"]) {
    if (existsSync(dir)) args.push("--ro-bind", dir, dir);
  }
  // No host /home, /run, /tmp, /etc, sockets, credentials or network namespace.
  // The workspace is read-only: generated programs cannot bypass reviewed edits.
  args.push("--ro-bind", workspace, "/workspace", "--tmpfs", "/tmp", "--dir", "/home", "--dir", "/home/agent",
    "--proc", "/proc", "--dev", "/dev", "--setenv", "HOME", "/home/agent", "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "LANG", "C.UTF-8", "--chdir", "/workspace", "/bin/sh", "-c", command);
  return args;
}

export async function runIsolated(workspace: string, command: string, signal?: AbortSignal): Promise<{ exitCode: number | null; output: string }> {
  if (typeof command !== "string" || !command.trim() || command.length > 8192) throw new Error("Invalid command.");
  sandboxArguments(workspace, command); // Fail before copying when isolation is unavailable.
  const snapshot = await fs.mkdtemp(path.join(tmpdir(), "cline-local-build-"));
  try {
    const project = await Workspace.open(workspace);
    // A clean snapshot excludes workspace sockets, links, credentials and hooks.
    // Bind-mounting the real project would expose pathname Unix sockets even in a new netns.
    for (const relative of await project.list()) {
      signal?.throwIfAborted();
      let content: string;
      try { content = await project.read(relative); } catch { continue; }
      const target = path.join(snapshot, relative);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, content, { mode: 0o600, flag: "wx" });
    }
    return await executeSandbox(snapshot, command, signal);
  } finally { await fs.rm(snapshot, { recursive: true, force: true }); }
}

async function executeSandbox(workspace: string, command: string, signal?: AbortSignal): Promise<{ exitCode: number | null; output: string }> {
  const args = sandboxArguments(workspace, command);
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/bwrap", args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" }, signal, detached: true });
    let output = "";
    let limitError: Error | undefined;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} };
    const timer = setTimeout(() => { limitError = new Error("Command exceeded 60 seconds."); kill(); }, 60_000);
    const collect = (chunk: Buffer) => {
      if (output.length + chunk.length > 64 * 1024) { limitError = new Error("Command output exceeded 64 KiB."); kill(); }
      else output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    signal?.addEventListener("abort", kill, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", kill); kill(); };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (exitCode) => { cleanup(); limitError ? reject(limitError) : resolve({ exitCode, output }); });
  });
}
