import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage } from "./engine-shared";
import type { Edit } from "./workspace";
import { validateSettings, type ModelSettings } from "./policy";

export interface Settings extends ModelSettings { commands?: boolean }
export const configPath = () => path.join(homedir(), ".config", "cline-local", "config.json");

export async function privateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // realpath rejects symlinked ancestors: do not silently store history in cloud/symlink destinations.
  if (await fs.realpath(directory) !== path.resolve(directory)) throw new Error("Local agent storage must not use symbolic links.");
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
    throw new Error("Local agent storage must be owned by this user with permissions 0700.");
  }
}
export async function ensureConfig(filename = configPath()): Promise<string> {
  await privateDirectory(path.dirname(filename));
  try {
    await fs.writeFile(filename, JSON.stringify({ baseUrl: "", model: "", apiKey: "", maxTokens: 4096, commands: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return filename;
}
export async function readSettings(configFile = configPath()): Promise<Settings> {
  const filename = await ensureConfig(configFile);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16_384 || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
    throw new Error("Model config must be a regular, user-owned file with permissions 0600.");
  }
  const input = JSON.parse(await fs.readFile(filename, "utf8"));
  return { ...validateSettings(input), commands: input.commands === true };
}

export class History {
  private constructor(readonly directory: string) {}
  static async open(workspace: string, base = path.join(homedir(), ".local", "share", "cline-local")): Promise<History> {
    await privateDirectory(base);
    const directory = path.join(base, createHash("sha256").update(workspace).digest("hex").slice(0, 24));
    await privateDirectory(directory);
    return new History(directory);
  }
  private file(id: string): string {
    if (!/^[0-9a-f-]{36}$/u.test(id)) throw new Error("Invalid history ID.");
    return path.join(this.directory, `${id}.json`);
  }
  async save(id: string, messages: readonly AgentMessage[], edits: Edit[]): Promise<void> {
    const data = JSON.stringify({ id, updated: new Date().toISOString(), messages, edits });
    if (Buffer.byteLength(data) > 16 * 1024 * 1024) throw new Error("Session reached the local 16 MiB storage limit. Start a new session.");
    const destination = this.file(id);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, destination);
  }
  async load(id: string): Promise<{ messages: AgentMessage[]; edits: Edit[] }> {
    const filename = this.file(id);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) throw new Error("Invalid local history file.");
    const data = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!Array.isArray(data.messages) || !Array.isArray(data.edits)) throw new Error("Invalid local history.");
    return data;
  }
  async list(): Promise<string[]> {
    const names = (await fs.readdir(this.directory)).filter((name) => /^[0-9a-f-]{36}\.json$/u.test(name));
    const entries = await Promise.all(names.map(async (name) => ({ name, time: (await fs.lstat(path.join(this.directory, name))).mtimeMs })));
    return entries.sort((a, b) => b.time - a.time).slice(0, 50).map((e) => e.name.slice(0, -5));
  }
}
