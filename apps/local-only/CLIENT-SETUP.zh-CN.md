# 开发机（B）配置指南 · 手把手

**适用**：在自己的电脑上用 Pline 连一台局域网模型服务。全程约 10 分钟。

- **A** = 跑模型服务的机器（例：`192.168.0.33`，端口 `8080`）
- **B** = 你正在用的这台电脑（装 Pline、开 VS Code）

按顺序做，**每一步都有"预期输出"**。对不上就跳到最后一节《故障对照表》。

> 前提：VS Code **1.101 或更新**（`code --version` 看第一行）。B 与 A 能在局域网互通。

---

## 第 1 步 · 把安装包拿到 B 上

在 A 上（本仓库目录）：

```bash
cd ~/MyProjects/pline/apps/local-only/dist/release
scp offline/pline-0.2.0.vsix 你的用户名@B的地址:~/Downloads/
```

**预期**：传输完成，无报错。B 上应得到约 **12.7 MB** 的 `~/Downloads/pline-0.2.0.vsix`。

顺手校验一下没传坏（哈希在 A 的 `offline/SHA256SUMS-offline-vscode` 里）：

```bash
sha256sum ~/Downloads/pline-0.2.0.vsix      # 前 16 位应与 A 上记录的哈希一致
```

---

## 第 2 步 · 清掉旧身份（只做一次）

这个包以前叫 `local-cline.claude-dev`，先卸载，避免侧栏出现两个图标：

```bash
code --uninstall-extension local-cline.claude-dev
code --install-extension --force ~/Downloads/pline-0.2.0.vsix
```

**预期**：`Extension '…vsix' was successfully installed.`

不确定装没装好：

```bash
code --list-extensions --show-versions | grep pline
```

**预期**：`local.pline@0.2.0`

---

## 第 3 步 · 打开 Pline 面板

三种方式任选：

1. 左侧**活动栏**点 **Pline** 图标；
2. `Ctrl+Shift+P` → 输入 `Pline` → 选打开面板的命令；
3. 若刚装好看不到图标：`Ctrl+Shift+P` → **Developer: Reload Window**。

**预期**：右侧出现 Cline 样式的面板（欢迎页 / 输入框）。

**如果报 `Could not register service worker …`**：这是 VS Code 自己的缓存问题，不是插件坏了。**完全退出所有 VS Code 窗口**，再：

```bash
rm -rf ~/.config/Code/Service\ Worker      # 分支版换目录：~/.config/Cursor 等
```

重开 VS Code 即可。

---

## 第 4 步 · 填模型端点（原版设置界面）

1. 面板右上角 **齿轮（Settings）**；
2. **API Provider** 选 **OpenAI Compatible**（本机 Ollama 选 Ollama、LM Studio 选 LM Studio）；
3. 填这三项：

| 字段 | 填什么 | 例子 |
| --- | --- | --- |
| **Base URL** | 模型服务地址，**以 `/v1` 结尾** | `http://127.0.0.1:8080/v1`（走 SSH 隧道，推荐）<br>`http://192.168.0.33:8080/v1`（直连，需第 5 步的额外开关） |
| **Model ID** | 服务端真实的模型名，不猜 | 先在 B 上跑：`curl -s http://127.0.0.1:8080/v1/models` 抄 `id` 字段 |
| **API Key** | 服务端要求就填 | 你的服务需要 key，不填会返回 `authentication_error` |

4. 保存，关掉设置页。

**注意**：设置里仍会列出 Anthropic / OpenAI / Bedrock 等**云端 provider**（为了保持原版界面）。选它们会在任务开始时给一条本地错误——**这是设计如此**，这个发行版连不上公网。

---

## 第 5 步 · 选一种加密方式（重要）

规则：**非回环地址必须 https**。你的模型服务是明文 http，所以二选一。

### 方案 A（推荐）：SSH 隧道 —— 传输加密，服务端零改动

在 B 上：

```bash
# 1) 先手动试一次，确认能通（会占住这个终端，Ctrl+C 退出）
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 你的用户名@192.168.0.33

# 2) 通了就做成开机自启
mkdir -p ~/.config/systemd/user ~/.config/cline-local
cp <仓库>/apps/local-only/systemd/model-tunnel.env ~/.config/cline-local/tunnel.env
nano ~/.config/cline-local/tunnel.env        # 改 TUNNEL_TARGET=用户@A的地址
cp <仓库>/apps/local-only/systemd/model-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now model-tunnel
loginctl enable-linger "$USER"               # 不做这步，退出登录后隧道会停
```

