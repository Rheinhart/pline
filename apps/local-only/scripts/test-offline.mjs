/**
 * Compile and run the offline build's tests.
 *
 * Tests import the offline sources directly (no VS Code host), so they run in
 * plain Node. esbuild resolves `undici` from the extension's dependency tree,
 * the same way the extension bundle does.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(here, "../..");
const app = path.join(repo, "apps/vscode");
const out = path.join(here, "dist/offline-tests");
const require_ = createRequire(path.join(app, "package.json"));
const esbuild = require_("esbuild");

const tests = (await fs.promises.readdir(path.join(here, "tests"))).filter((file) => file.startsWith("offline-") && file.endsWith(".test.ts"));
if (tests.length === 0) {
  console.error("No offline tests found.");
  process.exit(1);
}

await fs.promises.rm(out, { recursive: true, force: true });
await fs.promises.mkdir(out, { recursive: true });
for (const file of tests) {
  await esbuild.build({
    absWorkingDir: repo,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    logLevel: "warning",
    nodePaths: [path.join(app, "node_modules"), path.join(repo, "node_modules")],
    entryPoints: [path.join(here, "tests", file)],
    outfile: path.join(out, file.replace(/\.ts$/, ".cjs")),
  });
}

const result = spawnSync(process.execPath, ["--test", ...tests.map((file) => path.join(out, file.replace(/\.ts$/, ".cjs")))], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
