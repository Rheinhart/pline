# Cline Local 改造实施记录

记录日期：2026-10-21。发行版版本：`0.1.0`。

本记录描述此次实际写入仓库的改动，与最初的[需求方案](../../LOCAL_ONLY_FORK_PLAN.zh-CN.md)区分。安装和日常使用见[README](README.md)。

## 1. 交付结果

新增 `apps/local-only/` 工作区，提供共用的本地 agent 核心、VS Code 扩展和 CLion 宿主插件。核心使用当前仓库真正的 Cline Agent 执行循环，不是只展示固定回复的演示程序。

离线版采用独立入口与构建范围。原有 `apps/vscode/`、CLI、桌面端及云功能源码保留在仓库中；它们没有进入本次离线发行包。原版构建命令仍生成原版，只有 `package:local` 生成这里描述的发行版。

两个 IDE 的界面是本次新增的精简界面，不包含原版 Cline 的全部界面和功能。当前实现支持对话、文件读取／搜索、审批后修改、本地历史与检查点、撤销，以及可选 Linux 禁网命令。

生成的文件位于 `apps/local-only/dist/release/`：

| 文件 | 用途 |
| --- | --- |
| `cline-local-0.1.0.vsix` | VS Code 本地安装包，约 117 KiB |
| `cline-local-clion-0.1.0-linux-x64.zip` | CLion Linux x86_64 本地安装包，约 36 MiB，含独立核心运行时 |
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
| `apps/local-only/src/model.ts` | 实现受限 Chat Completions HTTP(S) 通道、消息转换、SSE 解析、工具调用完整性检查、大小与超时限制 |
| `apps/local-only/src/workspace.ts` | 实现项目路径检查、读取／列表、链接与敏感路径排除、修改提案和批准后的冲突检查写入 |
| `apps/local-only/src/sandbox.ts` | 生成允许文件的临时只读快照，使用 bubblewrap 执行禁网命令，清理环境并处理超时／取消 |
| `apps/local-only/src/tools.ts` | 注册 `list_files`、`read_file`、`search_files`、`write_file`，可选 `run_command`；返回结构化工具错误 |
| `apps/local-only/src/storage.ts` | 处理独立模型配置、本地权限检查、按项目分区的会话与写入检查点 |
| `apps/local-only/src/session.ts` | 连接真实 Cline Agent、受限模型、本地工具、审批、本地持久化、取消与撤销 |
| `apps/local-only/src/server.ts` | 为 CLion 提供本机 stdio JSONL 协议；无监听端口或共享 daemon；处理任务、恢复、审批和退出 |
| `apps/local-only/vscode/package.json` | 独立扩展 ID `local-cline.cline-local-only`，声明本地命令与可信工作区要求 |
| `apps/local-only/vscode/extension.ts` | 新增中文 Webview、流式对话、模型配置入口、选择代码、本地历史、原生 diff 审阅与撤销 |
| `apps/local-only/jetbrains/resources/META-INF/plugin.xml` | 独立插件 ID `local.cline.agent`，注册工具窗口，声明 243 平台起始版本 |
| `apps/local-only/jetbrains/src/local/cline/LocalToolWindowFactory.java` | 新建 Swing 宿主；管理随包核心进程、JSONL、模型配置、前后内容审阅、历史与关闭清理 |
| `apps/local-only/scripts/build.mjs` | 编译核心与 VS Code；对所有实际打包模块执行允许清单检查；可编译并运行测试 |
| `apps/local-only/scripts/check-types.mjs` | 对本发行版及实际引用的上游 Agent 源码执行严格 TypeScript 类型检查 |
| `apps/local-only/scripts/package.mjs` | 先检查类型和构建，再生成 VSIX、Java JAR、独立核心、CLion ZIP、许可和校验文件；打包不下载依赖 |
| `apps/local-only/tests/offline.test.ts` | 网络边界、文件边界、真实 agent 循环、审批／取消、持久化、沙箱和 stdio 集成测试 |
| `apps/local-only/README.md` | 安装、配置、构建、功能、限制与部署边界说明 |
| `apps/local-only/IMPLEMENTATION.zh-CN.md` | 本实施记录，包括完整文件清单和验证结果 |

没有修改 SDK 原始实现、原版 VS Code 运行入口或 `.gitignore`，没有创建 changeset、发布 tag、PR 或 Git 提交。

