import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import * as path from "node:path";
import { LocalSession, type Event } from "../src/session";
import { listLocalModels } from "../src/model";
import { History, readSettings, readSettingsDraft, saveSettings, type SettingsUpdate } from "../src/storage";
import { Workspace, type Approval } from "../src/workspace";

export function activate(context: vscode.ExtensionContext): void {
  let view: vscode.WebviewView | undefined;
  let session: LocalSession | undefined;
  let root: string | undefined;
  let busy = false;
  let showSettingsOnResolve = false;
  const documents = new Map<string, string>();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("cline-local-review", {
    provideTextDocumentContent(uri) { return documents.get(uri.toString()) ?? ""; },
  }));
  const emit = (event: Event) => { void view?.webview.postMessage(event); };
  const approve: Approval = async (request) => {
    if (!view) return false;
    if (request.kind === "command") {
      return await vscode.window.showWarningMessage(`在禁网沙箱运行（项目只读）：\n${request.command}`, { modal: true }, "运行一次") === "运行一次";
    }
    const id = randomUUID();
    const before = vscode.Uri.parse(`cline-local-review:/${id}/before/${encodeURIComponent(request.edit.path)}`);
    const after = vscode.Uri.parse(`cline-local-review:/${id}/after/${encodeURIComponent(request.edit.path)}`);
    documents.set(before.toString(), request.edit.before ?? "");
    documents.set(after.toString(), request.edit.after);
    await vscode.commands.executeCommand("vscode.diff", before, after, `Cline Local: ${request.edit.path}`, { preview: true });
    const accepted = await vscode.window.showWarningMessage(`差异已打开。审阅后是否应用 ${request.edit.path} 的修改？`, "应用修改", "拒绝") === "应用修改";
    // URI documents are bounded to the current review only.
    documents.delete(before.toString()); documents.delete(after.toString());
    return accepted;
  };
  async function prepareRoot(): Promise<string> {
    if (!vscode.workspace.isTrusted) throw new Error("请先信任此工作区。");
    if (vscode.env.remoteName) throw new Error("此发行版仅支持本机工作区，不连接远程扩展宿主。");
    if (root) return root;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error("请先打开一个本地项目。");
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (!folder || folder.uri.scheme !== "file") throw new Error("请选择本地项目。");
    root = (await Workspace.open(folder.uri.fsPath)).root;
    return root;
  }
  async function configure(): Promise<void> {
    if (busy) throw new Error("请先停止当前任务。");
    showSettingsOnResolve = true;
    await open();
    if (view) await showSettings();
  }
  async function showSettings(): Promise<void> {
    const draft = await readSettingsDraft();
    showSettingsOnResolve = false;
    void view?.webview.postMessage({ type: "settings", ...draft });
  }
  async function open(): Promise<void> {
    await prepareRoot();
    await vscode.commands.executeCommand("clineLocal.chatView.focus");
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("clineLocal.chatView", {
    resolveWebviewView(resolved) {
      view = resolved;
      resolved.webview.options = { enableScripts: true, localResourceRoots: [] };
      resolved.webview.html = html();
      resolved.onDidDispose(() => { session?.abort(); session = undefined; view = undefined; documents.clear(); });
      resolved.webview.onDidReceiveMessage((message) => {
      void (async () => {
        if (message.type === "cancel") { session?.abort(); return; }
        if (busy) throw new Error("当前任务尚未结束。");
        if (message.type === "showSettings") { await showSettings(); return; }
        if (message.type === "listModels") {
          const models = await listLocalModels(await readSettings());
          void view?.webview.postMessage({ type: "models", models });
          return;
        }
        if (message.type === "saveSettings") {
          const settings = await saveSettings(message.settings as SettingsUpdate);
          session = undefined;
          void view?.webview.postMessage({ type: "settingsSaved", ...settings });
          emit({ type: "notice", text: "模型设置已保存。新任务会使用新设置。" });
          return;
        }
        busy = true;
        try {
          if (message.type === "new") { session = undefined; emit({ type: "clear" }); }
          else if (message.type === "undo") { if (!session) throw new Error("没有可撤销的修改。"); await session.undo(); }
          else if (message.type === "history") {
            const ids = await (await History.open(await prepareRoot())).list();
            const id = await vscode.window.showQuickPick(ids, { placeHolder: "选择本地会话（最近 50 个）" });
            if (id) { emit({ type: "clear" }); session = await LocalSession.create(await prepareRoot(), await readSettings(), approve, emit, id); }
          } else if (message.type === "prompt") {
            session ??= await LocalSession.create(await prepareRoot(), await readSettings(), approve, emit);
            await session.run(message.text);
          }
        } finally { busy = false; }
      })().catch((error) => emit({ type: "error", message: error instanceof Error ? error.message : "任务失败" }));
      });
      if (showSettingsOnResolve) void showSettings().catch((error) => emit({ type: "error", message: String(error) }));
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  const register = (name: string, action: () => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(name, () => action().catch((error) => vscode.window.showErrorMessage(String(error.message ?? error)))));
  register("clineLocal.open", open);
  register("clineLocal.configure", configure);
  register("clineLocal.selection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;
    const selected = editor.document.getText(editor.selection);
    const filename = editor.document.uri.fsPath;
    await open();
    const workspaceRoot = await prepareRoot();
    const relative = path.relative(workspaceRoot, filename).split(path.sep).join("/");
    await (await Workspace.open(workspaceRoot)).resolve(relative);
    if (selected.length > 32 * 1024) throw new Error("选中内容超过 32 KiB。");
    emit({ type: "selection", text: `文件：${relative}\n\n${selected}` });
  });
  context.subscriptions.push({ dispose() { session?.abort(); } });
}

function html(): string {
  const nonce = randomBytes(24).toString("base64");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none';">
<style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:12px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}nav{display:flex;gap:6px;flex-wrap:wrap}button{padding:6px 10px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}textarea,input,select{box-sizing:border-box;width:100%;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:7px}textarea{min-height:110px}input[type=checkbox]{width:auto}label{display:block;margin:12px 0 4px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;line-height:1.5}#status,.hint{opacity:.8;font-size:12px;margin:12px 0}.user{border-top:1px solid var(--vscode-panel-border);padding-top:12px}[hidden]{display:none!important}#settings{margin-top:12px}#settings nav{margin-top:14px}</style></head><body>
<nav><button data-action="new">新任务</button><button data-action="history">本地历史</button><button data-action="undo">撤销修改</button><button id="open-settings">模型设置</button><button data-action="cancel">停止</button></nav>
<p id="status">Cline Local · 上下文仅发送至你配置的本机／内网模型。无账号、遥测或更新。</p>
<section id="chat"><div id="messages" role="log" aria-live="polite"></div><textarea id="prompt" aria-label="任务" placeholder="描述需要完成的编程任务"></textarea><button id="send">发送</button></section>
<section id="settings" hidden><h3>模型设置</h3><p class="hint">只允许本机或私有 IP 地址。保存后新任务使用此设置。</p>
<label for="base-url">OpenAI 兼容 API 地址</label><input id="base-url" type="url" spellcheck="false" placeholder="http://192.168.1.50:8000/v1">
<label for="model">模型 ID</label><input id="model" type="text" list="model-options" spellcheck="false" placeholder="模型服务提供的准确 ID"><datalist id="model-options"></datalist><button id="list-models" class="secondary">从已保存的本地端点读取模型列表</button><p id="models-status" class="hint"></p>
<label for="context-window">上下文窗口 token</label><input id="context-window" type="number" min="4096" max="2000000" step="1" value="131072"><p class="hint">按 UTF-8 字节保守估算上下文，超过窗口会停止发送。</p>
<label for="max-tokens">最大输出 token</label><input id="max-tokens" type="number" min="128" max="32768" step="1" value="4096">
<label for="temperature">Temperature（留空由模型决定）</label><input id="temperature" type="number" min="0" max="2" step="0.01" placeholder="模型默认">
<label for="reasoning-effort">Reasoning Effort</label><select id="reasoning-effort"><option value="none">不发送</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select><p class="hint">仅适用于支持 OpenAI reasoning_effort 参数的本地模型。</p>
<label for="api-key">API Key（留空则保留已有值）</label><input id="api-key" type="password" autocomplete="off" spellcheck="false"><p id="key-status" class="hint"></p>
<label><input id="clear-key" type="checkbox"> 清除已保存的 API Key</label>
<label><input id="commands" type="checkbox"> 允许逐次审批沙箱命令</label>
<nav><button id="save-settings">保存设置</button><button id="close-settings" class="secondary">返回对话</button></nav><p id="settings-status" role="status"></p></section>
<script nonce="${nonce}">const api=acquireVsCodeApi();const log=document.getElementById('messages');const input=document.getElementById('prompt');const status=document.getElementById('status');const chat=document.getElementById('chat');const settings=document.getElementById('settings');const settingsStatus=document.getElementById('settings-status');let output;let busy=false;
function add(text,kind){const p=document.createElement('pre');p.textContent=text;p.className=kind||'';log.appendChild(p);return p;}
function send(){if(busy||!input.value.trim())return;add(input.value,'user');api.postMessage({type:'prompt',text:input.value});input.value='';output=undefined;busy=true;}
document.getElementById('send').onclick=send;input.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>api.postMessage({type:b.dataset.action}));
document.getElementById('open-settings').onclick=()=>{settingsStatus.textContent='';api.postMessage({type:'showSettings'});};
document.getElementById('list-models').onclick=()=>{document.getElementById('models-status').textContent='正在读取本地模型列表…';api.postMessage({type:'listModels'});};
document.getElementById('close-settings').onclick=()=>{settings.hidden=true;chat.hidden=false;};
document.getElementById('save-settings').onclick=()=>{const temperatureText=document.getElementById('temperature').value.trim();settingsStatus.textContent='正在保存…';api.postMessage({type:'saveSettings',settings:{baseUrl:document.getElementById('base-url').value.trim(),model:document.getElementById('model').value.trim(),maxTokens:Number(document.getElementById('max-tokens').value),contextWindow:Number(document.getElementById('context-window').value),temperature:temperatureText===''?null:Number(temperatureText),reasoningEffort:document.getElementById('reasoning-effort').value,apiKey:document.getElementById('api-key').value,clearApiKey:document.getElementById('clear-key').checked,commands:document.getElementById('commands').checked}});};
function showDraft(m){document.getElementById('base-url').value=m.baseUrl;document.getElementById('model').value=m.model;document.getElementById('max-tokens').value=String(m.maxTokens);document.getElementById('context-window').value=String(m.contextWindow);document.getElementById('temperature').value=m.temperature===null?'':String(m.temperature);document.getElementById('reasoning-effort').value=m.reasoningEffort;document.getElementById('commands').checked=m.commands;document.getElementById('api-key').value='';document.getElementById('clear-key').checked=false;document.getElementById('key-status').textContent=m.hasApiKey?'已保存 API Key；留空可保留。':'尚未设置 API Key。';settings.hidden=false;chat.hidden=true;}
window.addEventListener('message',({data:m})=>{if(m.type==='settings'){showDraft(m);settingsStatus.textContent='';}else if(m.type==='settingsSaved'){showDraft(m);settingsStatus.textContent='设置已保存。';}else if(m.type==='models'){const list=document.getElementById('model-options');list.textContent='';for(const id of m.models){const option=document.createElement('option');option.value=id;list.appendChild(option);}document.getElementById('models-status').textContent='已读取 '+m.models.length+' 个模型；也可手动输入 ID。';}else if(m.type==='text'){output??=add('');output.textContent+=m.text;}else if(m.type==='started'){busy=true;status.textContent='运行中…';}else if(m.type==='done'){busy=false;status.textContent=m.status;if(m.error)add(m.error);output=undefined;}else if(m.type==='error'){busy=false;if(!settings.hidden){settingsStatus.textContent=m.message;document.getElementById('models-status').textContent='';}else add(m.message);status.textContent='任务未完成';}else if(m.type==='session'){status.textContent=m.endpoint+' · '+m.model;}else if(m.type==='notice'){add(m.text);}else if(m.type==='selection'){input.value+=(input.value?'\\n\\n':'')+m.text;}else if(m.type==='clear'){log.textContent='';output=undefined;busy=false;}else if(m.type==='restored'){for(const msg of m.messages){const text=msg.content.filter(p=>p.type==='text').map(p=>p.text).join('\\n');if(text)add(text,msg.role);}}else if(m.type==='tool'){output=undefined;status.textContent='工具：'+m.name;}});</script></body></html>`;
}
