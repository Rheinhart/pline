# Cline Local 改造实施记录

## 0. 进行中：第二条实现路线（离线版 = 原版扩展裁剪）

上面的 `0.1.x` 是**自写的精简客户端**（独立界面、4 个工具）。根据后续明确的目标——**去掉联网，但尽量保留原版的功能和界面**——正在增加第二条路线：直接编译原版 `apps/vscode` 扩展，只在编译期替换联网模块。

已落地（截至 2026-10-22，未提交，未打包成 VSIX）：

- `apps/local-only/offline/`：
  - `net-policy.ts` 地址策略（回环 + RFC1918 + IPv6 ULA + 可选 CGNAT；非回环强制 https；拒绝公网、链路本地、云元数据、域名与含糊写法；可选内网 CA 与 SPKI 指纹固定）。
  - `network-settings.ts` 读取 `~/.config/cline-local/network.json`（`lanPlainHttp`、`allowLanDns`、`allowCgnat`、`caCertPath`、`pinSha256`、`strictSockets`；不能把策略放宽到公网）。
  - `net-guard.ts` 顶替 `@shared/net`：无代理、不跟随重定向、请求体产生之前就拒绝。
  - `node/{net,tls,dns,dgram,http,https}.ts` 只在离线包内替换这些模块，策略在 connect 层再次生效（不影响扩展宿主里的其他插件）。
  - `stubs/` 替换 PostHog 客户端、遥测/错误/功能开关工厂、SDK 核心的账号功能开关与 PostHog provider、浏览器工具（puppeteer/下载 Chrome 全部出局）。
- `stubs/` 替换 PostHog 客户端、遥测/错误/功能开关工厂、SDK 核心的账号功能开关与 PostHog provider、浏览器工具（puppeteer/下载 Chrome 全部出局）、以及**云端模型 provider**：`@cline/llms` 是一个打包好的 dist，无法逐个换掉 vendor 模块，因此改为在 **npm 包名**层面拦截：Anthropic / Google / Vertex / Bedrock（`@aws-sdk`、`@smithy`）/ SAP / Google Auth / OpenRouter 换成会报本地错误的桩，Langfuse 与 OTEL 导出器换成静默桩。设置界面仍然列出这些 provider，选中并开始时得到中文错误，不会联网。本机可用的入口（OpenAI 兼容、Ollama、LM Studio、LiteLLM）保持原样。另外 `stubs/cloud-provider.ts` 顶替 src 构建下的 vendor 模块。
- `scripts/build-offline-vscode.mjs`：编译 `offline/entry.ts` → `dist/offline-vscode/extension.js`，并对模块清单做审计（禁止清单 22 项：分析、追踪导出器、错误上报、浏览器自动化、云端模型 SDK）。当前：**2765 个模块、34.8 MiB**（未压缩；原版为 5819 / 54 MiB），审计通过；剩下的 108 个 `@opentelemetry/api|core` 一类模块本身不含传输层，审计会单独列出说明。
- `scripts/package-offline-vscode.mjs`：手工生成 VSIX（不用 vsce，不下载），写入 `dist/release/offline/`（与最小客户端的产物分目录，以前同名的 `cline-local-<version>.vsix` 曾互相覆盖）。身份为 **`local.pline`**，产品名 **Pline**；因为上游从 `package.json` 的 `name` 派生命令与视图 ID，重命名同时发生在编译期与 `contributes`（`scripts/identity.mjs` 统一生成）。产物 `pline-0.2.0.vsix`（12.7 MiB）+ `SHA256SUMS-offline-vscode`。已用 `code --install-extension` 安装到独立目录并用 `--list-extensions` 确认：`local.pline@0.2.0`。
- Webview CSP：`WebviewProvider.ts` 里加了一个 4 行的条件分支（`process.env.CLINE_LOCAL_OFFLINE === "true"`，普通构建不定义该变量，行为不变）。这一项是**真正的隐私必需**：Webview 是浏览器上下文，Node 层的地址策略管不到它，原 CSP 的 `img-src … https:` 会让模型回答里的远程图片自动去拉取。离线 CSP 只允许随包资源（`connect-src 'self' + cspSource`）。
- `endpoints.json`：随包写入三个云端基址为 `http://127.0.0.1:1`（已关闭的回环端口），同时触发上游 self-hosted 机制；配置里不再出现公网地址，漏网的调用会立即失败而不是去公网。
- `entry.ts` 启动时清除 `CLINE_*` / `OTEL_*` / `CLINE_STORAGE_*` 环境变量（只动 Cline 自己的名字，不碰代理设置），覆盖编译宏无法匹配的 `process?.env?.X` 写法；环境变量不能重新开启已删除的能力。
- `scripts/smoke-offline-vscode.mjs`：注入最小 `vscode` 模块后**实际 require 打包产物**，验证整个模块图能求值、`activate`/`deactivate` 存在。它已经抓到一个真实的循环依赖初始化 bug（`node/net` 在策略模块就绪前读取选项）。
- `scripts/test-offline.mjs` + `tests/offline-net.test.ts`：7 项网络边界测试全部通过（含回环服务实际收发、重定向不跟随、代理环境变量无效、公网地址在发出前被拒、裸 socket/DNS 同策略）。
- 根 `package.json` 新增 `build:local-offline`、`test:local-offline`、`smoke:local-offline`、`package:local-offline`。

