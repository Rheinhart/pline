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
| **Model ID** | 服务端真实的模型名，不猜 | 在 B 上跑 `curl -s http://192.168.0.33:8080/v1/models` 抄 `id` 字段（走隧道则用 `http://127.0.0.1:8080/v1/models`；直连时报明文被拒也不影响这条 `curl`，它是系统命令、不受插件策略管） |
| **API Key** | 服务端要求就填 | 你的服务需要 key，不填会返回 `authentication_error` |

4. 保存，关掉设置页。

**注意**：设置里仍会列出 Anthropic / OpenAI / Bedrock 等**云端 provider**（为了保持原版界面）。选它们会在任务开始时给一条本地错误——**这是设计如此**，这个发行版连不上公网。

---

## 第 5 步 · 选一种加密方式（重要）

插件的硬规则：**非回环地址必须 https**。你的模型服务是明文 http，所以要选一条路。

| 情况 | 选 | 加密？ |
| --- | --- | --- |
| B 能 ssh 到 A | **方案 A（SSH 隧道）** | ✓ 加密，服务端零改动 |
| B 没有 ssh / 不想折腾 | **方案 B（直连 + 允许明文）** | ✗ 局域网明文 |
| A 的服务能开 https | **方案 C（内网证书）** | ✓ 最干净，但要改服务端 |

---

### 先做两项检查（30 秒，决定你能不能走方案 A）

```bash
command -v ssh && ssh -V          # 检查 1：B 有没有 SSH 客户端
code --version >/dev/null; nc -vz 192.168.0.33 22   # 检查 2：A 的 22 端口通不通
```

- **检查 1 预期**：打印出 `/usr/bin/ssh` 和版本号。Linux 发行版自带；**Windows 10/11 也自带 OpenSSH 客户端**（在 PowerShell 里同样能用）；都没有的话用 PuTTY（它的 Connection → SSH → Tunnels 就是隧道）或 WSL。
- **检查 2 预期**：`succeeded`。不通说明 A 没开 sshd 或被防火墙挡了；你在 A 上执行 `ss -ltn | grep :22` 看是否在监听。
- 还需要：**你在 A 上有一个登录账号**（隧道就是用这个账号连过去的），且能**免密**登录：

```bash
cat ~/.ssh/id_ed25519.pub | ssh 你的用户名@192.168.0.33 'cat >> ~/.ssh/authorized_keys'
ssh -o BatchMode=yes 你的用户名@192.168.0.33 'echo 免密OK'   # 预期：免密OK
```

（免密是必需的：隧道服务用 `BatchMode=yes`，没配密钥它会**直接失败退出**，而不是卡在密码提示上。）

---

### 方案 A（推荐）：SSH 隧道 —— 传输加密，服务端零改动

**隧道是什么**：让 SSH 在 B 本机开一个假端口（`127.0.0.1:8080`），凡是打到它的请求都塞进那条已加密的 SSH 连接里，送到 A 之后再由 A 自己用回环交给模型服务。所以插件看到的是“同机服务”，而真正跨机的那一段**装在 SSH 里，是加密的**：

```
插件 → B 的 127.0.0.1:8080 →（加密）→ A:22 → A 的 127.0.0.1:8080 → 模型服务
```

好处：服务端不用装证书、不用改配置；而且**开了 VPN 也不破功**（全隧道 VPN 可能把发往 `192.168.x.x` 的请求先送出家门再绕回来，那时只有 SSH 里层仍然加密）。

**第 1 步：手动试一次**（会占住这个终端，`Ctrl+C` 退出）

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 你的用户名@192.168.0.33
```

**预期**：命令不报错、也不退出（挂着就是成功）。

**第 2 步：确认隧道真的通了**（另开一个终端）

```bash
curl -s http://127.0.0.1:8080/v1/models | head -c 120
```

**预期**：返回 JSON（模型列表，或带 key 的认证信息）。若报 `connection refused`，说明上面的 ssh 没挂着或端口被占。

**第 3 步：做成开机自启**（B 是 systemd 发行版时；不确定就跑 `systemctl --user status` 看有没有输出）

```bash
mkdir -p ~/.config/systemd/user ~/.config/cline-local
cp <仓库>/apps/local-only/systemd/model-tunnel.env    ~/.config/cline-local/tunnel.env
cp <仓库>/apps/local-only/systemd/model-tunnel.service ~/.config/systemd/user/
nano ~/.config/cline-local/tunnel.env        # 改 TUNNEL_TARGET=你的用户名@192.168.0.33
systemctl --user daemon-reload && systemctl --user enable --now model-tunnel
loginctl enable-linger "$USER"               # 不执行这步，退出登录后隧道会被停掉
```

**预期**：`systemctl --user status model-tunnel --no-pager | head -3` 显示 **`Active: active (running)`**。

**B 没有 systemd 怎么办**：跳过第 3 步，把第 1 步那条命令塞进终端的启动项，或写成桌面自启脚本；也可以干脆每次手开。**只要 `curl http://127.0.0.1:8080/v1/models` 有响应，插件就能用**，自启只是省事。

最后在设置里把 Base URL 填 `http://127.0.0.1:8080/v1`，**并且保持 `lanPlainHttp` 不开**（默认就是关）。

