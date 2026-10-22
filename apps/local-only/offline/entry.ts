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

function install(): void {
  if (installed) return;
  installed = true;
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
