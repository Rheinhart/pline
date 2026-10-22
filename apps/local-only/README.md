# Cline Local：本机／内网模型专用发行版

完整文件改动、验证结果、Git 提交说明见[中文实施记录](IMPLEMENTATION.zh-CN.md)。

这是基于当前 Cline 仓库的独立离线发行版，复用 `sdk/packages/agents/src/agent-runtime.ts` 的实际 agent 循环。VS Code 扩展与 CLion 插件共用受限核心；原版账号、云 provider、遥测、对象存储上传、远程配置、市场、MCP、浏览器、可执行 hooks、更新代码不进入发布包。构建通过模块允许清单检查，防止上游导入变化把这些模块重新带入。

当前安装包：VS Code 1.101+；CLion 2024.3+ 的 Linux x86_64 插件（以 243 平台接口编译）。命令隔离针对 Linux / Fedora，其他系统的命令工具拒绝执行。没有隐蔽运行、关闭公司安全软件或绕过 VPN 的功能。

## 安装与配置

1. 从 `dist/release/` 取出 `.vsix` 或 `cline-local-clion-…-linux-x64.zip`，用随包 `SHA256SUMS` 校验。
2. VS Code 使用本地 VSIX 安装，打开一个本地项目，点击活动栏的 **Cline Local** 图标；也可执行 **Cline Local: 打开本地 Agent**。如果从旧版升级后看不到图标，执行 **Developer: Reload Window**，并检查活动栏图标是否被隐藏。CLion 使用 **Settings → Plugins → Install Plugin from Disk** 安装 ZIP，打开 **Cline Local** 工具窗口。
3. 在侧边栏点击“模型设置”，填写地址、模型 ID、上下文窗口、最大输出 token，以及可选的 Temperature、Top P、频率惩罚、存在惩罚、随机种子、Reasoning Effort 和 API Key；保存后新任务生效。VS Code 可以手动从**已保存的私有端点**读取 `/v1/models` 列表，也可以输入自定义 ID。配置保存在 `~/.config/cline-local/config.json`，目录权限 `0700`，文件权限 `0600`。Webview 不会读回已保存的 API Key 明文。不读取项目配置、原版 Cline 凭证、系统代理或云模型环境变量。
4. 设置一个模型端点和模型 ID，开始新任务。没有在线模型发现、模型下载或公网回退；使用模型服务已提供的准确模型 ID。

```json
{
  "baseUrl": "http://192.168.1.50:8000/v1",
  "model": "your-local-model-id",
  "apiKey": "",
  "contextWindow": 131072,
  "maxTokens": 4096,
  "temperature": 0.25,
  "topP": 0.9,
  "frequencyPenalty": 0,
  "presencePenalty": 0,
  "seed": 42,
  "reasoningEffort": "none",
  "commands": false
}
```

示例地址必须替换。支持 OpenAI 兼容 Chat Completions、SSE 和函数工具调用；本机端点用 `127.0.0.1` 或 `[::1]`。内网使用规范的私有字面 IP，拒绝域名、公网、链路本地、云元数据地址、URL 凭证、任意路径和重定向。任务只请求该端点的 `/v1/chat/completions`；手动列出模型只请求 `/v1/models`。HTTPS 强制证书校验，未提供关闭校验选项。

模型列表按钮只在用户点击时请求同一私有地址的 `/v1/models`，不自动扫描网络。Temperature、Top P、频率惩罚、存在惩罚和随机种子留空则不发送对应参数；Reasoning Effort 设为 `none` 时不发送 `reasoning_effort`。这些可选参数需要本地服务支持，服务不支持时应留空。上下文窗口使用 UTF-8 字节数做保守限制，因为离线包没有每种本地模型的 tokenizer。原版设置中的图片能力、价格和云端专属参数未接入当前纯文本本地核心，不能通过这些选项启用相应功能。

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

## 离线 VSIX 的已知问题

