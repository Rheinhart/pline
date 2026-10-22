/**
 * Guarded `node:dns` for the offline bundle.
 *
 * With the default policy resolution is refused outright, so the machine never
 * asks a resolver (and therefore the network) about a name on our behalf.
 */

import * as realDns from "node:dns";
import { assertLookupResult, getNetworkOptions, normalizeHost } from "../net-policy";
import { privateLookup } from "./dns-lookup";

export * from "node:dns";

function refuse(name: string): void {
  if (!getNetworkOptions().allowLanDns && normalizeHost(name) !== "localhost") {
    // Reuse the assertion so the message and the log entry are identical.
    assertLookupResult(name, []);
  }
}

function wrapResolve<T extends (...args: never[]) => unknown>(fn: T): T {
  return ((...args: unknown[]) => {
    const [host, ...rest] = args as [string, ...unknown[]];
    if (typeof host === "string") refuse(host);
    const last = rest[rest.length - 1];
    if (typeof last === "function") {
      const callback = last as (error: Error | null, value?: unknown) => void;
      const checked = (error: Error | null, value?: unknown) => {
        if (!error && typeof host === "string" && Array.isArray(value)) {
          const addresses = (value as (string | { address?: string })[]).map((entry) =>
            typeof entry === "string" ? entry : entry?.address ?? "",
          );
          try {
            assertLookupResult(host, addresses.filter(Boolean));
          } catch (assertion) {
            callback(assertion as Error);
            return;
          }
        }
        callback(error, value);
      };
      return (fn as unknown as (...inner: unknown[]) => unknown)(host, ...rest.slice(0, -1), checked);
    }
    // Promise-returning form.
    const result = (fn as unknown as (...inner: unknown[]) => unknown)(host, ...rest) as Promise<unknown>;
    if (result instanceof Promise) {
      return result.then((value) => {
        if (typeof host === "string" && Array.isArray(value)) {
          const addresses = (value as (string | { address?: string })[]).map((entry) =>
            typeof entry === "string" ? entry : entry?.address ?? "",
          );
          assertLookupResult(host, addresses.filter(Boolean));
        }
        return value;
      });
    }
    return result;
  }) as unknown as T;
}

export const lookup = ((...args: unknown[]) => {
  const [host] = args as [string];
  if (typeof host === "string") refuse(host);
  return privateLookup(...(args as [string, unknown, never]));
}) as unknown as typeof realDns.lookup;

export const resolve = wrapResolve(realDns.resolve as never) as typeof realDns.resolve;
export const resolve4 = wrapResolve(realDns.resolve4 as never) as typeof realDns.resolve4;
export const resolve6 = wrapResolve(realDns.resolve6 as never) as typeof realDns.resolve6;
export const resolveAny = wrapResolve(realDns.resolveAny as never) as typeof realDns.resolveAny;
export const resolveCname = wrapResolve(realDns.resolveCname as never) as typeof realDns.resolveCname;
export const resolveMx = wrapResolve(realDns.resolveMx as never) as typeof realDns.resolveMx;
export const resolveNs = wrapResolve(realDns.resolveNs as never) as typeof realDns.resolveNs;
export const resolveTxt = wrapResolve(realDns.resolveTxt as never) as typeof realDns.resolveTxt;
export const resolveSrv = wrapResolve(realDns.resolveSrv as never) as typeof realDns.resolveSrv;
export const resolvePtr = wrapResolve(realDns.resolvePtr as never) as typeof realDns.resolvePtr;
export const resolveNaptr = wrapResolve(realDns.resolveNaptr as never) as typeof realDns.resolveNaptr;
export const resolveSoa = wrapResolve(realDns.resolveSoa as never) as typeof realDns.resolveSoa;
export const resolveCaa = wrapResolve(realDns.resolveCaa as never) as typeof realDns.resolveCaa;
export const reverse = wrapResolve(realDns.reverse as never) as typeof realDns.reverse;
export const getServers = realDns.getServers;
export const setServers = realDns.setServers;

export const promises = {
  ...realDns.promises,
  lookup: ((hostname: string, options?: unknown) => {
    refuse(hostname);
    return realDns.promises.lookup(hostname, options as never).then((value) => {
      const addresses = Array.isArray(value) ? value.map((entry) => entry.address) : [(value as { address?: string }).address ?? ""];
      assertLookupResult(hostname, addresses.filter(Boolean));
      return value;
    });
  }) as typeof realDns.promises.lookup,
  resolve: ((hostname: string) => {
    refuse(hostname);
    return realDns.promises.resolve(hostname).then((records) => {
      assertLookupResult(hostname, records);
      return records;
    });
  }) as typeof realDns.promises.resolve,
  resolve4: ((hostname: string, options?: unknown) => {
    refuse(hostname);
    return realDns.promises.resolve4(hostname, options as never).then((records) => {
      assertLookupResult(hostname, records);
      return records;
    });
  }) as typeof realDns.promises.resolve4,
  resolve6: ((hostname: string, options?: unknown) => {
    refuse(hostname);
    return realDns.promises.resolve6(hostname, options as never).then((records) => {
      assertLookupResult(hostname, records);
      return records;
    });
  }) as typeof realDns.promises.resolve6,
};

export default { ...realDns, lookup, resolve, promises };
