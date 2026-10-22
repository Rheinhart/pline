/**
 * Build the offline ("Cline Local") VS Code extension bundle.
 *
 * The upstream extension is compiled unchanged. Two things differ from
 * `apps/vscode/esbuild.mjs`:
 *
 *   1. A redirect table replaces the network modules (the `@shared/net` fetch
 *      funnel and the telemetry / error / feature-flag provider factories)
 *      with local implementations, so PostHog, OpenTelemetry and the proxy
 *      aware cloud transports never enter the bundle.
 *   2. The `net` / `tls` / `dns` / `dgram` / `http` / `https` specifiers are
 *      redirected to the guarded wrappers in `offline/node`, so any remaining
 *      connection attempt is checked against the private-address policy.
 *
 * Both redirects apply to every spelling of an import, including the relative
 * ones, because they are matched on the resolved file path.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFLINE_VERSION, auditBranding, patchManifest, stripBrandUrls } from "./identity.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(here, "../..");
const app = path.join(repo, "apps/vscode");
const offline = path.join(here, "offline");
const out = path.join(here, "dist/offline-vscode");

const require_ = createRequire(path.join(app, "package.json"));
const esbuild = require_("esbuild");

const ALIASES = {
  "@": path.join(app, "src"),
  "@api": path.join(app, "src/core/api"),
  "@core": path.join(app, "src/core"),
  "@generated": path.join(app, "src/generated"),
  "@hosts": path.join(app, "src/hosts"),
  "@integrations": path.join(app, "src/integrations"),
  "@packages": path.join(app, "src/packages"),
  "@services": path.join(app, "src/services"),
  "@shared": path.join(app, "src/shared"),
  "@utils": path.join(app, "src/utils"),
};

const REDIRECTS = new Map([
  [path.join(app, "src/shared/net.ts"), path.join(offline, "net-guard.ts")],
  [path.join(app, "src/services/telemetry/TelemetryProviderFactory.ts"), path.join(offline, "stubs/telemetry-provider-factory.ts")],
  [path.join(app, "src/services/error/ErrorProviderFactory.ts"), path.join(offline, "stubs/error-provider-factory.ts")],
  [path.join(app, "src/services/telemetry/providers/posthog/PostHogClientProvider.ts"), path.join(offline, "stubs/posthog-client-provider.ts")],
  [path.join(app, "src/services/browser/BrowserSession.ts"), path.join(offline, "stubs/browser-session.ts")],
  [path.join(app, "src/services/browser/BrowserDiscovery.ts"), path.join(offline, "stubs/browser-discovery.ts")],
  [path.join(app, "src/services/browser/utils.ts"), path.join(offline, "stubs/browser-utils.ts")],
  [path.join(app, "src/services/browser/UrlContentFetcher.ts"), path.join(offline, "stubs/url-content-fetcher.ts")],
  [path.join(repo, "sdk/packages/core/src/services/feature-flags/cline-account-feature-flags.ts"), path.join(offline, "stubs/cline-account-feature-flags.ts")],
  // `@cline/core` resolves to its compiled barrel, so the same two modules also
  // have to be redirected at their dist location.
  [path.join(repo, "sdk/packages/core/dist/services/feature-flags/cline-account-feature-flags.js"), path.join(offline, "stubs/cline-account-feature-flags.ts")],
  [path.join(repo, "sdk/packages/core/dist/services/feature-flags/posthog.js"), path.join(offline, "stubs/sdk-core-posthog-flags.ts")],
  [path.join(app, "src/services/feature-flags/FeatureFlagsProviderFactory.ts"), path.join(offline, "stubs/feature-flags-provider-factory.ts")],
]);

function redirectPackage(upstream, replacement) {
  // `@cline/*` resolves to the compiled barrel, but a source build resolves the
  // same modules under `src`; register both so the table works either way.
  const [pkg, ...rest] = upstream.split("/");
  const tail = rest.join("/");
  REDIRECTS.set(path.join(repo, `sdk/packages/${pkg}/dist/${tail}.js`), path.join(offline, replacement));
  REDIRECTS.set(path.join(repo, `sdk/packages/${pkg}/src/${tail}.ts`), path.join(offline, replacement));
}

// Cloud model gateways and hosted tracing. The Settings UI keeps listing the
// providers; selecting one reports a local error instead of connecting, and the
// vendor SDK trees stay out of the bundle.
for (const vendor of ["anthropic", "bedrock", "google", "vertex", "cline", "community"]) {
  redirectPackage(`llms/providers/vendors/${vendor}`, "stubs/cloud-provider.ts");
}
for (const service of ["langfuse-telemetry", "langfuse-stream-telemetry", "LangfuseAttributesSpanProcessor"]) {
  redirectPackage(`llms/services/${service}`, "stubs/langfuse-telemetry.ts");
}

// Cloud SDKs that `@cline/llms` and `@cline/core` import by package name. They
// ship inside those bundles, so their vendor modules cannot be redirected
// individually; the npm specifier can. Model SDKs report a local error when
// used, telemetry SDKs stay silent because they can be touched at import time.
const PACKAGE_STUBS = [
  { prefix: "@ai-sdk/anthropic", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@ai-sdk/google", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@ai-sdk/amazon-bedrock", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@ai-sdk/otel", stub: "stubs/cloud-sdk-noop.cjs" },
  { prefix: "@aws-sdk/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@aws/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@smithy/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@sap/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@sap-ai-sdk/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@sap-cloud-sdk/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "google-auth-library", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@openrouter/", stub: "stubs/cloud-sdk-throw.cjs" },
  { prefix: "@langfuse/", stub: "stubs/cloud-sdk-noop.cjs" },
  { prefix: "@opentelemetry/exporter", stub: "stubs/cloud-sdk-noop.cjs" },
  { prefix: "@opentelemetry/sdk-", stub: "stubs/cloud-sdk-noop.cjs" },
  { prefix: "@opentelemetry/otlp", stub: "stubs/cloud-sdk-noop.cjs" },
  { prefix: "@opentelemetry/resources", stub: "stubs/cloud-sdk-noop.cjs" },
];

function packageStub(specifier) {
  for (const entry of PACKAGE_STUBS) {
    const prefix = entry.prefix.replace(/\/$/, "");
    if (specifier === prefix || specifier.startsWith(entry.prefix)) return path.join(offline, entry.stub);
  }
  return undefined;
}

const GUARDED = new Set(["net", "tls", "dns", "dgram", "http", "https"]);
const WRAPPERS = Object.fromEntries([...GUARDED].map((name) => [name, path.join(offline, "node", `${name}.ts`)]));

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

function probe(candidate) {
  if (fs.existsSync(candidate)) {
    if (fs.statSync(candidate).isDirectory()) {
      for (const ext of EXTS) {
        const index = path.join(candidate, `index${ext}`);
        if (fs.existsSync(index)) return index;
      }
      return undefined;
    }
    return candidate;
  }
  for (const ext of EXTS) if (fs.existsSync(candidate + ext)) return candidate + ext;
  return undefined;
}

/** Resolve alias/relative specifiers ourselves so the redirect table can match by file. */
function resolveLocal(specifier, importerDir) {
  for (const [alias, root] of Object.entries(ALIASES)) {
    if (specifier === alias || specifier.startsWith(`${alias}/`)) {
      return probe(path.join(root, specifier.slice(alias.length)));
    }
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return probe(path.resolve(importerDir ?? app, specifier));
  }
  return undefined;
}

