import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(app, "../..");
const tools = process.env.LOCAL_ONLY_TOOLS ?? app;
const javaDeps = process.env.LOCAL_ONLY_JAVA_DEPS ?? tools;
const bun = process.env.LOCAL_ONLY_BUN ?? "bun";
const dist = join(app, "dist");
const release = join(dist, "release");
const version = JSON.parse(await fs.readFile(join(app, "package.json"), "utf8")).version;
function run(command, args, cwd = app) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
await fs.mkdir(release, { recursive: true });

// Fail before writing anything. Packaging downloads nothing, so the compiler, the
// runtime gson dependency and the two license files must already be present.
// Aborting at the java step instead left a half-replaced release directory and a
// SHA256SUMS that no longer described it, which reads as a corrupted build rather
// than an unfinished one.
const requiredFiles = ["ecj.jar", "gson.jar", "bun-LICENSE.md", "gson-LICENSE.txt"];
const missing = requiredFiles.filter((name) => !existsSync(join(javaDeps, name)));
// The platform classes come from the IDE's own jars, and their file names change
// between releases (2024.3 has app.jar/util.jar; older layouts had core.jar,
// ide.jar, extensions.jar…), so the classpath is every jar in the directory
// rather than a fixed list of names.
const platformJars = (await fs.readdir(javaDeps).catch(() => []))
  .filter((name) => name.endsWith(".jar") && name !== "ecj.jar" && name !== "gson.jar")
  .sort();
if (missing.length > 0 || platformJars.length === 0) {
  const want = [...missing];
  if (platformJars.length === 0) want.push("the IDE platform jars (lib/*.jar of an IntelliJ-based IDE)");
  throw new Error(
    `JetBrains packaging needs in ${javaDeps}: ${want.join(", ")}.\n` +
      "Set LOCAL_ONLY_JAVA_DEPS to a directory holding ecj.jar, gson.jar, the two license files, " +
      "and the lib/*.jar of an installed IntelliJ-based IDE.",
  );
}
// Fresh staging prevents stale files from entering a release; old artifacts remain until replaced.
const staging = await fs.mkdtemp(join(dist, "package-"));
run("node", [join(app, "scripts/check-types.mjs")]);
run("node", [join(app, "scripts/build.mjs")]);
const core = join(dist, "pline");
run(bun, ["build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--no-compile-autoload-tsconfig", "--no-compile-autoload-package-json", "--outfile", core, join(dist, "server.mjs")]);

const req = createRequire(join(tools, "package.json"));
const notices = [`Pline ${version} — a fork of Cline, distributed for offline use. Original Apache-2.0 license included as LICENSE.\n`];
for (const [name, file] of [["nanoid", "LICENSE"], ["jsonrepair", "LICENSE.md"], ["zod", "LICENSE"]]) {
  let directory = dirname(req.resolve(name));
  while (true) {
    try { if (JSON.parse(await fs.readFile(join(directory, "package.json"), "utf8")).name === name) break; } catch {}
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate license for ${name}`);
    directory = parent;
  }
  notices.push(`\n--- ${name} ---\n${await fs.readFile(join(directory, file), "utf8")}`);
}
const noticeText = notices.join("\n");

// No VS Code package from here. The minimal client's VS Code build was retired:
// the offline build of the original extension (scripts/package-offline-vscode.mjs,
// dist/release/offline/) covers that host with the original interface and
// features, and shipping two VS Code products invited the question "which one is
// mine?" at every install. What remains here is the JetBrains host and the shared
// core it runs.

const plugin = join(staging, "jetbrains/pline");
const classes = join(staging, "classes");
await fs.mkdir(join(plugin, "lib"), { recursive: true });
await fs.mkdir(join(plugin, "bin"), { recursive: true });
await fs.mkdir(classes, { recursive: true });
const classpath = ["gson.jar", ...platformJars].map((name) => join(javaDeps, name)).join(delimiter);
run("java", ["-jar", join(javaDeps, "ecj.jar"), "-17", "-encoding", "UTF-8", "-proc:none", "-classpath", classpath, "-d", classes, join(app, "jetbrains/src/local/cline/LocalToolWindowFactory.java")]);
await fs.cp(join(app, "jetbrains/resources"), classes, { recursive: true });
// The manifest version comes from package.json, so a hand-maintained number in
// plugin.xml can never ship a stale value.
const ideaManifest = join(classes, "META-INF", "plugin.xml");
await fs.writeFile(
  ideaManifest,
  (await fs.readFile(ideaManifest, "utf8")).replace(/<version>[^<]*<\/version>/u, `<version>${version}</version>`),
);
run("zip", ["-q", "-r", join(plugin, "lib/pline.jar"), "."], classes);
await fs.copyFile(join(javaDeps, "gson.jar"), join(plugin, "lib/gson.jar"));
await fs.copyFile(core, join(plugin, "bin/pline"));
await fs.copyFile(join(dist, "server.mjs"), join(plugin, "bin/server.mjs"));
await fs.chmod(join(plugin, "bin/pline"), 0o755);
await fs.copyFile(join(repo, "LICENSE"), join(plugin, "LICENSE"));
// Docs are copied at package time, so a zip built before a documentation change
// ships the old text — which is how a zip built from the pre-rename README ended up
// telling CLion users to install a `pline-minimal-*.vsix` that no longer exists.
// Rebuild this package after touching any of these files.
for (const doc of ["README.md", "IMPLEMENTATION.zh-CN.md", "CLIENT-SETUP.zh-CN.md"]) {
  await fs.copyFile(join(app, doc), join(plugin, doc));
}
// Bun's bundled license inventory must be prepared explicitly; packaging never downloads.
const bunLicenses = await fs.readFile(join(javaDeps, "bun-LICENSE.md"), "utf8");
const gsonLicense = await fs.readFile(join(javaDeps, "gson-LICENSE.txt"), "utf8");
await fs.writeFile(join(plugin, "THIRD_PARTY_NOTICES.txt"), `${noticeText}\n--- Gson ---\n${gsonLicense}\n--- Bun ---\n${bunLicenses}`);
const jetbrains = `pline-clion-${version}-linux-x64.zip`;
run("zip", ["-q", "-r", join(staging, jetbrains), "pline"], join(staging, "jetbrains"));
await fs.rename(join(staging, jetbrains), join(release, jetbrains));
// The checksum file describes the whole release directory: a list of only the two
// names this run happened to produce goes stale the moment anything else is
// replaced, and a stale checksum file is worse than none, because it invites a
// verification failure against a healthy artifact.
const artifacts = (await fs.readdir(release)).filter((name) => /\.(vsix|zip)$/u.test(name)).sort();
const checksums = [];
for (const name of artifacts) checksums.push(`${createHash("sha256").update(await fs.readFile(join(release, name))).digest("hex")}  ${name}`);
await fs.writeFile(join(release, "SHA256SUMS"), checksums.join("\n") + "\n");
await fs.copyFile(join(dist, "server.mjs.inputs.json"), join(release, "core-inputs.json"));
await fs.copyFile(join(dist, "extension.cjs.inputs.json"), join(release, "vscode-inputs.json"));
await fs.rm(staging, { recursive: true, force: true });
console.log(`Local installation packages: ${release}`);
console.log("The VS Code package is built by scripts/package-offline-vscode.mjs into dist/release/offline.");
