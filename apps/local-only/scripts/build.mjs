import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(here, "../..");
const tools = process.env.LOCAL_ONLY_TOOLS ?? here;
const requireTool = createRequire(join(tools, "package.json"));
const { build } = requireTool("esbuild");
const out = join(here, "dist");
await mkdir(out, { recursive: true });
const aliases = {
  "@cline/agents": join(repo, "sdk/packages/agents/src/agent-runtime.ts"),
  "@cline/shared": join(here, "src/engine-shared.ts"),
  "@cline/llms": join(here, "src/engine-providers.ts"),
};
const base = {
  bundle: true, platform: "node", target: "node22", format: "esm", sourcemap: false,
  absWorkingDir: repo, nodePaths: [join(tools, "node_modules")], alias: aliases, metafile: true,
};
function audit(meta) {
  const allowedSdk = /^sdk\/packages\/(?:agents\/src\/agent-runtime\.ts|shared\/src\/(?:tools\/create|parse\/(?:json|zod|object|string)|llms\/(?:tokens|model-options|tools))\.ts)$/u;
  for (const input of Object.keys(meta.inputs)) {
    if (input.startsWith("sdk/") && !allowedSdk.test(input)) throw new Error(`Unaudited SDK module in offline bundle: ${input}`);
    if (input.startsWith("apps/") && !input.startsWith("apps/local-only/")) throw new Error(`Online app module in offline bundle: ${input}`);
    if (input.includes("node_modules/") && !/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?(?:nanoid|jsonrepair|zod)\//u.test(input)) {
      throw new Error(`Unaudited dependency in offline bundle: ${input}`);
    }
  }
}
async function compile(entry, output, options = {}) {
  const result = await build({ ...base, entryPoints: [join(here, entry)], outfile: join(out, output), ...options });
  audit(result.metafile);
  await writeFile(join(out, `${output}.inputs.json`), JSON.stringify(Object.keys(result.metafile.inputs).sort(), null, 2) + "\n");
}
await compile("src/server.ts", "server.mjs");
await compile("vscode/extension.ts", "extension.cjs", { format: "cjs", external: ["vscode"] });
if (process.argv.includes("--test")) {
  const tests = (await readdir(join(here, "tests"))).filter((file) => file.endsWith(".test.ts"));
  for (const test of tests) await compile(`tests/${test}`, test.replace(/\.ts$/u, ".mjs"), { packages: "bundle" });
  const result = spawnSync("node", ["--test", ...tests.map((t) => join(out, t.replace(/\.ts$/u, ".mjs")))], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Offline bundles built; SDK and third-party module allowlist audit passed.");