适用于 `local-cline.claude-dev`（离线版原版扩展，见 `IMPLEMENTATION.zh-CN.md` 第 0 节）。

首次打开侧栏可能出现：

```
Error loading webview provided by 'local-cline.claude-dev':
Error: Could not register service worker: InvalidStateError: … The document is in an invalid state.
```

这是 VS Code 配置目录里残留的 Webview service worker 缓存，**不是**离线层的问题（能报出插件 ID 说明扩展已激活、视图已注册）。完全退出所有窗口后删除该目录再启动即可：

```bash
rm -rf ~/.config/Code/Service\ Worker     # 分支版路径不同，例如 ~/.config/Cursor
```

## 机器级禁网开关

扩展只能保证 Cline 自己不出公网。**编辑器本体**（市场、更新检查、内置扩展遥测）和**模型机自身的出网**在扩展管不到的地方，需要机器级开关：

```bash
sudo apps/local-only/scripts/lan-only.sh off     # 断公网，局域网与路由器 DNS 照常
apps/local-only/scripts/lan-only.sh status
sudo apps/local-only/scripts/lan-only.sh on
```

它给默认路由加一条 `blackhole`（IPv4 与 IPv6），非本地网段立即返回 `Network unreachable`；不持有状态，也不与 ufw/docker/nftables 规则冲突，删掉这条路由即恢复。局限：不区分程序与端口，只作用于主路由表。模型机上更精细的做法是只约束模型服务本身（systemd drop-in：`IPAddressAllow=127.0.0.0/8 192.168.0.0/24 ::1 fe80::/10` 加 `IPAddressDeny=any`），这样其余开发工具照常联网。

## 模型机定向防火墙（strata-nvfp）

模型服务与开发工具跑在同一台机器、同一个用户下，所以不能用 `iptables -m owner --uid-owner`（那会连带屏蔽人的终端）。改用 systemd 的单元级过滤，只影响这一个服务：

```bash
sudo install -D -m 644 apps/local-only/systemd/model-host-lan-only.conf \
  /etc/systemd/system/strata-nvfp4.service.d/lan-only.conf
sudo systemctl daemon-reload && sudo systemctl restart strata-nvfp4
```

**必须验证**，因为过滤可能静默失效（这台机器上非特权用户单元就是如此，`IPAddressDeny=any` 下 curl 仍返回 200）：

```bash
systemctl show strata-nvfp4.service -p IPAddressAllow,IPAddressDeny
sudo systemd-run --wait --pipe -p IPAddressAllow=127.0.0.0/8 \
  -p IPAddressAllow=192.168.0.0/24 -p IPAddressDeny=any curl -m 4 -sS https://example.com
```

第二条应当失败（`Network unreachable` 或超时）。之后在客户端发一个任务确认模型仍可访问，即完成验收。

## 名称

发行版名为 **Pline**，扩展身份 `local.pline`，命令前缀 `pline.`。上游从自己的 `package.json` name 派生全部命令与视图 ID，所以重命名同时发生在编译期与发布包 `contributes`，由 `scripts/identity.mjs` 统一生成——两边不一致不会报错，只会静默丢掉右键菜单、快捷键和侧栏。旧身份 `local-cline.claude-dev` 需先卸载：

```bash
code --uninstall-extension local-cline.claude-dev
code --install-extension apps/local-only/dist/release/pline-0.1.2.vsix
```

网络配置文件路径不变：`~/.config/cline-local/network.json`。

## 让传输加密(推荐的接法)

非回环地址强制 https 是硬规则;若模型服务只有明文 http,又想要加密,**不必给服务端配证书**——用 SSH 隧道把它接到回环:

```bash
mkdir -p ~/.config/systemd/user ~/.config/cline-local
cp apps/local-only/systemd/model-tunnel.env ~/.config/cline-local/tunnel.env
$EDITOR ~/.config/cline-local/tunnel.env          # 改用户与地址
cp apps/local-only/systemd/model-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now model-tunnel
loginctl enable-linger "$USER"                     # 不加这条,退出登录后隧道会被停
```