**真机已跑通**（用户机器，VS Code 扩展侧栏 + 局域网 OpenAI 兼容服务 `http://192.168.0.33:8080/v1`）：模型正常回复，说明回环/私有地址策略、明文局域网的 `lanPlainHttp` 开关、self-hosted 端点与 CSP 在一起是能共存的。

真机上碰到的两个坑（都不是网络层问题）：

1. 非回环的明文 http 默认被拒，报 `Plaintext http to 192.168.0.33 would expose your code on the LAN`。这是设计如斯：目标地址是 RFC1918（允许），但明文出本机就可能被同网段设备抓包。解法：`~/.config/cline-local/network.json` 写 `{ "lanPlainHttp": true }` 并重载窗口；想保留加密则用 SSH 隧道（`ssh -N -L 8080:127.0.0.1:8080 主机`，然后填 `http://127.0.0.1:8080/v1`）或给服务端配证书（`caCertPath` / `pinSha256`）。隧道已做成可直接安装的单元（`systemd/model-tunnel.service` + `model-tunnel.env`）。开启 `lanPlainHttp` 后扩展会日志提示一次：被允许的明文连接不会失败，不提示就无法察觉数据在局域网上是裸的（`onNetworkNotice`，启动日志同时列出当前生效的策略开关）。
2. 首次打开侧栏报 `Could not register service worker: InvalidStateError: … The document is in an invalid state`。**已确认原因**：VS Code 配置目录里残留的 service worker 缓存；完全退出后删除 `<配置目录>/Service Worker`（如 `~/.config/Code/Service Worker`）即恢复正常，用户机器已实测。与离线层无关；能报出 `local-cline.claude-dev` 就说明扩展已激活、视图已注册。官方 `saoudrizwan.claude-dev` 未安装时不存在视图 ID 冲突。

### 0.1 产品名与上游链接

产品名改为 **Pline**（身份 `local.pline`，命令前缀 `pline.`）。上游从自己的 `package.json` name 派生**每一个**命令与视图 ID（`src/registry.ts`），所以上线重命名必须同时发生在两边：编译时把 `apps/vscode/package.json` 重定向到补丁后的副本（`package.identity.json`，打包产物里可见 `name = "pline"`），发布包的 `contributes` 则重写容器 ID、视图 ID、20 个命令 ID、`when` 子句里的引用与标题。两边共用 `scripts/identity.mjs`，这是它们不会错位的唯一保证；错位不会报错，只会静默丢掉右键菜单、快捷键和整个侧栏。审计会仍回读编译产物里内联的身份值（命令 ID 是拼接出来的，无法当字面量 grep）。

上游站点链接在**编译产物**里换成惰性的 `#`（源码不动）：扩展包 26 处 `*.cline.bot` + 3 处 `github.com/cline`，Webview 36 + 7 + 2 处。匹配模式故意宽（包含 `docs.` / `app.` / `api.` / staging 主机与 `@cline.bot` 邮箱判定）——漏一个变体就是留一个活链接。模型商的 API 基址（openrouter.ai 等）**不算品牌**，它们是云端 provider 的配置默认值，保留。

