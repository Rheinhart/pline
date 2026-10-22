import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import type { AgentMessage } from "./engine-shared";
import type { Edit } from "./workspace";
import { validateSettings, type ModelSettings } from "./policy";

export interface Settings extends ModelSettings { commands?: boolean }
export interface SettingsDraft { baseUrl: string; model: string; maxTokens: number; contextWindow: number; temperature: number | null; topP: number | null; frequencyPenalty: number | null; presencePenalty: number | null; seed: number | null; reasoningEffort: string; commands: boolean; hasApiKey: boolean }
export interface SettingsUpdate { baseUrl: string; model: string; maxTokens: number; contextWindow?: number; temperature?: number | null; topP?: number | null; frequencyPenalty?: number | null; presencePenalty?: number | null; seed?: number | null; reasoningEffort?: ModelSettings["reasoningEffort"]; commands: boolean; apiKey?: string; clearApiKey?: boolean }
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
  const input = await readConfigObject(configFile);
  return { ...validateSettings({ baseUrl: input.baseUrl as string, model: input.model as string, apiKey: input.apiKey as string | undefined, maxTokens: input.maxTokens as number | undefined, contextWindow: input.contextWindow as number | undefined, temperature: input.temperature as number | undefined, topP: input.topP as number | undefined, frequencyPenalty: input.frequencyPenalty as number | undefined, presencePenalty: input.presencePenalty as number | undefined, seed: input.seed as number | undefined, reasoningEffort: input.reasoningEffort as ModelSettings["reasoningEffort"] }), commands: input.commands === true };
}
async function readConfigObject(configFile: string): Promise<Record<string, unknown>> {
  const filename = await ensureConfig(configFile);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16_384 || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
    throw new Error("Model config must be a regular, user-owned file with permissions 0600.");
  }
  const input: unknown = JSON.parse(await fs.readFile(filename, "utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid model config.");
  return input as Record<string, unknown>;
}
export async function readSettingsDraft(configFile = configPath()): Promise<SettingsDraft> {
  const input = await readConfigObject(configFile);
  return {
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : "",
    model: typeof input.model === "string" ? input.model : "",
    maxTokens: Number.isInteger(input.maxTokens) ? input.maxTokens as number : 4096,
    contextWindow: Number.isInteger(input.contextWindow) ? input.contextWindow as number : 131072,
    temperature: typeof input.temperature === "number" ? input.temperature : null,
    topP: typeof input.topP === "number" ? input.topP : null,
    frequencyPenalty: typeof input.frequencyPenalty === "number" ? input.frequencyPenalty : null,
    presencePenalty: typeof input.presencePenalty === "number" ? input.presencePenalty : null,
    seed: typeof input.seed === "number" ? input.seed : null,
    reasoningEffort: typeof input.reasoningEffort === "string" ? input.reasoningEffort : "none",
    commands: input.commands === true,
    hasApiKey: typeof input.apiKey === "string" && input.apiKey.length > 0,
  };
}
export async function saveSettings(update: SettingsUpdate, configFile = configPath()): Promise<SettingsDraft> {
  const current = await readConfigObject(configFile);
  const candidate = validateSettings({
    baseUrl: update.baseUrl, model: update.model, maxTokens: update.maxTokens,
    contextWindow: update.contextWindow ?? (current.contextWindow as number | undefined),
    temperature: update.temperature === null ? undefined : (update.temperature ?? (current.temperature as number | undefined)),
    topP: update.topP === null ? undefined : (update.topP ?? (current.topP as number | undefined)),
    frequencyPenalty: update.frequencyPenalty === null ? undefined : (update.frequencyPenalty ?? (current.frequencyPenalty as number | undefined)),
    presencePenalty: update.presencePenalty === null ? undefined : (update.presencePenalty ?? (current.presencePenalty as number | undefined)),
    seed: update.seed === null ? undefined : (update.seed ?? (current.seed as number | undefined)),
    reasoningEffort: update.reasoningEffort ?? (current.reasoningEffort as ModelSettings["reasoningEffort"]),
    apiKey: update.clearApiKey ? "" : update.apiKey || (typeof current.apiKey === "string" ? current.apiKey : ""),
  });
  if (typeof update.commands !== "boolean") throw new Error("Invalid command setting.");
  const filename = await ensureConfig(configFile);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ ...candidate, commands: update.commands }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
  return readSettingsDraft(configFile);
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