const offlineGuards = {
  name: "cline-local-offline",
  setup(build) {
    const resolving = new Set();
    build.onResolve({ filter: /^(node:)?(net|tls|dns|dgram|http|https)$/, namespace: "file" }, (args) => {
      const bare = args.path.replace(/^node:/u, "");
      if (!GUARDED.has(bare)) return undefined;
      // Our own modules always use the real builtins; the guarded wrappers exist
      // for the upstream code in the bundle. Without this the wrappers would
      // resolve to each other and create an initialisation cycle.
      if (args.importer.startsWith(offline)) return undefined;
      return { path: WRAPPERS[bare] };
    });
    build.onResolve({ filter: /.*/, namespace: "file" }, async (args) => {
      // esbuild reports importers relative to absWorkingDir; make it absolute
      // so relative specifiers resolve against the right directory.
      const importer = path.isAbsolute(args.importer) ? args.importer : path.resolve(app, args.importer);
      const importerDir = path.dirname(importer);
      const resolved = resolveLocal(args.path, importerDir);
      if (resolved) {
        const redirect = REDIRECTS.get(resolved);
        return redirect ? { path: redirect } : undefined;
      }
      const stub = packageStub(args.path);
      if (stub) return { path: stub };
      // Package subpaths (for example the lazily imported
      // `@cline/core/services/feature-flags/posthog`) need the real resolver to
      // follow the package's exports map before the table can be consulted.
      if (!args.path.startsWith("@cline/")) return undefined;
      const key = `${args.importer}\u0000${args.path}`;
      if (resolving.has(key)) return undefined;
      resolving.add(key);
      let found;
      try {
        found = await build.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          namespace: "file",
          resolveDir: importerDir,
        });
      } finally {
        resolving.delete(key);
      }
      const redirect = found?.path ? REDIRECTS.get(found.path) : undefined;
      return redirect ? { path: redirect } : undefined;
    });
  },
};