设置里填 `http://127.0.0.1:8080/v1`,`network.json` 里**不要**开 `lanPlainHttp`。这样隧道断了会立刻报连接被拒绝,而不是悄悄退化成明文链路。

为什么这样对 VPN 也成立:回环那段永不出本机,跨机部分装在 SSH 里。全隧道 VPN 若抢走了默认路由,`192.168.x.x` 的请求可能先出家门再绕回来——`ip route get <模型地址>` 可以看出走的是物理网卡还是 `utun`/`tun`/`wg`。SSH 内容在这两种路由下都是加密的。

开着 `lanPlainHttp` 时,扩展会在 Output 面板打印一次提示(`[cline-local] Plaintext http to … is allowed by lanPlainHttp …`),因为**被允许的明文请求不会失败**,不提示就没人知道数据正在局域网上裸奔。启动日志也会把当前生效的策略开关一并列出。

## A 方案(SSH 隧道)在两台机器上分别要做什么

机器命名:**A = 模型机**(模型服务所在,当前 `192.168.0.33`),**B = 开发机**(装插件、跑 VS Code)。

| 机器 | 端口 | 谁在用 | 要求 |
| --- | --- | --- | --- |
| A | 22/tcp | sshd | 唯一需要对局域网开放的端口。防火墙 drop-in 放行的是 `192.168.0.0/24`,源地址在段内即通过 |
| A | 8080/tcp | 模型服务 | **不需要**对局域网开放。SSH 转发是在 A 本机连 `127.0.0.1:8080`,所以建议把服务直接绑到 `127.0.0.1`,明文端口就完全不出现在局域网上 |
| B | `127.0.0.1:8080/tcp` | ssh 的本地转发监听 | 只绑回环。与本机其它服务冲突时改 `TUNNEL_PORT`,并同步改设置里的 URL |
| B | — | 插件本身 | 只连 `127.0.0.1`,不产生任何跨机连接 |

连接方向只有三条:

1. **B → A:22** —— SSH,承载全部 prompt 与代码,加密;
2. A 上 sshd → `127.0.0.1:8080` —— 回环;
3. 插件 → B 的 `127.0.0.1:8080` —— 回环。

**A 上要做的**

1. sshd 监听 22(发行版默认如此);
2. 免密登录:把 B 的公钥写入 A 的 `~/.ssh/authorized_keys`。隧道单元是 `BatchMode=yes`,没有密钥会直接失败而不是卡在密码提示上;
3. 装上防火墙 drop-in(见上一节)。它放行整个 `/24`,所以 A 的地址从 `.33` 变成 `.40` 不影响它;
4. 可选加固:模型服务只监听 `127.0.0.1`。A 方案不需要从 B 直连 8080,这一步做完连"局域网上的明文端口"这个攻击面都没有了。

**B 上要做的**

1. 安装 VSIX(身份变更后的第一次要先 `--uninstall-extension local-cline.claude-dev`);
2. 安装并启用 `model-tunnel` 用户单元,`tunnel.env` 里填 `TUNNEL_TARGET=<用户>@<A 的地址或主机名>`;
3. 设置里 Base URL 填 `http://127.0.0.1:8080/v1`;
4. `~/.config/cline-local/network.json` 里**不要**开 `lanPlainHttp`。

**验收**

```bash
systemctl --user status model-tunnel              # 应为 active (running)
curl -sS http://127.0.0.1:8080/v1/models          # 在 B 上,应返回模型列表
```

然后在插件里发一个任务,并看 Output 面板:**不应出现任何 `[cline-local] Plaintext http to …` 提示**。出现了就说明仍有流量在打局域网 IP,即隧道没被用上;这条提示正是为此而打印的。
