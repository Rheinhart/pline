/**
 * Guarded `node:https` for the offline bundle.
 */

import * as realHttps from "node:https";
import { getNetworkOptions } from "../net-policy";
import { assertRequestTarget } from "./http-target";
import { privateLookup } from "./dns-lookup";
import { decorateTlsOptions } from "./tls-options";

export * from "node:https";

function decorate(args: unknown[]): unknown[] {
  const index = args.findIndex((arg) => arg && typeof arg === "object" && !(arg instanceof URL));
  if (index < 0) return args;
  const options = args[index] as Record<string, unknown>;
  const next = decorateTlsOptions(options);
  if (getNetworkOptions().allowLanDns) next.lookup = next.lookup ?? privateLookup;
  return args.map((arg, position) => (position === index ? next : arg));
}

function wrap(fn: unknown): unknown {
  return (...args: unknown[]) => {
    assertRequestTarget(args, "https:");
    return (fn as (...inner: unknown[]) => unknown)(...decorate(args));
  };
}

export const request = wrap(realHttps.request) as typeof realHttps.request;
export const get = wrap(realHttps.get) as typeof realHttps.get;

export default { ...realHttps, request, get };