### 0.2 模型机定向防火墙

模型服务是 systemd 单元 `strata-nvfp4.service`（`User=thomas`，监听 `0.0.0.0:8080`）。**不能按 UID 过滤**——它跟开发者是同一个用户，`iptables -m owner --uid-owner` 会连带屏蔽人的终端。改用单元级 cgroup 过滤（`systemd/model-host-lan-only.conf`）：`IPAddressAllow=127.0.0.0/8 192.168.0.0/24 ::1/128 fe80::/10` + `IPAddressDeny=any`，入站查源地址、出站查目的地址，因此只影响这一个服务，其余进程（包括模型下载）照常。站点本地 IPv6（`fd00::/8`）**故意不允**——那台机器上这段属 tailscale。

未能本机验证：无免密 sudo，而**非特权用户单元会静默忽略这套过滤**（`systemd-run --user` 实验里 `IPAddressDeny=any` 下 curl 仍返回 200）。所以下面那条验证命令是必需的，不是走过场：过滤静默失效比没有过滤更危险。

### 0.3 机器级开关（命令与其他程序的禁网保证）

扩展层只能保证 **Cline 自己**不出公网。有两块构造上盖不到：

1. **编辑器本体**：VS Code 会自己访问市场、更新检查、内置扩展遥测；
2. **模型机**：代码和历史都存在那台上，它的出网不受笔记本约束。

因此提供一个机器级开关 `scripts/lan-only.sh off|on|status`：给默认路由加一条 `blackhole`（IPv4 与 IPv6），非本地网段立即`Network unreachable`，局域网与路由器 DNS 照常。选它而不是防火墙规则的理由是：不持有状态、不与 ufw/docker/nftables 冲突、删一条路由即恢复。局限：不区分程序与端口，只管主路由表；日常用这个开关，需要更细策略时另置防火墙。

> 本机实测受限：此云 VM 无免密 sudo，也禁用了用户命名空间（`unshare -rn` 失败），所以**仅语法与只读的 `status` 路径已验证**，`off`/`on` 两条 `ip` 命令尚待在用户机器上执行。（同一个限制也说明了为何第二条路线没沿用 0.1.2 的 `bwrap --unshare-all` 命令沙箱。）

对模型机更合适的做法是只约束模型服务本身（其余开发工具继续可用），例如 systemd drop-in：`IPAddressAllow=127.0.0.0/8 192.168.0.0/24 ::1 fe80::/10` + `IPAddressDeny=any`。

一个实测发现：模型地址 `192.168.0.33` 就是本仓库所在的这台机器（`python` 监听 `0.0.0.0:8080`，OpenAI 兼容、带 API key）。这台机器同时有**公网 IPv6** 与 **tailscale0**（100.124.x，属 CGNAT）。两个推论：笔记本侧的开关管不到它；若走 Tailscale 地址访问模型，流量可能经公网 DERP 中继，就不再是“只在家内”——插件默认也**不允许** 100.64.0.0/10（需显式 `allowCgnat`），所以继用 `192.168.0.33` 是对的。

尚未做：把账户/市场/云会话等入口改为“离线不可用”提示（现在只是连不上，不是看不到）；命令沙箱接入（现由机器级开关覆盖，见 §0.3）；CLion 宿主对接；本文件其余部分的文档改写。

**命名现状**：两条路线均已改名 Pline 并**已重新打包**。当前产物：`dist/release/offline/pline-0.2.0.vsix`（`local.pline`，原版扩展的离线构建）与 `dist/release/pline-minimal-0.2.0.vsix` + `pline-minimal-clion-0.2.0-linux-x64.zip`（最小客户端，VS Code `local.pline-minimal`、JetBrains `local.pline.agent`，工具窗口 Pline）；jar 内的 `plugin.xml` 已核对为 `local.pline.agent` / `Pline` / `0.2.0`，版本号由脚本从 `package.json` 注入。旧的 `cline-local-0.1.2.vsix` 保留在目录里作为历史产物（`SHA256SUMS` 仍覆盖并校验通过）。数据目录**故意保留** `~/.config/cline-local/`：两条路线共用，改名会让现有配置与会话记录静默失效。下文第 8 节的安装步骤描述的是当时发布的 0.1.2 包（包括旧的图标名 `Cline Local`），保留作历史记录。

