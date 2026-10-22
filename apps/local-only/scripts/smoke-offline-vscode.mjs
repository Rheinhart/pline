/**
 * Load the offline extension bundle the way the VS Code extension host does.
 *
 * The audit proves which modules are in the bundle; this proves the bundle
 * actually evaluates. That matters because the cloud SDK stubs throw when
 * called: if any of them were touched while modules initialise, activation
 * would crash instead of starting.
 *
 * A minimal `vscode` module is injected; only the module graph is executed, no
 * activation (which needs a real host).
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import Module from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = path.join(here, "dist/offline-vscode/extension.js");
if (!fs.existsSync(bundle)) {
  console.error("Build the offline bundle first: node apps/local-only/scripts/build-offline-vscode.mjs");
  process.exit(1);
}

class Disposable {
  dispose() {}
}

class Emitter {
  event = () => new Disposable();
  fire() {}
  dispose() {}
}

const noop = () => undefined;
const thenable = () => Promise.resolve(undefined);
const configuration = { get: () => undefined, update: thenable, has: () => false, inspect: () => undefined };
const make = (extra = {}) =>
  new Proxy(
    {
      ...extra,
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        if (typeof property === "symbol") return undefined;
        return noop;
      },
    },
  );

const vscode = {
  version: "1.101.0",
  window: make({
    createOutputChannel: () => make({ append: noop, appendLine: noop, show: noop, clear: noop, dispose: noop }),
    createWebviewPanel: () => make({ webview: { html: "", options: {}, asWebviewUri: (uri) => uri, postMessage: () => true, onDidReceiveMessage: () => new Disposable() }, onDidDispose: () => new Disposable(), dispose: noop, reveal: noop }),
    registerWebviewViewProvider: () => new Disposable(),
    registerTreeDataProvider: () => new Disposable(),
    showInformationMessage: thenable,
    showWarningMessage: thenable,
    showErrorMessage: thenable,
    onDidChangeActiveTextEditor: () => new Disposable(),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    tabGroups: { all: [], onClose: () => new Disposable(), onDidChangeTabs: () => new Disposable() },
  }),
  workspace: make({
    workspaceFolders: [],
    getConfiguration: () => configuration,
    onDidChangeConfiguration: () => new Disposable(),
    onDidChangeWorkspaceFolders: () => new Disposable(),
    onDidSaveTextDocument: () => new Disposable(),
    onDidOpenTextDocument: () => new Disposable(),
    onDidCloseTextDocument: () => new Disposable(),
    createFileSystemWatcher: () => ({ onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), onDidDelete: () => new Disposable(), dispose: noop }),
    fs: { readFile: thenable, writeFile: thenable, stat: thenable, readDirectory: thenable, createDirectory: thenable, delete: thenable },
    openTextDocument: thenable,
    isTrusted: true,
    textDocuments: [],
  }),
  commands: make({ registerCommand: () => new Disposable(), executeCommand: thenable, getCommands: () => Promise.resolve([]) }),
  extensions: { getExtension: () => undefined, all: [] },
  languages: make({ createDiagnosticCollection: () => make({ set: noop, delete: noop, dispose: noop }) }),
  env: make({ machineId: "offline-smoke", sessionId: "offline-smoke", appName: "Code", remoteName: undefined, openExternal: thenable, clipboard: { readText: thenable, writeText: thenable } }),
  Uri: { parse: (value) => ({ toString: () => String(value), fsPath: String(value), scheme: "file", path: String(value), query: "", fragment: "" }), file: (value) => ({ toString: () => `file://${value}`, fsPath: String(value), scheme: "file", path: String(value), query: "", fragment: "" }), joinPath: (base, ...parts) => ({ toString: () => [base.fsPath ?? base.path, ...parts].join("/"), fsPath: [base.fsPath ?? base.path, ...parts].join("/"), scheme: "file", path: "", query: "", fragment: "" }) },
  EventEmitter: Emitter,
  Disposable: class {
    static from() {
      return new Disposable();
    }
    dispose() {}
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() };
    cancel() {}
    dispose() {}
  },
  EventEmitter2: Emitter,
  Position: class {},
  Range: class {},
  Selection: class {},
  Location: class {},
  ThemeIcon: class {},
  ThemeColor: class {},
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1, Two: 2, Active: -1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  UIKind: { Desktop: 1, Web: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  MarkdownString: class {
    constructor(value = "") {
      this.value = value;
    }
  },
  CodeAction: class {},
  CodeActionKind: { QuickFix: { value: "quickfix" } },
  CodeLens: class {},
  InlineCompletionItem: class {},
  CompletionItem: class {},
  CompletionItemKind: { Text: 0 },
  SnippetString: class {},
  DocumentLink: class {},
  TreeItem: class {},
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  RelativePattern: class {},
  NotebookCellData: class {},
  NotebookData: class {},
  NotebookEdit: class {},
  WorkspaceEdit: class {},
  Hover: class {},
  SemanticTokens: class {},
  DocumentSymbol: class {},
  SymbolKind: { File: 0 },
  Terminal: class {},
  QuickPickItemKind: { Separator: -1, Default: 0 },
  InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
  TextEditorDecorationType: class {},
  FoldingRange: class {},
  FoldingRangeKind: { Comment: "comment" },
  SelectionRange: class {},
  CallHierarchyItem: class {},
  TypeDefinitionProvider: class {},
  DocumentDropEdit: class {},
  InlineCompletionList: class {},
  LinkedEditingRanges: class {},
  InlayHint: class {},
  DocumentHighlight: class {},
  Color: class {},
  ColorInformation: class {},
  DocumentColorProvider: class {},
  DeclarationProvider: class {},
  ImplementationProvider: class {},
  ReferenceContext: class {},
  RenameProvider: class {},
  SignatureHelp: class {},
  DocumentLinkProvider: class {},
  CodeActionProvider: class {},
  FormattingEdit: class {},
  CharacterPair: class {},
  OnTypeFormattingEditProvider: class {},
  FoldingRangeProvider: class {},
  CallHierarchyProvider: class {},
  TypeDefinition: class {},
  WorkspaceFolder: class {},
};

// apps/local-only is an ESM package, but the extension bundle is CommonJS
// (exactly like the packaged extension, whose package.json has no "type"). The
// smoke copy therefore lives in a directory that declares CommonJS.
const smoke = path.join(here, "dist/offline-vscode/.smoke");
fs.rmSync(smoke, { recursive: true, force: true });
fs.mkdirSync(smoke, { recursive: true });
fs.writeFileSync(path.join(smoke, "package.json"), '{ "type": "commonjs" }\n');
const copy = path.join(smoke, "extension.cjs");
fs.copyFileSync(bundle, copy);

const require = createRequire(import.meta.url);

const load = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === "vscode") return vscode;
  return load.call(this, request, parent, isMain);
};

const started = Date.now();
const loaded = require(copy);
fs.rmSync(smoke, { recursive: true, force: true });
Module._load = load;

const exported = Object.keys(loaded ?? {});
if (!exported.includes("activate") || !exported.includes("deactivate")) {
  console.error(`Offline bundle did not export activate/deactivate (got: ${exported.join(", ") || "nothing"}).`);
  process.exit(1);
}
console.log(`Offline bundle evaluates: activate/deactivate exported in ${Date.now() - started} ms; no module-initialisation call reached a cloud SDK.`);
