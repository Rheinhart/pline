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
      // The wrappers themselves must reach the real builtins, otherwise they
      // would resolve to each other.
      if (path.dirname(args.importer) === path.join(offline, "node")) return undefined;
      return { path: WRAPPERS[bare] };
    });
    build.onResolve({ filter: /^[.@]/, namespace: "file" }, async (args) => {
      // esbuild reports importers relative to absWorkingDir; make it absolute
      // so relative specifiers resolve against the right directory.
      const importer = path.isAbsolute(args.importer) ? args.importer : path.resolve(app, args.importer);
      const importerDir = path.dirname(importer);
      const resolved = resolveLocal(args.path, importerDir);
      if (resolved) {
        const redirect = REDIRECTS.get(resolved);
        return redirect ? { path: redirect } : undefined;
      }
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

// Anything that can open a socket to a third party on its own must be gone:
// analytics, tracing, error reporting, browser automation and cloud SDKs whose
// endpoints are always public.
const FORBIDDEN = [
  "posthog-node",
  "@posthog/",
];

// Remote model gateways that are still reachable through the upstream provider
// registry. They cannot connect (the policy denies their public hosts), but the
// provider allowlist step will drop the code itself; the count is reported so
// this does not get forgotten.
const PENDING = [
  "@aws-sdk/",
  "@aws/",
  "@smithy/",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/google-vertex",
  "@ai-sdk/amazon-bedrock",
  "@openrouter/",
  "@opentelemetry/api",
  "@opentelemetry/core",
  "@opentelemetry/semantic-conventions",
  "@opentelemetry/context-async-hooks",
  "@opentelemetry/propagator-",
  // Tracing exporters are still reachable code, but the build inlines
  // OTEL_TELEMETRY_ENABLED=false (see `define`), so no provider or exporter is
  // ever constructed and nothing is scheduled for delivery.
  "@opentelemetry/sdk-",
  "@opentelemetry/otlp",
  "@opentelemetry/exporter",
  "@opentelemetry/resources",
  "@opentelemetry/instrumentation",
  // Remote model gateways reached through the `@cline/llms` barrel. The
  // provider allowlist step removes them; until then the address policy keeps
  // them unreachable, and the audit prints how many modules are still present.
  "@langfuse/",
  "@ai-sdk/otel",
  "google-auth-library",
  "@sap/",
  "@sap-ai-sdk/",
  "@sap-cloud-sdk/",
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
    console.log(`Note: ${pending.length} modules of remote model gateway SDKs are still bundled (${roots.join(", ")}); they cannot connect under this policy and are scheduled for removal with the provider allowlist.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
