import * as vscode from "vscode";
import { randomBytes, randomUUID } from "node:crypto";
import * as path from "node:path";
import { LocalSession, type Event } from "../src/session";
import { ensureConfig, History, readSettings } from "../src/storage";
import { Workspace, type Approval } from "../src/workspace";

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let session: LocalSession | undefined;
  let root: string | undefined;
  let busy = false;
  const documents = new Map<string, string>();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("cline-local-review", {
    provideTextDocumentContent(uri) { return documents.get(uri.toString()) ?? ""; },
  }));
  const emit = (event: Event) => { void panel?.webview.postMessage(event); };
  const approve: Approval = async (request) => {
    if (!panel) return false;
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
  async function configure(): Promise<void> {
    if (busy) throw new Error("请先停止当前任务。");
    const filename = await ensureConfig();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(filename));
    session = undefined;
    emit({ type: "notice", text: "保存模型配置后，新任务会使用新设置。上下文只发送到配置中的模型地址。" });
  }
  async function open(): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error("请先信任此工作区。");
    if (vscode.env.remoteName) throw new Error("此发行版仅支持本机工作区，不连接远程扩展宿主。");
    if (panel) { panel.reveal(); return; }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error("请先打开一个本地项目。");
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick();
    if (!folder || folder.uri.scheme !== "file") return;
    root = (await Workspace.open(folder.uri.fsPath)).root;
    panel = vscode.window.createWebviewPanel("clineLocal", "Cline Local", vscode.ViewColumn.Beside, {
      enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true,
    });
    panel.webview.html = html();
    panel.onDidDispose(() => { session?.abort(); session = undefined; panel = undefined; documents.clear(); });
    panel.webview.onDidReceiveMessage((message) => {
      void (async () => {
        if (message.type === "cancel") { session?.abort(); return; }
        if (busy) throw new Error("当前任务尚未结束。");
        if (message.type === "configure") { await configure(); return; }
        busy = true;
        try {
          if (message.type === "new") { session = undefined; emit({ type: "clear" }); }
          else if (message.type === "undo") { if (!session) throw new Error("没有可撤销的修改。"); await session.undo(); }
          else if (message.type === "history") {
            const ids = await (await History.open(root!)).list();
            const id = await vscode.window.showQuickPick(ids, { placeHolder: "选择本地会话（最近 50 个）" });
            if (id) { emit({ type: "clear" }); session = await LocalSession.create(root!, await readSettings(), approve, emit, id); }
          } else if (message.type === "prompt") {
            session ??= await LocalSession.create(root!, await readSettings(), approve, emit);
            await session.run(message.text);
          }
        } finally { busy = false; }
      })().catch((error) => emit({ type: "error", message: error instanceof Error ? error.message : "任务失败" }));
    });
  }
  const register = (name: string, action: () => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(name, () => action().catch((error) => vscode.window.showErrorMessage(String(error.message ?? error)))));
  register("clineLocal.open", open);
  register("clineLocal.configure", configure);
  register("clineLocal.selection", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;
    const selected = editor.document.getText(editor.selection);
    const filename = editor.document.uri.fsPath;
    await open();
    const relative = path.relative(root!, filename).split(path.sep).join("/");
    await (await Workspace.open(root!)).resolve(relative);
    if (selected.length > 32 * 1024) throw new Error("选中内容超过 32 KiB。");
    emit({ type: "selection", text: `文件：${relative}\n\n${selected}` });
  });
  context.subscriptions.push({ dispose() { session?.abort(); panel?.dispose(); } });
}

function html(): string {
  const nonce = randomBytes(24).toString("base64");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none';">
<style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}nav{display:flex;gap:8px;flex-wrap:wrap}button{padding:6px 10px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}textarea{box-sizing:border-box;width:100%;min-height:110px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;line-height:1.5}#status{opacity:.8;font-size:12px;margin:12px 0}.user{border-top:1px solid var(--vscode-panel-border);padding-top:12px}</style></head><body>
<nav><button data-action="new">新任务</button><button data-action="history">本地历史</button><button data-action="undo">撤销修改</button><button data-action="configure">模型设置</button><button data-action="cancel">停止</button></nav>
<p id="status">Cline Local · 上下文仅发送至你配置的本机／内网模型。无账号、遥测或更新。</p>
<div id="messages" role="log" aria-live="polite"></div><textarea id="prompt" aria-label="任务" placeholder="描述需要完成的编程任务"></textarea><button id="send">发送</button>
<script nonce="${nonce}">const api=acquireVsCodeApi();const log=document.getElementById('messages');const input=document.getElementById('prompt');const status=document.getElementById('status');let output;let busy=false;
function add(text,kind){const p=document.createElement('pre');p.textContent=text;p.className=kind||'';log.appendChild(p);return p;}
function send(){if(busy||!input.value.trim())return;add(input.value,'user');api.postMessage({type:'prompt',text:input.value});input.value='';output=undefined;busy=true;}
document.getElementById('send').onclick=send;input.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>api.postMessage({type:b.dataset.action}));
window.addEventListener('message',({data:m})=>{if(m.type==='text'){output??=add('');output.textContent+=m.text;}else if(m.type==='started'){busy=true;status.textContent='运行中…';}else if(m.type==='done'){busy=false;status.textContent=m.status;if(m.error)add(m.error);output=undefined;}else if(m.type==='error'){busy=false;add(m.message);status.textContent='任务未完成';}else if(m.type==='session'){status.textContent=m.endpoint+' · '+m.model;}else if(m.type==='notice'){add(m.text);}else if(m.type==='selection'){input.value+=(input.value?'\\n\\n':'')+m.text;}else if(m.type==='clear'){log.textContent='';output=undefined;busy=false;}else if(m.type==='restored'){for(const msg of m.messages){const text=msg.content.filter(p=>p.type==='text').map(p=>p.text).join('\\n');if(text)add(text,msg.role);}}else if(m.type==='tool'){output=undefined;status.textContent='工具：'+m.name;}});</script></body></html>`;
}
