import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
const tools = process.env.LOCAL_ONLY_TOOLS ?? app;
const ts = createRequire(join(tools, "package.json"))("typescript");
const files = ts.sys.readDirectory(app, [".ts"], ["**/dist/**"], ["src/**/*.ts", "vscode/**/*.ts", "tests/**/*.ts"]);
const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
  types: ["node", "vscode"], typeRoots: [join(tools, "node_modules/@types")], baseUrl: root,
  paths: {
    "@cline/agents": ["sdk/packages/agents/src/agent-runtime.ts"],
    "@cline/shared": ["apps/local-only/src/engine-shared.ts"],
    "@cline/llms": ["apps/local-only/src/engine-providers.ts"],
    "*": [join(tools, "node_modules/*")],
  },
};
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options));
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: (f) => f, getNewLine: () => "\n" }));
  process.exit(1);
}
console.log("Offline distribution and upstream Agent loop typecheck passed.");
