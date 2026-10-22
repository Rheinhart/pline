# 离线发行版开发记录(不入库)

本文件是第二条实现路线(把上游 VS Code 扩展裁剪成离线发行版)的**完整改动清单与判断记录**。
它刻意**不提交**进 git:内容是过程性、易过期的工作状态,而 `IMPLEMENTATION.zh-CN.md` 与
`README.md` 才是入库的、面向使用者和审阅者的文档。

分支 `dev`,起点 `main`。基线:`main` 上没有任何离线代码,`dev` 上先前的 `0.1.2` 是**另一条路线**
(手写的最小客户端),两者产物并存、互不依赖。

---

## 1. 提交清单

| 提交 | 内容 | 验证状态 |
| --- | --- | --- |
| `7daca4113` | 离线构建骨架:`net-policy` 策略、`net-guard` 替换 `@shared/net`、`node/*` 守卫包装、遥测/浏览器桩、构建脚本与模块审计、7 项网络测试 | 构建 + 测试通过 |
| `14060e9fa` | 剥离云端模型 SDK(`@ai-sdk/*`、`@aws-sdk/*`、`@smithy/*`、`@sap*`、`google-auth-library`、`@openrouter/*`)与托管追踪(Langfuse / OTEL 导出器);新增加载打包产物的冒烟测试 | 模块 5819→2765、54→34.8 MiB;冒烟测试曾抓到一个真实初始化环 |
| `1e4eb3703` | Webview CSP 收紧、随包 `endpoints.json`(回环)、启动清除 `CLINE_*`/`OTEL_*`/`CLINE_STORAGE_*`、手写 VSIX 打包 | VS Code 安装成功(旧身份);`tsc`/biome 通过 |
| `eefe31cf9` | 明文局域网的拒绝消息里写入配置文件路径 | 测试断言 |
| `7ee0fb35f` | 记录真机首次跑通与两个坑 | — |
| `e25f97040` | `scripts/lan-only.sh` 机器级开关;确认 Webview 报错原因是残留 Service Worker 缓存 | 仅语法与只读 `status` 已验证 |
| `c3baf5186` | 改名 **Pline**(`local.pline` / `pline.*`)、剥离上游站点链接、`scripts/identity.mjs` | 安装为 `local.pline@0.1.2`,ID 零残留 |
| `1baf8fbcb` | 明文**许可**提示(`onNetworkNotice`)、启动日志列出生效开关、`systemd/model-tunnel.*` | 测试 7/7 |
| `2035ce04a` | A 方案在两台机器上的端口与职责说明 | — |

---

## 2. 文件清单

### 新增 — 离线层(`apps/local-only/offline/`)

- `net-policy.ts`:唯一策略真源。私有段/回环/链路本地判定、非回环强制 https、`lanPlainHttp`/`allowLanDns`/`allowCgnat`/`strictSockets` 开关、拒绝与许可两类消息(`deny` / `notice`)。拒绝发生在请求体产生之前。
- `network-settings.ts`:读 `~/.config/cline-local/network.json`(`$XDG_CONFIG_HOME` 优先),只接受布尔开关与 `caCertPath`/`pinSha256`;**只能收紧策略**,不能放行公网;文件权限过宽会告警。
- `net-guard.ts`:替换 `@shared/net`(上游 26 处生产引用都走这个漏斗)。忽略代理环境变量、`redirect: "error"`、无空闲超时、拒绝而不抛给调用方。
- `entry.ts`:扩展入口。清除受管环境变量、装载文件配置、将拒绝/许可/生效策略写入日志,再调用上游 `activate`。
- `node/{net,tls,dns,dns-lookup,dgram,http,https,args,http-target,tls-options}.ts`:只在打包产物内生效的 `node:*` 包装(connect 层策略、内网 CA、SPKI 指纹固定)。包装自身仍用真实 builtin,避免初始化环。
- `stubs/`:PostHog 客户端与 provider 工厂、遥测/错误/功能开关工厂、SDK 核心的 PostHog 开关与账号开关、浏览器工具(去掉 puppeteer 与下载 Chrome)、`cloud-provider.ts`(云端 provider 报本地错误)、`langfuse-telemetry.ts`(静默)、`cloud-sdk-throw.cjs` / `cloud-sdk-noop.cjs`(按 npm 包名拦截)。

### 新增 — 脚本(`apps/local-only/scripts/`)

- `build-offline-vscode.mjs`:重定向表 + 包名桩 + 编译期身份 + 产物内 URL 剥离 + 两道审计(模块清单禁止项、品牌与身份)。**不改上游源码**。
- `identity.mjs`:产品名与上游链接的唯一来源,构建与打包共用。
- `package-offline-vscode.mjs`:手写 OPC 清单生成 VSIX(不用 vsce、不下载),含 Webview URL 剥离与校验。
- `smoke-offline-vscode.mjs`:注入最小 `vscode` 模块后真正 `require` 打包产物。
- `test-offline.mjs` + `tests/offline-net.test.ts`:7 项网络边界测试(真实回环监听)。
- `lan-only.sh`:`off|on|status`,给默认路由加 `blackhole`(IPv4+IPv6)。

### 新增 — systemd(`apps/local-only/systemd/`)

- `model-host-lan-only.conf`:模型服务的单元级 egress 过滤(`IPAddressAllow` + `IPAddressDeny=any`)。
- `model-tunnel.service` + `model-tunnel.env`:客户端侧 SSH 隧道用户单元。

### 修改 — 上游与其他

