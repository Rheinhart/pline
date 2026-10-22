/**
 * Guarded `node:net` for the offline bundle.
 *
 * Only code compiled into the Cline Local bundle sees this module: the build
 * aliases the `net` / `node:net` specifiers to it, so the VS Code extension
 * host and any other extension keep Node's own implementation.
 */

import * as realNet from "node:net";
import { assertAddressAllowed, getNetworkOptions, registerSocketGuardEnabler } from "../net-policy";
import { targetFromConnectArgs, withLookup } from "./args";
import { privateLookup } from "./dns-lookup";

export * from "node:net";

function guard(args: unknown[]): unknown[] {
  const target = targetFromConnectArgs(args);
  if (target.pipe) return args;
  assertAddressAllowed(target.host, target.port);
  const [first, ...rest] = args;
  if (first && typeof first === "object" && !Array.isArray(first) && getNetworkOptions().allowLanDns) {
    return [withLookup(first as Record<string, unknown>, privateLookup), ...rest];
  }
  return args;
}

function wrap(fn: unknown): unknown {
  return (...args: unknown[]) => (fn as (...inner: unknown[]) => unknown)(...guard(args));
}

export const connect = wrap(realNet.connect) as unknown as typeof realNet.connect;
export const createConnection = wrap(realNet.createConnection) as unknown as typeof realNet.createConnection;

if (getNetworkOptions().strictSockets) {
  applyStrictSocketGuard();
}

/**
 * Opt-in and process wide: meant for the standalone core process, where no
 * other extension shares the module cache. Off by default inside the extension
 * host, where patching `Socket.prototype` would also affect other extensions.
 */
export function applyStrictSocketGuard(): void {
  const original = realNet.Socket.prototype.connect;
  if ((original as unknown as { clineLocalGuarded?: boolean }).clineLocalGuarded) return;
  const guarded = function (this: realNet.Socket, ...args: unknown[]) {
    guard(args);
    return original.apply(this, args as never);
  } as unknown as typeof original & { clineLocalGuarded: boolean };
  guarded.clineLocalGuarded = true;
  realNet.Socket.prototype.connect = guarded;
}

registerSocketGuardEnabler(applyStrictSocketGuard);

export default { ...realNet, connect, createConnection };