// Modules that must never reach the bundle: analytics, tracing exporters, error
// reporting, browser automation and cloud model SDKs whose endpoints are always
// public.
const FORBIDDEN = [
  "posthog-node",
  "@posthog/",
  "puppeteer-core",
  "chromium-bidi",
  "@puppeteer/",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/otel",
  "@aws-sdk/",
  "@aws/",
  "@smithy/",
  "@sap/",
  "@sap-ai-sdk/",
  "@sap-cloud-sdk/",
  "google-auth-library",
  "@openrouter/",
  "@langfuse/",
  "@opentelemetry/sdk-",
  "@opentelemetry/otlp",
  "@opentelemetry/exporter",
  "@opentelemetry/resources",
];

// Third-party code that stays real but cannot connect anywhere: the OpenTelemetry
// API surface carries no transport of its own, and the address policy denies
// every public host.
const PENDING = [
  "@opentelemetry/api",
  "@opentelemetry/core",
  "@opentelemetry/semantic-conventions",
  "@opentelemetry/context-async-hooks",
  "@opentelemetry/propagator-",
];

function matches(input, packages) {
  return packages.some((pkg) => {
    const bare = pkg.replace(/\/$/, "");
    return input.includes(`node_modules/${pkg}`) || input.includes(`node_modules/.bun/${bare}@`) || input.includes(`node_modules/${bare}/`);
  });
}

