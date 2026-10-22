/**
 * Entry point of the offline (Cline Local) VS Code bundle.
 *
 * Everything upstream in `src/extension.ts` is kept as is; this wrapper only
 * installs the network policy before the original activation runs, and reports
 * blocked connections in the local Cline output channel.
 */

import { Logger } from "@/shared/services/Logger";
import * as upstream from "@/extension";
import { applyNetworkConfig } from "./network-settings";
import { onNetworkDenial } from "./net-policy";

let installed = false;

/**
 * Cline's own feature switches are read from the environment upstream. Inlining
 * them at build time covers the direct reads; this covers the `process?.env?.X`
 * spellings that a define cannot match, so a stray shell or CI variable cannot
 * re-enable telemetry, error reporting, object-storage upload or a cloud
 * environment. Only Cline-prefixed keys are touched, never proxy settings that
 * other extensions in the same host process might rely on.
 */
const MANAGED_ENV = [
  "CLINE_ENVIRONMENT",
  "CLINE_ENVIRONMENT_OVERRIDE",
  "CLINE_ROLLOUT_VARIANT",
  "OTEL_TELEMETRY_ENABLED",
  "OTEL_METRICS_EXPORTER",
  "OTEL_TRACES_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "TELEMETRY_SERVICE_API_KEY",
  "ERROR_SERVICE_API_KEY",
  "CLINE_STORAGE_ADAPTER",
  "CLINE_STORAGE_BUCKET",
  "CLINE_STORAGE_ENDPOINT",
  "CLINE_STORAGE_ACCESS_KEY_ID",
  "CLINE_STORAGE_SECRET_ACCESS_KEY",
  "CLINE_STORAGE_REGION",
  "CLINE_STORAGE_ACCOUNT_ID",
  "CLINE_STORAGE_SYNC_BACKFILL_ENABLED",
];

function install(): void {
  if (installed) return;
  installed = true;
  const cleared = MANAGED_ENV.filter((key) => process.env[key] !== undefined);
  for (const key of cleared) delete process.env[key];
  if (cleared.length > 0) {
    Logger.info(`[cline-local] ignored upstream switches from the environment: ${cleared.join(", ")}`);
  }
  try {
    for (const problem of applyNetworkConfig()) {
      Logger.warn(`[cline-local] network config: ${problem}`);
    }
  } catch (error) {
    Logger.error("[cline-local] Could not read the local network config; using the strict default policy.", error);
  }
  onNetworkDenial((message) => Logger.warn(`[cline-local] blocked connection: ${message}`));
  Logger.info("[cline-local] Internet access is disabled. Only loopback and private LAN addresses are reachable, and https is required off-loopback.");
}

export async function activate(context: unknown): Promise<void> {
  install();
  await (upstream.activate as (value: unknown) => Promise<void>)(context);
}

export async function deactivate(): Promise<void> {
  await (upstream.deactivate as () => Promise<void>)();
}

export { reportRolloutActivation } from "@/extension";