- `apps/vscode/src/core/webview/WebviewProvider.ts`:**唯一的上游源码改动**。4 行条件分支,由 `process.env.CLINE_LOCAL_OFFLINE` 触发(离线构建把它 define 成 `"true"`,普通构建不定义 → 行为不变)。离线 CSP 只允许随包资源。
- 根 `package.json`:新增 `build:local-offline`、`test:local-offline`、`smoke:local-offline`、`package:local-offline`。
- `apps/local-only/IMPLEMENTATION.zh-CN.md` 第 0 节、`apps/local-only/README.md`:入库文档。

---

## 3. 关键判断(以及踩过的坑)

1. **裁剪上游,而不是扩展最小客户端**。要"尽量维持原版界面",重写最小客户端的成本远高于在构建期做模块替换。
2. **构建期重定向表**(按解析后的绝对路径匹配,含 `@cline/*` 子路径 + 递归保护)→ 上游文件保持不动,包装只存在于本产物内,不影响同宿主里的其它扩展。
3. **`@cline/llms` 是单一 dist**,vendor 模块无法逐个替换 → 改在 **npm 包名**层面拦截;云端 provider 仍在设置里列出(界面保真),选中后得到本地错误。
4. **self-hosted 模式 + 随包 `endpoints.json`(指向已关闭的回环端口)**:遥测/错误上报/远程开关沿上游机制自动关闭,且配置里不含公网地址,漏网调用立即失败。
5. **Webview 是浏览器上下文,Node 层策略管不到它** → CSP 是隐私承诺的一部分,不是加固项:原来 `img-src … https:` 会让模型回答里的远程图片自己去拉取。
6. **上游的命令/视图 ID 全部由 `package.json` 的 `name` 派生**(`src/registry.ts`)。重命名必须两侧同时发生;不一致**不报错**,只会静默丢菜单/快捷键/侧栏。命令 ID 是拼接出来的,无法当字面量 grep,所以审计是回读产物里内联的身份值。
7. **被允许的明文请求不会失败**,因此不提示就等于静默放宽 → `notice` 与 `deny` 同等重要。
8. **产品层盖不住的两块**:编辑器自身的市场/更新/内置扩展流量;模型机自身的出网。这两块只能靠机器级开关或防火墙,文档里必须写清楚,否则"离线发行版"会被误读成"整台机器离线"。

---

## 4. 诚实清单:已验证 / 未验证

**已验证**:模块审计(禁止清单 22 项)、打包产物可被 `require`、7 项网络测试、`tsc`/biome(上游那一个文件)、VS Code 安装 `local-cline.claude-dev@0.1.2` 与 `local.pline@0.1.2`(干净扩展目录 + `--list-extensions` 校验 ID)、**用户真机跑通任务与 code review**(`http://192.168.0.33:8080/v1`,明文 + `lanPlainHttp`)。

**未验证**:

- `caCertPath` / `pinSha256` **从未对着真实 TLS 服务端跑过**(家里是明文 http)。到公司或启用 https 时是第一次。
- `model-host-lan-only.conf` 未应用:此 VM 无免密 `sudo`。而且**非特权用户单元会静默忽略该过滤**(实测 `IPAddressDeny=any` 下 curl 返回 200),所以 README 把验证写成必需步骤——静默失效比没有过滤更危险。
- `lan-only.sh` 的 `off`/`on` 未执行(同上,无免密 sudo;用户命名空间也被禁用,`unshare -rn` 失败,所以第二条路线没沿用 0.1.2 的 `bwrap --unshare-all` 命令沙箱)。
- 本 agent shell 无可用 X 显示(`xset q` 对 `:1` 失败),所以窗口级验证由用户机器完成,不是我。

---

## 5. 本机环境注意(重建环境时会踩)

- 工具链不在 PATH:Bun 在 `/tmp/pline-tools/bun`(需 `export PATH=/tmp/pline-tools/bun:$PATH`);`.husky/pre-commit` 需要 `bunx`,此处已用符号链接顶替;gitleaks 8.24.0 装在 `~/.local/bin`。**两者都不入库**。
- SDK 包之间通过编译后的 `dist/` 解析,改依赖后必须 `bun run build:sdk`,否则报缺 `@cline/*`。运行中的进程不会热重载 SDK 源码。
- esbuild 的坑:Go 正则的 filter 不接受 `/u`、`/i` 标志;`build.resolve` 不接受 `skipPlugins`;给 `node:test` 用的测试产物需要 CJS(undici 的动态 require 会破坏 ESM),因此测试文件用 `.cjs`。
- 仓库根目录有 `cline` / `cline.pub`(放错位置的 OpenSSH 密钥),**待清理**,不属于本任务。

---

## 6. 剩余工作

1. 云入口(账户 / 市场 / 云会话 / 远程配置 / 历史上传)目前只是"连不上",改为明确的"离线版不可用"提示。
2. CLion 宿主对接:先沿用现有 Swing 界面,JCEF 内嵌原版 Webview 作为后续单独一步。
3. 面板内部的 "Cline" 文案是否改名(牵动逻辑字符串,风险与工作量都高于已完成的那些)。
4. 若公司网关会终结 TLS,再考虑把 L2 信封加密做成开关(目前判断:不需要)。
5. Webview 里 `marketplace.visualstudio.com` 之类第三方链接是否一并去掉(目前只去了 Cline 自有站点与各模型商之外的品牌链接)。

## 7. 复现命令

```bash
export PATH=/tmp/pline-tools/bun:$PATH
bun install && bun run build:sdk
(cd apps/vscode && bun run protos && bun run build:webview)
node apps/local-only/scripts/build-offline-vscode.mjs
node apps/local-only/scripts/test-offline.mjs
node apps/local-only/scripts/smoke-offline-vscode.mjs
node apps/local-only/scripts/package-offline-vscode.mjs
code --install-extension --force apps/local-only/dist/release/pline-0.1.2.vsix
```