> 若 B 本机 8080 已被占用：改 `~/.config/cline-local/tunnel.env` 里的 `TUNNEL_PORT`（比如 `18080`），重跑 `systemctl --user restart model-tunnel`，设置里跟着改成 `http://127.0.0.1:18080/v1`。

> 为什么不开：万一隧道断了，你会立刻得到“连接被拒绝”，而不是悄悄退化成一条明文链路。

---

### 方案 B（省事）：直连 + 允许明文

直连时地址是 `http://192.168.0.33:8080/v1`。默认会被拒（报 `Plaintext http to … would expose your code on the LAN`），需要你**显式开一个开关**。开关在配置文件里，**没有界面开关**。

**第 1 步：打开（或创建）配置文件**

```bash
mkdir -p ~/.config/cline-local
nano ~/.config/cline-local/network.json
```

**第 2 步：把这一整段写进去并保存**（文件内容就是一个 JSON 对象）

```json
{
  "lanPlainHttp": true
}
```

三个容易错的地方：

- 是 `true`，**不是** `"true"`（不要引号），也不是 `1`；
- 冒号后面有个空格无所谓，但**键名必须带双引号**；
- 已经有其他键时，**只加一行**，别覆盖整个文件，例如：

```json
{
  "lanPlainHttp": true,
  "allowCgnat": false
}
```

**第 3 步：收紧权限并回读确认**

```bash
chmod 600 ~/.config/cline-local/network.json
cat ~/.config/cline-local/network.json      # 预期：你刚写的 JSON，lanPlainHttp 为 true
```

（若权限对其他用户可读，日志会提醒你对这个文件 `chmod 600`。）

**第 4 步：重载窗口**（配置只在启动时读一次，**不重载等于没改**）

按 `Ctrl+Shift+P` → 输入 `Reload Window` → 选 **Developer: Reload Window**。不是“关掉再打开面板”，是整个窗口重载。

**第 5 步：确认真的生效了**

发一个任务，然后看 **Output** 面板（右上角下拉选本插件的输出通道）第一行：

```
[cline-local] Internet access is disabled … (lanPlainHttp=true, allowLanDns=false, …)
```

看到 **`lanPlainHttp=true`** 才算生效；仍是 `false` 就回去检查 JSON 拼写、文件路径，以及是否真的重载了窗口。生效后还会看到一条提示，提醒你此刻是明文：

```
[cline-local] Plaintext http to 192.168.0.33:8080 is allowed by lanPlainHttp, …
```

**代价**：prompt 和代码在局域网上是明文，同一 Wi-Fi 上的设备理论上能抓包。想反悔随时把那行删掉再重载窗口，即可回到严格状态。

---

### 方案 C（最干净，但要动服务端）：给服务加 https

服务端支持的话（llama.cpp 的 `--ssl-key-pair`、vLLM 的 `--ssl-keyfile/--ssl-certfile` 等），用自签证书即可，然后在 `network.json` 里二选一：

```json
{ "caCertPath": "/home/你/.config/cline-local/model-ca.pem" }   // 自建 CA 签的
```
```json
{ "pinSha256": "证书公钥的 base64 指纹" }                        // 自签、没有 CA
```

指纹在 B 上算（服务端证书公钥的 SPKI 做 sha256，再 base64）：

```bash
openssl s_client -connect 192.168.0.33:8080 </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | base64
```

指纹不对时会直接拒连、**一个字节也不发**：`Certificate pin mismatch for …: Nothing was sent.`（服务端换证书后需要重算一次。）

此时 `lanPlainHttp` **保持关闭**，非回环走 https，链路上就是加密的。

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
| `connection refused 127.0.0.1:8080` | 隧道没起 | `systemctl --user status model-tunnel`；`journalctl --user -u model-tunnel -n 20` 看 ssh 报什么 |
| 隧道服务一直启动失败 | 没配免密（服务用 `BatchMode=yes`，不会问你密码） | 先手跑 `ssh -N -L …` 输密码能通，再 `ssh-copy-id` 装密钥 |
| 按方案 B 写了配置，日志里仍是 `lanPlainHttp=false` | JSON 拼写错（如 `"true"`）、文件路径不对，或**没重载窗口** | `cat ~/.config/cline-local/network.json` 回读，再 Reload Window |
| `Certificate pin mismatch … Nothing was sent.` | `pinSha256` 与服务端证书不符（或证书换了） | 重算指纹，或改用 `caCertPath` |
| 模型返回 `authentication_error` / 401 | 没填 API Key | 设置里补 Key |
| 模型 404 / 找不到模型 | Model ID 与服务端不一致 | 用 `/v1/models` 里的真实 `id` |
| 侧栏没图标 | 窗口未重载 / 图标被隐藏 | Reload Window；活动栏右键勾选 Pline |
| `Could not register service worker` | VS Code 缓存 | 完全退出后 `rm -rf ~/.config/Code/Service Worker` |
| 装完出现两个图标 | 旧身份未卸载 | `code --uninstall-extension local-cline.claude-dev` |
| 想彻底回退 | — | `code --uninstall-extension local.pline`，删 `~/.config/cline-local/network.json` |