---

记录日期：2026-10-21。发行版版本：`0.1.2`。

本记录描述此次实际写入仓库的改动，与最初的[需求方案](../../LOCAL_ONLY_FORK_PLAN.zh-CN.md)区分。安装和日常使用见[README](README.md)。

## 1. 交付结果

新增 `apps/local-only/` 工作区，提供共用的本地 agent 核心、VS Code 扩展和 CLion 宿主插件。核心使用当前仓库真正的 Cline Agent 执行循环，不是只展示固定回复的演示程序。

离线版采用独立入口与构建范围。原有 `apps/vscode/`、CLI、桌面端及云功能源码保留在仓库中；它们没有进入本次离线发行包。原版构建命令仍生成原版，只有 `package:local` 生成这里描述的发行版。

两个 IDE 的界面是本次新增的精简界面，不包含原版 Cline 的全部界面和功能。当前实现支持对话、文件读取／搜索、审批后修改、本地历史与检查点、撤销，以及可选 Linux 禁网命令。

生成的文件位于 `apps/local-only/dist/release/`：

| 文件 | 用途 |
| --- | --- |
| `cline-local-0.1.2.vsix` | VS Code 本地安装包 |
| `cline-local-clion-0.1.2-linux-x64.zip` | CLion Linux x86_64 本地安装包，含独立核心运行时 |
| `SHA256SUMS` | 两个安装包的实际 SHA-256；重新打包后以该文件为准 |
| `core-inputs.json` | 核心构建输入模块清单 |
| `vscode-inputs.json` | VS Code 构建输入模块清单 |

安装包属于生成物，匹配仓库现有 `.gitignore` 的 `dist` / `*.vsix` 规则，不会自动进入 Git 提交。

## 2. 逐文件改动清单

以下路径以仓库根目录为起点。

| 文件 | 实际改动 |
| --- | --- |
| `README.md` | 在上游说明之前加入本 fork 离线发行版入口，标明专用构建命令 |
| `package.json` | 加入 `build:local`、`test:local`、`typecheck:local`、`package:local` 四个脚本 |
| `bun.lock` | 由 Bun 更新新工作区与固定依赖；包含相关依赖的提升／嵌套位置调整 |
| `LOCAL_ONLY_FORK_PLAN.zh-CN.md` | 保存初始需求、源码联网入口审计和验收目标；更新当前实施状态 |
| `apps/local-only/package.json` | 定义私有工作区 `@cline/local-only`、版本、构建／测试／类型检查／打包命令和固定开发依赖 |
| `apps/local-only/src/engine-shared.ts` | 只导出 Agent 所需的纯工具／解析函数；观测调用编译为无操作函数，不引入上传实现 |
| `apps/local-only/src/engine-providers.ts` | 移除运行产物中的通用 provider 工厂；尝试使用该工厂直接失败；不进行后台 provider 重试 |
| `apps/local-only/src/policy.ts` | 校验唯一模型地址、协议、私有字面 IP、固定路径、模型 ID、凭证格式和输出 token 上限 |
| `apps/local-only/src/model.ts` | 实现受限 Chat Completions HTTP(S) 通道、手动私有端点模型列表、模型参数、消息转换、SSE 解析、工具调用完整性检查、大小与超时限制 |
| `apps/local-only/src/workspace.ts` | 实现项目路径检查、读取／列表、链接与敏感路径排除、修改提案和批准后的冲突检查写入 |
| `apps/local-only/src/sandbox.ts` | 生成允许文件的临时只读快照，使用 bubblewrap 执行禁网命令，清理环境并处理超时／取消 |
| `apps/local-only/src/tools.ts` | 注册 `list_files`、`read_file`、`search_files`、`write_file`，可选 `run_command`；返回结构化工具错误 |
| `apps/local-only/src/storage.ts` | 处理独立模型配置、本地权限检查、按项目分区的会话与写入检查点 |
| `apps/local-only/src/session.ts` | 连接真实 Cline Agent、受限模型、本地工具、审批、本地持久化、取消与撤销 |
| `apps/local-only/src/server.ts` | 为 CLion 提供本机 stdio JSONL 协议；无监听端口或共享 daemon；处理任务、恢复、审批和退出 |
| `apps/local-only/vscode/package.json` | 独立扩展 ID `local-cline.cline-local-only`，声明本地命令与可信工作区要求 |
| `apps/local-only/vscode/extension.ts` | 中文侧边栏 Webview、流式对话、模型设置表单、选择代码、本地历史、原生 diff 审阅与撤销 |
| `apps/local-only/jetbrains/resources/META-INF/plugin.xml` | 独立插件 ID `local.cline.agent`，注册工具窗口，声明 243 平台起始版本 |
| `apps/local-only/jetbrains/src/local/cline/LocalToolWindowFactory.java` | 新建 Swing 宿主；管理随包核心进程、JSONL、模型配置、前后内容审阅、历史与关闭清理 |
| `apps/local-only/scripts/build.mjs` | 编译核心与 VS Code；对所有实际打包模块执行允许清单检查；可编译并运行测试 |
| `apps/local-only/scripts/check-types.mjs` | 对本发行版及实际引用的上游 Agent 源码执行严格 TypeScript 类型检查 |
| `apps/local-only/scripts/package.mjs` | 先检查类型和构建，再生成 VSIX、Java JAR、独立核心、CLion ZIP、许可和校验文件；打包不下载依赖 |
| `apps/local-only/tests/offline.test.ts` | 网络边界、文件边界、真实 agent 循环、审批／取消、持久化、沙箱和 stdio 集成测试 |
| `apps/local-only/README.md` | 安装、配置、构建、功能、限制与部署边界说明 |
| `apps/local-only/IMPLEMENTATION.zh-CN.md` | 本实施记录，包括完整文件清单和验证结果 |

