import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
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
// Fresh staging prevents stale files from entering a release; old artifacts remain until replaced.
const staging = await fs.mkdtemp(join(dist, "package-"));
run("node", [join(app, "scripts/check-types.mjs")]);
run("node", [join(app, "scripts/build.mjs")]);
const core = join(dist, "cline-local");
run(bun, ["build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--no-compile-autoload-tsconfig", "--no-compile-autoload-package-json", "--outfile", core, join(dist, "server.mjs")]);

const req = createRequire(join(tools, "package.json"));
const notices = [`Cline Local ${version} — fork of Cline. Original Apache-2.0 license included as LICENSE.\n`];
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
const ext = join(staging, "vsix", "extension");
await fs.mkdir(join(ext, "dist"), { recursive: true });
await fs.copyFile(join(dist, "extension.cjs"), join(ext, "dist/extension.cjs"));
await fs.mkdir(join(ext, "assets"), { recursive: true });
await fs.copyFile(join(app, "vscode/assets/icon.svg"), join(ext, "assets/icon.svg"));
await fs.copyFile(join(app, "vscode/package.json"), join(ext, "package.json"));
await fs.copyFile(join(repo, "LICENSE"), join(ext, "LICENSE"));
await fs.copyFile(join(app, "README.md"), join(ext, "README.md"));
await fs.copyFile(join(app, "IMPLEMENTATION.zh-CN.md"), join(ext, "IMPLEMENTATION.zh-CN.md"));
await fs.writeFile(join(ext, "THIRD_PARTY_NOTICES.txt"), noticeText);
await fs.writeFile(join(staging, "vsix/[Content_Types].xml"), `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="" ContentType="text/plain"/></Types>`);
await fs.writeFile(join(staging, "vsix/extension.vsixmanifest"), `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="cline-local-only" Version="${version}" Publisher="local-cline"/><DisplayName>Cline Local</DisplayName><Description xml:space="preserve">Local-only coding agent with an explicitly configured private model endpoint.</Description><Tags>local,agent</Tags><Categories>Programming Languages</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.101.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/></Properties><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets></PackageManifest>`);
const vsix = `cline-local-${version}.vsix`;
run("zip", ["-q", "-r", join(staging, vsix), "."], join(staging, "vsix"));
await fs.rename(join(staging, vsix), join(release, vsix));

const plugin = join(staging, "jetbrains/cline-local");
const classes = join(staging, "classes");
await fs.mkdir(join(plugin, "lib"), { recursive: true });
await fs.mkdir(join(plugin, "bin"), { recursive: true });
await fs.mkdir(classes, { recursive: true });
const jarNames = ["core", "ide", "ide-core", "util", "extensions", "util-progress", "annotations", "gson"];
const classpath = jarNames.map((name) => join(javaDeps, `${name}.jar`)).join(delimiter);
run("java", ["-jar", join(javaDeps, "ecj.jar"), "-17", "-encoding", "UTF-8", "-proc:none", "-classpath", classpath, "-d", classes, join(app, "jetbrains/src/local/cline/LocalToolWindowFactory.java")]);
await fs.cp(join(app, "jetbrains/resources"), classes, { recursive: true });
run("zip", ["-q", "-r", join(plugin, "lib/cline-local.jar"), "."], classes);
await fs.copyFile(join(javaDeps, "gson.jar"), join(plugin, "lib/gson.jar"));
await fs.copyFile(core, join(plugin, "bin/cline-local"));
await fs.copyFile(join(dist, "server.mjs"), join(plugin, "bin/server.mjs"));
await fs.chmod(join(plugin, "bin/cline-local"), 0o755);
await fs.copyFile(join(repo, "LICENSE"), join(plugin, "LICENSE"));
await fs.copyFile(join(app, "README.md"), join(plugin, "README.md"));
await fs.copyFile(join(app, "IMPLEMENTATION.zh-CN.md"), join(plugin, "IMPLEMENTATION.zh-CN.md"));
// Bun's bundled license inventory must be prepared explicitly; packaging never downloads.
const bunLicenses = await fs.readFile(join(javaDeps, "bun-LICENSE.md"), "utf8");
const gsonLicense = await fs.readFile(join(javaDeps, "gson-LICENSE.txt"), "utf8");
await fs.writeFile(join(plugin, "THIRD_PARTY_NOTICES.txt"), `${noticeText}\n--- Gson ---\n${gsonLicense}\n--- Bun ---\n${bunLicenses}`);
const jetbrains = `cline-local-clion-${version}-linux-x64.zip`;
run("zip", ["-q", "-r", join(staging, jetbrains), "cline-local"], join(staging, "jetbrains"));
await fs.rename(join(staging, jetbrains), join(release, jetbrains));
const checksums = [];
for (const name of [vsix, jetbrains]) checksums.push(`${createHash("sha256").update(await fs.readFile(join(release, name))).digest("hex")}  ${name}`);
await fs.writeFile(join(release, "SHA256SUMS"), checksums.join("\n") + "\n");
await fs.copyFile(join(dist, "server.mjs.inputs.json"), join(release, "core-inputs.json"));
await fs.copyFile(join(dist, "extension.cjs.inputs.json"), join(release, "vscode-inputs.json"));
await fs.rm(staging, { recursive: true, force: true });
console.log(`Local installation packages: ${release}`);