function audit(metafile) {
  const inputs = Object.keys(metafile.inputs);
  const problems = [];
  const pending = new Set();
  for (const input of inputs) {
    if (matches(input, FORBIDDEN)) problems.push(`${input} (network service module)`);
    if (matches(input, PENDING)) pending.add(input);
    if (input.startsWith("apps/") && !input.startsWith("apps/local-only/")) problems.push(`${input} (online app module)`);
    if (input.startsWith("sdk/") && !/^sdk\/packages\/(?:shared|llms|core|agents|ui|sdk)\//u.test(input)) problems.push(`${input} (unexpected sdk package)`);
  }
  if (problems.length > 0) {
    const unique = [...new Set(problems)].sort();
    throw new Error(
      `Offline bundle audit failed with ${unique.length} module(s):\n${unique.slice(0, 40).join("\n")}${unique.length > 40 ? "\n..." : ""}`,
    );
  }
  return { inputs, pending: [...pending].sort() };
}

async function main() {
  const pluginRuntime = path.join(repo, "sdk/packages/core/dist/plugin-runtime");
  if (!fs.existsSync(path.join(pluginRuntime, "plugin-sandbox-bootstrap.js"))) {
    throw new Error(`${pluginRuntime} not found; run "bun run build:sdk" first.`);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.cpSync(pluginRuntime, path.join(out, "plugin-runtime"), { recursive: true });

  // Upstream ships an on-premise endpoints file for enterprise deployments and
  // switches to "self-hosted" mode when it finds one: telemetry, error reporting
  // and remote feature flags then stay off by the upstream mechanism. Pointing
  // the three endpoints at a closed loopback port means no configuration in the
  // package contains a public address, and a missed call fails instantly.
  await fs.promises.writeFile(
    path.join(out, "endpoints.json"),
    `${JSON.stringify({ appBaseUrl: "http://127.0.0.1:1", apiBaseUrl: "http://127.0.0.1:1", mcpBaseUrl: "http://127.0.0.1:1/v1/mcp" }, null, 2)}\n`,
  );

  // Upstream derives every command and view ID from its own package.json name,
  // so the product rename happens here as well as in the packaged manifest:
  // the bundle imports this patched copy instead of apps/vscode/package.json.
  const localVersion = OFFLINE_VERSION;
  const { manifest } = patchManifest(JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")), localVersion);
  const identityFile = path.join(out, "package.identity.json");
  await fs.promises.writeFile(identityFile, `${JSON.stringify(manifest, null, 2)}\n`);
  REDIRECTS.set(path.join(app, "package.json"), identityFile);

  const result = await esbuild.build({
    absWorkingDir: app,
    bundle: true,
    minify: process.argv.includes("--minify"),
    sourcemap: false,
    logLevel: "warning",
    metafile: true,
    tsconfig: path.join(app, "tsconfig.json"),
    // The offline sources live in apps/local-only but compile against the
    // extension's dependency tree (undici, zod, ...).
    nodePaths: [path.join(app, "node_modules"), path.join(repo, "node_modules")],
    define: {
      "import.meta.url": "_importMetaUrl",
      "process.env.IS_STANDALONE": JSON.stringify("false"),
      "process.env.IS_DEV": JSON.stringify("false"),
      "process.env.CLINE_ROLLOUT_VARIANT": JSON.stringify(""),
      // Marks the offline distribution: it tightens the webview CSP to packaged
      // resources, because the webview is a browser context the Node-side
      // address policy cannot cover.
      "process.env.CLINE_LOCAL_OFFLINE": JSON.stringify("true"),
      // Telemetry can never be switched on later by an environment variable:
      // these are inlined, so the OpenTelemetry provider is never constructed.
      "process.env.CLINE_ENVIRONMENT": JSON.stringify("selfHosted"),
      "process.env.OTEL_TELEMETRY_ENABLED": JSON.stringify("false"),
      "process.env.OTEL_METRICS_EXPORTER": JSON.stringify("none"),
      "process.env.OTEL_TRACES_EXPORTER": JSON.stringify("none"),
      "process.env.OTEL_LOGS_EXPORTER": JSON.stringify("none"),
      "process.env.TELEMETRY_SERVICE_API_KEY": JSON.stringify(""),
      "process.env.ERROR_SERVICE_API_KEY": JSON.stringify(""),
    },
    plugins: [offlineGuards],
    format: "cjs",
    platform: "node",
    target: "node22.15",
    sourcesContent: false,
    entryPoints: [path.join(offline, "entry.ts")],
    outfile: path.join(out, "extension.js"),
    external: ["vscode"],
    banner: { js: "const _importMetaUrl=require('url').pathToFileURL(__filename)" },
  });

  if (process.env.LOCAL_OFFLINE_META) {
    await fs.promises.writeFile(process.env.LOCAL_OFFLINE_META, JSON.stringify(result.metafile));
  }

  // Remove upstream site links from the compiled extension: every one of them
  // would open an external browser, which is the internet. Done after the fact
  // so the upstream source stays untouched.
  const bundleFile = path.join(out, "extension.js");
  const compiled = await fs.promises.readFile(bundleFile, "utf8");
  const stripped = stripBrandUrls(compiled);
  if (stripped.code !== compiled) await fs.promises.writeFile(bundleFile, stripped.code);
  const removed = Object.entries(stripped.counts).filter(([, count]) => count > 0);
  if (removed.length > 0) {
    console.log(`Removed upstream URLs from the extension bundle: ${removed.map(([url, n]) => `${url} ×${n}`).join(", ")}.`);
  }
  const brandingProblems = auditBranding(stripped.code);
  if (brandingProblems.length > 0) {
    throw new Error(`Offline branding audit failed:\n${brandingProblems.join("\n")}`);
  }
  const { inputs, pending } = audit(result.metafile);
  await fs.promises.writeFile(
    path.join(out, "extension.inputs.json"),
    `${JSON.stringify({ inputs: inputs.sort(), unreachableCloudSdksStillBundled: pending }, null, 2)}\n`,
  );
  const bytes = fs.statSync(path.join(out, "extension.js")).size;
  console.log(
    `Offline extension bundle: ${inputs.length} modules, ${(bytes / 1024 / 1024).toFixed(1)} MiB; audit passed (no analytics, tracing, error reporting, browser automation or cloud vendor SDKs).`,
  );
  if (pending.length > 0) {
    const roots = [...new Set(pending.map((input) => input.match(/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/)?.[1]))];
    console.log(`Note: ${pending.length} transport-free modules remain (${roots.join(", ")}); they cannot open a connection.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