设置里 Base URL 填 `http://127.0.0.1:8080/v1`，**并且不要开 `lanPlainHttp`**。

验收：

```bash
systemctl --user status model-tunnel --no-pager | head -3     # 应为 active (running)
curl -s http://127.0.0.1:8080/v1/models | head -c 120          # 应返回模型列表
```

为什么推荐它：回环那段明文永不出本机，跨机部分装在 SSH 里。**开了公司 VPN（全隧道）时，发往 `192.168.x.x` 的请求可能先出家门再绕回来**——这种情况下只有 SSH 里层仍然是加密的。

### 方案 B（省事）：直连 + 允许明文

```bash
mkdir -p ~/.config/cline-local
cat > ~/.config/cline-local/network.json <<'EOF'
{ "lanPlainHttp": true }
EOF
chmod 600 ~/.config/cline-local/network.json
```

**改完必须重载窗口**：`Ctrl+Shift+P` → **Developer: Reload Window**（配置只在启动时读一次）。

代价：prompt 与代码在局域网上是明文，同 Wi-Fi 的设备理论上能抓包。

---

## 第 6 步 · 跑第一个任务并看懂日志

在输入框发一句"读一下 README 的第一段并总结"。

**看日志**：底部 **Output** 面板，右侧下拉选本插件的输出通道。三行关键日志：

| 日志 | 含义 |
| --- | --- |
| `[cline-local] Internet access is disabled … (lanPlainHttp=false, …)` | 扩展已装载，括号里是**当前生效**的策略开关 |
| `[cline-local] blocked connection: …` | 有东西想去公网，**已被拦住**（好事，说明拦截在工作） |
| `[cline-local] Plaintext http to 192.168.0.33:8080 is allowed by lanPlainHttp …` | 你正在用**方案 B 的明文链路**；走方案 A 时这行不应出现 |

**预期**：模型有回复，工具能读文件。

**这些是正常现象，不是 bug**：

- 模型回答里的**远程图片不会显示**（CSP 只允许随包资源，这是防泄露）；
- 选云端 provider 会报本地错误；
- 浏览器工具、网页读取、账户、市场、云会话都不可用（代码不在包里）。

---

## 配置文件能改什么

`~/.config/cline-local/network.json`（Windows：`C:\Users\你\.config\cline-local\network.json`），改完重载窗口。**只能收紧，不能放宽到公网。**

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `lanPlainHttp` | `false` | 允许非回环的明文 http（方案 B 用） |
| `allowLanDns` | `false` | 允许用主机名代替字面 IP（解析结果仍必须是私有地址） |
| `allowCgnat` | `false` | 允许 `100.64.0.0/10`（Tailscale 用的段） |
| `strictSockets` | `true` | 连裸 socket 也走同一策略 |
| `caCertPath` | 无 | 内网 CA 的证书文件（服务端是内网 CA 签的 https 时用） |
| `pinSha256` | 无 | 固定服务端证书公钥指纹（自签证书时用） |

**这里不写模型地址**——地址只在设置的 Base URL 一处。

---

## 故障对照表

| 现象 / 日志 | 原因 | 怎么办 |
| --- | --- | --- |
| `Plaintext http to … would expose your code on the LAN` | 直连明文 http，未开 `lanPlainHttp` | 用方案 A，或按方案 B 写配置后**重载窗口** |
| `DNS names are disabled; use a literal private IP` | 用了主机名 | 改成 IP，或设 `allowLanDns: true` |
| `"0177.0.0.1" has an ambiguous address spelling` | 地址写法不规范（前导零等） | 写标准点分十进制 IP |
| `… is not a loopback or private LAN address` | 填了公网地址 | 这个发行版不放行公网，改回局域网地址 |
| `connection refused 127.0.0.1:8080` | 隧道没起 | `systemctl --user status model-tunnel`，看 `ssh` 是否免密可用 |
| 模型返回 `authentication_error` / 401 | 没填 API Key | 设置里补 Key |
| 模型 404 / 找不到模型 | Model ID 与服务端不一致 | 用 `/v1/models` 里的真实 `id` |
| 侧栏没图标 | 窗口未重载 / 图标被隐藏 | Reload Window；活动栏右键勾选 Pline |
| `Could not register service worker` | VS Code 缓存 | 完全退出后 `rm -rf ~/.config/Code/Service Worker` |
| 装完出现两个图标 | 旧身份未卸载 | `code --uninstall-extension local-cline.claude-dev` |
| 想彻底回退 | — | `code --uninstall-extension local.pline`，删 `~/.config/cline-local/network.json` |