没有修改 SDK 原始实现、原版 VS Code 运行入口或 `.gitignore`，没有创建 changeset、发布 tag 或 PR。源码保存在 `dev` 分支。

## 3. 模型网络通道

用户选定的本机／内网模型是代码上下文唯一允许的网络接收端。配置为空时任务失败，不使用默认公网地址。模型 API 仍属于数据传输：跨设备部署时，代码上下文会离开笔记本。

实际实现如下：

- 配置入口是独立用户配置文件，不读取仓库 provider 配置、原版凭证、组织配置、云模型环境变量。
- 允许 HTTP(S) 和规范字面 IP：`127.0.0.1`、`::1`、RFC1918 IPv4 私有范围，以及 IPv6 ULA。拒绝域名、其他回环地址、链路本地、未指定、公网和 IPv4 映射 IPv6。
- 基础路径限定为 `/v1`；任务请求固定为 `POST /v1/chat/completions`，手动模型列表请求固定为 `GET /v1/models`。没有通用代理、URL 抓取或文件上传接口。
- 使用独立的原生 HTTP(S) agent，不继承 HTTP(S)/ALL_PROXY 或全局 agent；字面 IP 不触发域名解析。
- 不跟随重定向；HTTPS 明确开启证书校验；没有关闭证书验证选项。
- 请求最多 2 MiB、响应最多 8 MiB；空闲超时 120 秒、单次请求总超时 5 分钟。
- 模型必须正确终止 SSE。工具参数在完整流结束后严格解析，截断流不会暴露可执行工具调用。
- 无云端回退、遥测、错误上传、远程配置、更新、市场或模型下载。没有专用任务标题或摘要的额外远程模型。

这些限制约束此发行版的应用请求，不改变 VPN 路由，也不能约束模型服务器收到数据后的外传或其他 IDE 扩展的行为。

## 4. 文件、审批与本地数据

文件工具限制在选定项目内，拒绝绝对路径、父目录引用、隐藏路径、常见密钥后缀、生成目录、符号链接、硬链接和特殊文件。读取仅支持最多 256 KiB 的 UTF-8 文本。递归列表有深度、访问数量和结果数量限制；搜索最多返回 100 行。

写入流程是“提案 → 用户审阅 → 写入前检查点 → 再次检查文件是否变化 → 写入”。拒绝或取消后不执行写入，外部修改导致冲突时要求重新提案。VS Code 使用原生 diff；CLion 使用不可编辑的前后文本并排审阅。没有自动批准全部修改的设置。

数据路径：

