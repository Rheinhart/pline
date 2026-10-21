# Cline Local：本机／内网模型专用发行版

完整文件改动、验证结果、Git 提交说明见[中文实施记录](IMPLEMENTATION.zh-CN.md)。

这是基于当前 Cline 仓库的独立离线发行版，复用 `sdk/packages/agents/src/agent-runtime.ts` 的实际 agent 循环。VS Code 扩展与 CLion 插件共用受限核心；原版账号、云 provider、遥测、对象存储上传、远程配置、市场、MCP、浏览器、可执行 hooks、更新代码不进入发布包。构建通过模块允许清单检查，防止上游导入变化把这些模块重新带入。

当前安装包：VS Code 1.101+；CLion 2024.3+ 的 Linux x86_64 插件（以 243 平台接口编译）。命令隔离针对 Linux / Fedora，其他系统的命令工具拒绝执行。没有隐蔽运行、关闭公司安全软件或绕过 VPN 的功能。

## 安装与配置

1. 从 `dist/release/` 取出 `.vsix` 或 `cline-local-clion-…-linux-x64.zip`，用随包 `SHA256SUMS` 校验。
2. VS Code 使用本地 VSIX 安装，打开一个本地项目，点击活动栏的 **Cline Local** 图标；也可执行 **Cline Local: 打开本地 Agent**。如果从旧版升级后看不到图标，执行 **Developer: Reload Window**，并检查活动栏图标是否被隐藏。CLion 使用 **Settings → Plugins → Install Plugin from Disk** 安装 ZIP，打开 **Cline Local** 工具窗口。
3. 在侧边栏点击“模型设置”，填写地址、模型 ID、上下文窗口、最大输出 token、Temperature、Reasoning Effort 和可选 API Key；保存后新任务生效。VS Code 可以手动从**已保存的私有端点**读取 `/v1/models` 列表，也可以输入自定义 ID。配置保存在 `~/.config/cline-local/config.json`，目录权限 `0700`，文件权限 `0600`。Webview 不会读回已保存的 API Key 明文。不读取项目配置、原版 Cline 凭证、系统代理或云模型环境变量。
4. 设置一个模型端点和模型 ID，开始新任务。没有在线模型发现、模型下载或公网回退；使用模型服务已提供的准确模型 ID。

```json
{
  "baseUrl": "http://192.168.1.50:8000/v1",
  "model": "your-local-model-id",
  "apiKey": "",
  "contextWindow": 131072,
  "maxTokens": 4096,
  "temperature": 0.25,
  "reasoningEffort": "none",
  "commands": false
}
```

示例地址必须替换。支持 OpenAI 兼容 Chat Completions、SSE 和函数工具调用；本机端点用 `127.0.0.1` 或 `[::1]`。内网使用规范的私有字面 IP，拒绝域名、公网、链路本地、云元数据地址、URL 凭证、任意路径和重定向。任务只请求该端点的 `/v1/chat/completions`；手动列出模型只请求 `/v1/models`。HTTPS 强制证书校验，未提供关闭校验选项。

模型列表按钮只在用户点击时请求同一私有地址的 `/v1/models`，不自动扫描网络。Temperature 留空则不发送该参数；Reasoning Effort 设为 `none` 时不发送 `reasoning_effort`。上下文窗口使用 UTF-8 字节数做保守限制，因为离线包没有每种本地模型的 tokenizer。原版设置中的图片能力、价格和云端专属参数未接入当前纯文本本地核心，不能通过这些选项启用相应功能。

**发送任务意味着相关提示词、代码和工具输出会发给这个端点。** 内网模型仍属于另一台设备，不能称为“代码不离开本机”；需要完全不离开本机时只配置本机模型。模型服务器本身的外连与日志应由部署方限制。插件不会更改 VPN、路由、防火墙或公司管理策略，也不能保证连接对设备管理软件不可见。

## 可用功能

- 多轮对话、流式回复、读取／搜索项目、提出文件修改。
- 每次写入都经过审阅；VS Code 使用原生 diff，CLion 使用前后内容并排审阅。拒绝或取消不会写入。
- 历史和写入前检查点只保存在 `~/.local/share/cline-local/`。支持恢复最近 50 个会话和撤销最近一次修改；撤销新建文件会保留空文件。
- 不跟随文件链接，不读取隐藏文件、常见密钥后缀、生成目录和超过 256 KiB 的文件；单次请求最多 2 MiB、响应最多 8 MiB、任务最多 30 轮。不提供图片／网页附件。
- 文件工具要求目标父目录已经存在。当前版本不自动创建目录，不删除文件；需要新目录时由用户在 IDE 中创建。

隐藏路径排除不是完整的敏感信息识别系统：普通源码中的凭证仍可能进入模型上下文。只打开希望模型处理的项目，不把整个用户目录作为项目。

