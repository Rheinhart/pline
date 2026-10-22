/**
 * Package the offline distribution as a VS Code extension (.vsix).
 *
 * The identity is deliberately separate from the official `saoudrizwan.claude-dev`
 * so the two can coexist and never update each other; the extension *name*
 * stays `claude-dev`, because upstream derives its command and view IDs from it
 * and keeping it preserves the original interface exactly. No marketplace or
 * update service is configured: this package is installed from disk.
 *
 * Packaging downloads nothing. Run `bun install` and `bun run build:sdk`
 * beforehand, then `node scripts/build-offline-vscode.mjs` and the webview
 * build (`bun run build:webview` in apps/vscode).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(here, "../..");
const app = path.join(repo, "apps/vscode");
const bundle = path.join(here, "dist/offline-vscode");
const stage = path.join(here, "dist/offline-vsix");
const out = path.join(here, "dist/release");

const PUBLISHER = "local-cline";
const NAME = "claude-dev";

function need(file, hint) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${path.relative(repo, file)}.\n${hint}`);
    process.exit(1);
  }
}

need(path.join(bundle, "extension.js"), "Run: node apps/local-only/scripts/build-offline-vscode.mjs");
need(path.join(bundle, "endpoints.json"), "Run: node apps/local-only/scripts/build-offline-vscode.mjs");
need(path.join(app, "webview-ui/build/assets/index.js"), "Run: bun run build:webview in apps/vscode");
need(path.join(app, "assets/icons/icon.png"), "The extension icon is missing from apps/vscode/assets/icons.");

const source = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).version;

const manifest = {
  ...source,
  publisher: PUBLISHER,
  name: NAME,
  version,
  displayName: "Cline Local",
  description: "Cline 本机／内网模型专用发行版：保留原有界面与本地功能，不连接互联网。Offline build: original UI, no internet access.",
  preview: false,
  // No marketplace identity, no telemetry endpoints from the manifest.
  repository: undefined,
  bugs: undefined,
  homepage: undefined,
  gallery: {
    ...(source.gallery ?? {}),
    color: undefined,
    theme: "dark",
  },
  activationEvents: source.activationEvents,
  contributes: source.contributes,
  capabilities: { ...(source.capabilities ?? {}), untrustedWorkspaces: { supported: false } },
  main: "./dist/extension.js",
  browser: undefined,
  scripts: undefined,
  devDependencies: undefined,
  dependencies: undefined,
  engines: source.engines,
};
for (const [key, value] of Object.entries(manifest)) if (value === undefined) delete manifest[key];

fs.rmSync(stage, { recursive: true, force: true });
const root = path.join(stage, "extension");
fs.mkdirSync(root, { recursive: true });

fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.copyFileSync(path.join(bundle, "extension.js"), path.join(root, "dist", "extension.js"));
fs.cpSync(path.join(bundle, "plugin-runtime"), path.join(root, "dist", "plugin-runtime"), { recursive: true });
fs.copyFileSync(path.join(bundle, "endpoints.json"), path.join(root, "endpoints.json"));
fs.cpSync(path.join(app, "webview-ui/build"), path.join(root, "webview-ui", "build"), { recursive: true });
fs.cpSync(path.join(app, "assets"), path.join(root, "assets"), { recursive: true });
fs.copyFileSync(path.join(app, "LICENSE"), path.join(root, "LICENSE"));
fs.writeFileSync(
  path.join(root, "README.md"),
  `# Cline Local（本机／内网模型专用）

这是 Cline 的离线发行版：界面与本地功能保持原样，但不连接互联网。

- 唯一允许的网络目标是用户配置的本机／内网模型端点（回环地址与私有网段；非回环强制 https）。
- 公网地址、链路本地与云元数据地址、域名默认全部拒绝；拒绝发生在请求体产生之前。
- 遥测、错误上报、远程功能开关、账户、市场、云会话、历史上传、浏览器工具与网页读取均不进入发布包。
- Webview 的内容安全策略只允许随包资源，模型回答里的远程图片不会被加载。
- 没有自动更新，也没有在线商店身份；请从磁盘安装并手动替换。

配置与限制详见源码仓库中的 \`apps/local-only/README.md\` 与 \`IMPLEMENTATION.zh-CN.md\`。

## 模型端点

在设置中选择 OpenAI 兼容／Ollama／LM Studio，填写本机或内网地址，例如：

- \`http://127.0.0.1:11434/v1\`（同机）
- \`https://192.168.1.50:8000/v1\`（内网，需证书校验通过）

内网使用明文 http、内网 CA 或证书指纹固定，可写入 \`~/.config/cline-local/network.json\`
（\`lanPlainHttp\`、\`caCertPath\`、\`pinSha256\`、\`allowLanDns\`）。这些选项只能收紧策略。

**发送任务即表示相关提示词、代码与工具输出会发往该端点。**

## 已知未完成项

云端 provider 仍列在设置中，选择后会在任务开始时给出本地错误；命令执行尚未接入禁网沙箱；
本发行版仅打包 Linux x86_64 的插件运行时（Webview 与核心为跨平台 JS）。
`,
);

// VSIX is an OPC package: two manifest parts plus the extension folder.
fs.writeFileSync(
  path.join(stage, "[Content_Types].xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="jsonc" ContentType="application/json" />
  <Default Extension="map" ContentType="application/json" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="mjs" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="jpg" ContentType="image/jpeg" />
  <Default Extension="ttf" ContentType="application/octet-stream" />
  <Default Extension="woff" ContentType="application/octet-stream" />
  <Default Extension="woff2" ContentType="application/octet-stream" />
  <Default Extension="wasm" ContentType="application/wasm" />
  <Default Extension="node" ContentType="application/octet-stream" />
  <Default Extension="ts" ContentType="text/plain" />
</Types>
`,
);

fs.writeFileSync(
  path.join(stage, "extension.vsixmanifest"),
  `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${NAME}" Version="${version}" Publisher="${PUBLISHER}" />
    <DisplayName>Cline Local</DisplayName>
    <Description xml:space="preserve">Cline 本机／内网模型专用发行版：保留原有界面与本地功能，不连接互联网。</Description>
    <Tags>cline,ai,chat,local model,offline</Tags>
    <Categories>${(manifest.gallery?.categories ?? ["AI", "Chat", "Other"]).join(",")}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${source.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/assets/icons/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`,
);

fs.mkdirSync(out, { recursive: true });
const vsix = path.join(out, `cline-local-${version}.vsix`);
fs.rmSync(vsix, { force: true });
execFileSync("zip", ["-r", "-X", "-q", vsix, "[Content_Types].xml", "extension.vsixmanifest", "extension"], {
  cwd: stage,
  stdio: "inherit",
});

const bytes = fs.readFileSync(vsix);
const sha256 = createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(
  path.join(out, "SHA256SUMS-offline-vscode"),
  `${sha256}  ${path.basename(vsix)}\n`,
);
console.log(
  `Packed ${path.basename(vsix)} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB, sha256 ${sha256.slice(0, 16)}…) as ${PUBLISHER}.${NAME}@${version}.`,
);
