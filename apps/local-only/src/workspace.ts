import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SKIP = new Set(["node_modules", "dist", "build", "target", "vendor", "coverage"]);
const DENY = /(^\.|\.(?:pem|key|p12|pfx|sqlite|db)$)/iu;
export const MAX_FILE = 256 * 1024;
export interface Edit { path: string; before: string | null; after: string }
export type Approval = (request: { kind: "edit"; edit: Edit } | { kind: "command"; command: string }) => Promise<boolean>;

export class Workspace {
  private constructor(readonly root: string) {}
  static async open(root: string): Promise<Workspace> {
    const actual = await fs.realpath(root);
    if (!(await fs.stat(actual)).isDirectory() || actual === path.parse(actual).root) throw new Error("Select a project directory.");
    return new Workspace(actual);
  }
  async resolve(relative: string, missingLeaf = false): Promise<string> {
    if (typeof relative !== "string" || !relative || relative.includes("\0") || relative.includes("\\") || path.isAbsolute(relative)) throw new Error("Use a relative project file path.");
    const parts = relative.split("/");
    if (parts.some((p) => !p || p === ".." || DENY.test(p) || SKIP.has(p))) throw new Error("Hidden, secret, generated and parent paths are excluded.");
    let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || (stat.isFile() && stat.nlink !== 1)) throw new Error("Links and special files are excluded.");
      } catch (error) {
        if (missingLeaf && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === "ENOENT") return current;
        throw error;
      }
    }
    return current;
  }
  async read(relative: string): Promise<string> {
    const file = await fs.open(await this.resolve(relative), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE) throw new Error("Only regular text files up to 256 KiB are supported.");
      const data = await file.readFile();
      if (data.length > MAX_FILE || data.includes(0)) throw new Error("Binary or oversized file excluded.");
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } finally { await file.close(); }
  }
  async list(relative = ""): Promise<string[]> {
    const folder = relative ? await this.resolve(relative) : this.root;
    const found: string[] = [];
    let visited = 0;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 12 || visited >= 5000 || found.length >= 1000) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > 5000 || found.length >= 1000) break;
        if (DENY.test(entry.name) || SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) found.push(path.relative(this.root, full).split(path.sep).join("/"));
      }
    };
    await walk(folder, 0);
    return found;
  }
  async propose(relative: string, after: string): Promise<Edit> {
    if (typeof after !== "string" || Buffer.byteLength(after) > MAX_FILE || after.includes("\0")) throw new Error("Replacement must be UTF-8 text up to 256 KiB.");
    await this.resolve(relative, true);
    let before: string | null;
    try { before = await this.read(relative); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; before = null; }
    return { path: relative, before, after };
  }
  async apply(edit: Edit): Promise<void> {
    const target = await this.resolve(edit.path, true);
    const flags = constants.O_NOFOLLOW | (edit.before === null ? constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY : constants.O_RDWR);
    const file = await fs.open(target, flags, 0o600);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE) throw new Error("Unsafe file changed during approval.");
      if (edit.before !== null && (await file.readFile("utf8")) !== edit.before) throw new Error("File changed since review. Request a fresh edit.");
      // Recheck parent links after user review; the writable descriptor cannot follow a replaced final symlink.
      await this.resolve(edit.path);
      await file.write(Buffer.from(edit.after), 0, Buffer.byteLength(edit.after), 0);
      await file.truncate(Buffer.byteLength(edit.after));
      await file.sync();
    } finally { await file.close(); }
  }
}