## Fedora 命令执行

默认 `commands: false`。需要构建测试时，先通过获准的本地系统包安装 `bubblewrap`，再将其设为 `true` 并新建任务。插件不会下载安装 bubblewrap，也不会回退到普通终端。

每条命令需要单独批准。核心把允许读取的文本文件复制到临时项目快照，再调用 `/usr/bin/bwrap`：

- 独立网络、PID、IPC、用户等命名空间，丢弃 capabilities，清空继承环境。
- `/workspace` 是只读快照；没有宿主 `/home`、`/run`、`/etc`、工作区 socket、隐藏文件或凭证。
- 仅挂载只读系统工具／动态库，提供临时 `/tmp`、最小 `/dev` 和独立 `/proc`。
- 运行最多 60 秒、输出最多 64 KiB；取消、退出和超限会终止进程组。
- namespace 不可用、bubblewrap 缺失或依赖不存在时，明确失败，不降低隔离条件。

例如：`cmake -S /workspace -B /tmp/build && cmake --build /tmp/build`。每次工具调用都是新快照，临时构建输出不跨调用保留；可在一次命令中完成构建与测试。二进制资源、生成目录和隐藏配置不进入快照，因此依赖这些内容的项目需要适配构建方式。本版不宣称与普通终端行为完全相同。

此隔离覆盖插件启动的工具。IDE 的其他扩展、外部文件监视器、用户手动运行的程序和模型服务器自身不在插件控制范围；严格部署需同时管理这些外部边界。

## 从源码构建

使用 Bun 1.4.2、Node >=22。构建脚本不自动下载；依赖须事先准备好，可以使用离线缓存。

在已安装依赖的 monorepo 中：

```sh
bun -F @cline/local-only typecheck
bun -F @cline/local-only test
bun -F @cline/local-only build
```

也可只准备本发行版的依赖，避免安装整个 monorepo：把本目录 `package.json` 中的 `devDependencies` 放入仓库外的独立工具目录，使用 Bun 安装并保留生成的锁文件，然后设置 `LOCAL_ONLY_TOOLS=/绝对路径/工具目录`。此路径仅影响构建，不进入运行配置。

本发行版通过明确的 esbuild 别名直接编译上游 Agent 源文件与少量纯函数，未修改 SDK 源码，不依赖 SDK `dist/`。常规 CLI／原版扩展仍遵循仓库的 `build:sdk` 要求。

CLion 打包还需离线准备以下文件并设置 `LOCAL_ONLY_JAVA_DEPS`：

| 文件 | 来源版本 |
| --- | --- |
| `core.jar`、`ide.jar`、`ide-core.jar`、`util.jar`、`extensions.jar`、`util-progress.jar` | JetBrains 官方 Maven 仓库，`com.jetbrains.intellij.platform`，`243.21565.193` |
| `annotations.jar` | `org.jetbrains:annotations:24.0.0` |
| `ecj.jar` | `org.eclipse.jdt:ecj:3.43.0`，编译器，不打入插件 |
| `gson.jar`、`gson-LICENSE.txt` | `com.google.code.gson:gson:2.11.0` 及其许可 |
| `bun-LICENSE.md` | Bun 1.4.2 的许可及第三方许可清单 |

```sh
LOCAL_ONLY_TOOLS=/path/to/tools \
LOCAL_ONLY_JAVA_DEPS=/path/to/java-deps \
LOCAL_ONLY_BUN=/path/to/bun \
bun -F @cline/local-only package
```

打包还需要系统 `java` 和 `zip`。CLion 核心编译为内置 Bun 的本机可执行文件，禁用 `.env`、`bunfig.toml`、`tsconfig.json` 和 `package.json` 自动加载；用户机器不需要 Node 或 Bun。当前打包需在 Linux x86_64 上运行。VS Code 使用宿主内置运行时。

发布包使用独立插件身份，未配置更新源。安装后在 IDE 中关闭此插件的自动更新；更新行为还受 IDE 自身设置影响，没有注册在线插件发布服务。原版 Cline 仍保留在源码树用于参考，**不要用原版的打包命令生成这个离线版本**。

## 验证

`test` 使用临时合成项目和回环测试服务验证网络边界与实际 Cline 工具循环，不发送真实项目源码。运行测试需要允许监听回环地址；完整沙箱验证需要 Linux user namespace。类型检查覆盖本发行版和实际引用的上游 Agent；Java 编译使用真正的 JetBrains 接口。

模块审计清单位于 `dist/release/core-inputs.json` 与 `vscode-inputs.json`。静态审计、集成测试和本地安装检查不等于所有 IDE 版本、Fedora 配置或实际模型服务都已验证；使用前按目标机器和模型进行验收。