- `~/.config/cline-local/config.json`：模型地址、模型 ID、可选凭证、输出上限、命令开关。目录 `0700`，文件 `0600`。
- `~/.local/share/cline-local/<项目路径哈希>/`：完整本地会话与写入前检查点。会话文件可能包含源码，不上传。
- 每次命令的临时快照在执行结束后清理。

恢复列表显示最近 50 个会话；单个会话存储上限 16 MiB。恢复只加载本地历史，不加载历史 provider、上传任务或远程配置。撤销需要再次审阅，撤销新文件时留下空文件。

## 5. Fedora / Linux 命令隔离

命令默认关闭。用户准备好 `/usr/bin/bwrap` 后可设置 `commands: true`，每条命令仍需批准。

使用 `--unshare-all`、`--cap-drop ALL`、`--clearenv`、`--die-with-parent` 和独立会话；仅挂载只读系统工具、只读项目文本快照、临时目录、最小设备和隔离进程视图。

项目原目录不直接挂入沙箱，避免路径形式的 Unix socket、隐藏凭证和链接进入工具环境。命令只能看到快照，不能直接修改宿主项目；构建输出写到 `/tmp`。无网络命名空间支持、依赖缺失或 bubblewrap 不可用时拒绝执行，不回退到普通终端。工具限制 60 秒和 64 KiB 输出，取消时终止进程组。

这是有意限制的构建环境：隐藏配置、生成物、二进制资源和跨工具调用的构建缓存不保留。需要这些内容的项目无法直接照搬普通终端命令。插件未实现全系统 DLP，不控制用户另行启动的程序或 IDE 自动任务。

## 6. 构建与依赖改动

仓库仍使用 Bun 1.4.2 和 Node >=22。新增命令：

```sh
bun run typecheck:local
bun run test:local
bun run build:local
bun run package:local
```

TypeScript 工具依赖固定为：esbuild 0.25.0、TypeScript 5.9.3、Node 类型 22.15.1、VS Code 类型 1.101.0、Zod 4.3.6、nanoid 5.1.7、jsonrepair 3.13.1。Java 编译接口和版本列于 README。

本次实际构建时，环境最初缺少 Bun 和依赖；经权限批准，将 Bun 及少量公开编译依赖下载到 `/tmp/pline-bun-toolchain/` 和 `/tmp/pline-offline-tools/`。构建准备访问过公开依赖站点，没有把项目代码发送给公网模型。运行包不包含这些下载步骤。上述 `/tmp` 是本次环境缓存，清理后需按 README 重新准备。

esbuild 使用明确别名直接编译上游 Agent 源码，并将通用 provider／共享模块入口替换为受限构建接口。构建产物允许清单只接受这一 Agent 文件、少量共享纯函数、本发行版源码，以及 Zod、nanoid、jsonrepair。新引入未允许的 SDK 或第三方模块会导致构建失败。

CLion 包包含编译好的 Java 宿主、Gson、独立核心、核心 JavaScript 以及许可文件；用户无需另装 Node／Bun。独立核心禁用 dotenv、bunfig、tsconfig、package.json 自动加载，不会读取项目中的这些配置来改变行为。

## 7. 已执行验证

测试环境实际报告为 Ubuntu 26.04、x86_64；不是用户的 Fedora 笔记本。测试只使用临时合成项目与本机回环测试服务。