## 3. 模型网络通道

用户选定的本机／内网模型是代码上下文唯一允许的网络接收端。配置为空时任务失败，不使用默认公网地址。模型 API 仍属于数据传输：跨设备部署时，代码上下文会离开笔记本。

实际实现如下：

- 配置入口是独立用户配置文件，不读取仓库 provider 配置、原版凭证、组织配置、云模型环境变量。
- 允许 HTTP(S) 和规范字面 IP：`127.0.0.1`、`::1`、RFC1918 IPv4 私有范围，以及 IPv6 ULA。拒绝域名、其他回环地址、链路本地、未指定、公网和 IPv4 映射 IPv6。
- 基础路径限定为 `/v1`；实际请求固定为 `POST /v1/chat/completions`。没有通用代理、URL 抓取或文件上传接口。
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
| 独立核心 | 同一测试改用 CLion 包内的已编译可执行文件，再次通过 |
| 测试总数 | 11 项通过，0 失败；Node 核心和独立核心验证均通过 |
| VSIX 结构与安装 | XML／JSON 可解析；VS Code 1.142.0 CLI 在独立测试目录安装成功 |
| CLion ZIP 结构 | 包含插件 JAR、插件描述文件、Gson、可执行核心、源码 bundle 和许可 |

VS Code 安装测试使用 `/tmp/pline-local-vscode-user/` 与 `/tmp/pline-local-vscode-extensions/`，未替换用户常用 IDE 配置。测试目录中禁用了 IDE 遥测、更新和扩展自动更新。CLI 的成功安装不等于完整界面端到端验证。

尚未验证：用户 Fedora 笔记本的 namespace／企业策略、实际内网模型的协议与工具调用表现、CLion 窗口内的完整交互、全部声明版本的 IDE 兼容性、严格部署的全系统网络观测。未获得这些证据前，不能承诺绝对无外传或公司不可见。

## 8. 安装步骤

在保存此仓库的机器上，安装包绝对路径为：

```text
/home/thomas/MyProjects/pline/apps/local-only/dist/release/cline-local-0.1.0.vsix
/home/thomas/MyProjects/pline/apps/local-only/dist/release/cline-local-clion-0.1.0-linux-x64.zip
```

把对应安装包复制到要安装的机器即可，无需复制整个源码仓库。

VS Code 可使用命令：

```sh
code --install-extension /实际存放路径/cline-local-0.1.0.vsix
```

或扩展面板 `… → Install from VSIX…`。安装后打开本地项目，在命令面板执行 `Cline Local: 打开本地 Agent`，点击“模型设置”。

CLion 使用 `Settings → Plugins → 齿轮 → Install Plugin from Disk…`，选择 ZIP，不要预先解压；按 IDE 提示重启，打开 `Cline Local` 工具窗口和“模型设置”。本次 ZIP 仅支持 Linux x86_64。

填写模型电脑的内网 IP 和真实模型 ID；示例值见 README。先保持 `commands: false` 验证对话与文件审阅。安装后在 IDE 中关闭此插件的自动更新；IDE 自身的更新策略由用户／管理员控制。插件没有登录、在线激活、自动下载或在线更新步骤。

## 9. Git 中查看与提交

此次修改直接写在工作目录 `/home/thomas/MyProjects/pline` 的 `main` 分支，没有自动暂存、提交或推送。提交前可查看：

```sh
cd /home/thomas/MyProjects/pline
git status --short
git diff --stat
git ls-files --others --exclude-standard apps/local-only
```

`git diff` 只显示已跟踪文件的差异；新目录显示为 `?? apps/local-only/`，未暂存的新文件不会包含在普通 `git diff` 中。`git commit` 只提交暂存区，`git commit -a` 也不会包含新文件。需要提交时：

```sh
git add README.md package.json bun.lock LOCAL_ONLY_FORK_PLAN.zh-CN.md apps/local-only
git diff --cached --stat
git commit -m "feat: add local-only Cline distribution for VS Code and CLion"
```

上述命令会暂存源码和文档，现有忽略规则仍排除 `dist/` 安装包。不需要把大二进制强制加入 Git；安装包可单独本地复制或通过获准的制品渠道保存。本次没有执行这些 Git 写入命令。