| 检查 | 结果 |
| --- | --- |
| 严格 TypeScript 类型检查 | 通过，包含本发行版和引用的真实 Cline Agent 源文件 |
| esbuild 模块允许清单检查 | 核心与 VS Code 均通过 |
| JetBrains 宿主编译 | 使用官方 243.21565.193 接口与 Eclipse 编译器通过 |
| 地址拒绝测试 | 公网、DNS、元数据、特殊地址、混淆表示、越界路径等被拒绝 |
| 文件边界测试 | 路径越界、符号链接、硬链接、隐藏密钥和大文件被拒绝 |
| 审批／冲突测试 | 拒绝不写入；审阅期间变动被检测 |
| HTTP 边界测试 | 不跟随 307；代理环境变量不改变指定端点 |
| SSE 完整性测试 | 未正常完成的工具调用流不执行工具 |
| 真实 Agent 循环测试 | 读文件、审批、写文件、回复、历史恢复、撤销通过 |
| 沙箱失败处理与实际运行 | 受限测试环境中拒绝执行；获准测试环境中实际隔离执行通过 |
| 禁网与环境隔离测试 | 沙箱不能连接宿主回环服务，无法继承用户测试环境变量 |
| 取消后的迟到批准 | 不写入文件，任务状态为已取消 |
| stdio 生命周期 | 启动、任务、流式回复、完成与 EOF 退出通过 |
| 模型设置表单持久化 | 私有文件权限、保留与清除 API Key、拒绝公网端点、Webview 不回读密钥通过 |
| 模型参数与发现 | Context Window、Temperature、Reasoning Effort 生效；仅向私有端点请求模型列表，均通过 |
| 独立核心 | 同一测试改用 CLion 包内的已编译可执行文件，再次通过 |
| 测试总数 | 0.1.2 的 Node 测试 14 项通过，0 失败；初版独立核心的 11 项验证通过 |
| VSIX 结构与安装 | 活动栏图标、Webview 视图声明和资源都在 VSIX 中；VS Code CLI 在独立测试目录安装 0.1.2 成功 |
| 侧边栏激活检查 | 使用 VS Code API mock 激活打包的扩展，确认视图提供者注册、Webview 解析和设置表单生成 |
| CLion ZIP 结构 | 包含插件 JAR、插件描述文件、Gson、可执行核心、源码 bundle 和许可 |

VS Code 安装测试使用 `/tmp/pline-local-vscode-user/` 与 `/tmp/pline-local-vscode-extensions/`，未替换用户常用 IDE 配置。CLI 安装和 mock 激活不等于完整界面端到端验证。

尚未验证：用户 Fedora 笔记本的 namespace／企业策略、实际内网模型的协议与工具调用表现、CLion 窗口内的完整交互、全部声明版本的 IDE 兼容性、严格部署的全系统网络观测。未获得这些证据前，不能承诺绝对无外传或公司不可见。

## 8. 安装步骤

在保存此仓库的机器上，安装包绝对路径为：

```text
/home/thomas/MyProjects/pline/apps/local-only/dist/release/cline-local-0.1.2.vsix
/home/thomas/MyProjects/pline/apps/local-only/dist/release/cline-local-clion-0.1.2-linux-x64.zip
```

把对应安装包复制到要安装的机器即可，无需复制整个源码仓库。

VS Code 可使用命令：

```sh
code --install-extension /实际存放路径/cline-local-0.1.2.vsix --force
```

或扩展面板 `… → Install from VSIX…`。安装后执行 `Developer: Reload Window`，打开本地项目，点击左侧活动栏的 `Cline Local` 图标，进入 `本地 Agent` 视图；也可在命令面板执行 `Cline Local: 打开本地 Agent`。点击“模型设置”即可在侧边栏填写并保存模型地址、模型 ID、上下文窗口、输出 token、Temperature、Reasoning Effort 与可选 API Key。保存后可手动读取内网模型列表。若活动栏图标被隐藏，可在活动栏右键菜单勾选 `Cline Local`。

CLion 使用 `Settings → Plugins → 齿轮 → Install Plugin from Disk…`，选择 ZIP，不要预先解压；按 IDE 提示重启，打开 `Cline Local` 工具窗口和“模型设置”。本次 ZIP 仅支持 Linux x86_64。

填写模型电脑的内网 IP 和真实模型 ID；示例值见 README。先保持 `commands: false` 验证对话与文件审阅。安装后在 IDE 中关闭此插件的自动更新；IDE 自身的更新策略由用户／管理员控制。插件没有登录、在线激活、自动下载或在线更新步骤。

## 9. Git 中查看与提交

源码位于工作目录 `/home/thomas/MyProjects/pline` 的 `dev` 分支。初版提交为 `33544fafb`；侧边栏与模型设置修复提交为 `047b273cb`；0.1.2 扩展了本地模型参数。查看：

```sh
cd /home/thomas/MyProjects/pline
git branch --show-current
git log -2 --oneline
git status --short
```

`dist/` 安装包仍按仓库忽略规则排除，不在 Git 提交中；可用本地包路径安装，或复制到目标机器。`main` 不包含这些修改。
