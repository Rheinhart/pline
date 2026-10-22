/**
 * Offline replacement for `@shared/net`.
 *
 * The build aliases `@/shared/net` (and the `@shared/net` spellings) to this
 * module, so every importer in the extension bundle gets a fetch that can only
 * reach the local network: no proxies, no redirects, no idle timeouts, and a
 * policy check that runs before the request body is produced.
 *
 * The exported surface mirrors `src/shared/net.ts` on purpose, so no upstream
 * file has to change.
 */

import { Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from "undici";
import { assertUrlAllowed, getNetworkOptions, normalizeHost } from "./net-policy";
import { internalCa, pinnedCheckServerIdentity } from "./node/tls-options";

type FetchFunction = (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>;

let mockFetch: FetchFunction | undefined;
let dispatcher: Dispatcher | undefined;

function getDispatcher(): Dispatcher {
  if (dispatcher) return dispatcher;
  const ca = internalCa();
  const connector = buildConnector({
    ca,
    // Verification is never disabled in this build.
    rejectUnauthorized: true,
    checkServerIdentity: getNetworkOptions().pinSha256 ? pinnedCheckServerIdentity() : undefined,
    allowH2: true,
  });
  dispatcher = new Agent({
    // A local model can spend minutes between headers and the first token
    // (cline/cline#13371); cancellation stays with the AbortSignal.
    headersTimeout: 0,
    bodyTimeout: 0,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connect: connector as unknown as Dispatcher.ConnectOptions,
  });
  return dispatcher;
}

function urlOf(input: string | URL | Request): string | undefined {
  try {
    if (typeof input === "string") return new URL(input).href;
    if (input instanceof URL) return input.href;
    return input.url;
  } catch {
    return undefined;
  }
}

function check(input: string | URL | Request): void {
  const href = urlOf(input);
  if (!href) throw new Error(`Offline build: cannot resolve the request target ${String(input).slice(0, 120)}.`);
  assertUrlAllowed(href);
}

function run(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (mockFetch) return mockFetch(input, init);
  // Reject (never throw synchronously) so callers see a normal failed promise.
  try {
    check(input);
  } catch (error) {
    return Promise.reject(error);
  }
  return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...init,
    // A redirect would mean a destination nobody configured.
    redirect: init?.redirect === "follow" || init?.redirect === undefined ? "error" : init.redirect,
    dispatcher: getDispatcher(),
  } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

export const fetch: typeof globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
  run(input, init)) as typeof globalThis.fetch;

/** Same transport as `fetch`; kept as a separate export for API parity. */
export const fetchWithoutIdleTimeouts: typeof globalThis.fetch = fetch;

export function mockFetchForTesting<T>(theFetch: FetchFunction, callback: () => T): T {
  const originalMockFetch = mockFetch;
  mockFetch = theFetch;
  let willResetSync = true;
  try {
    const result = callback();
    if (result instanceof Promise) {
      willResetSync = false;
      return result.finally(() => {
        mockFetch = originalMockFetch;
      }) as typeof result;
    }
    return result;
  } finally {
    if (willResetSync) mockFetch = originalMockFetch;
  }
}

export function getAxiosSettings(): {
  adapter?: unknown;
  fetch?: typeof globalThis.fetch;
  maxBodyLength?: number;
  maxContentLength?: number;
} {
  return {
    adapter: "fetch" as unknown as undefined,
    fetch,
    maxBodyLength: Number.POSITIVE_INFINITY,
    maxContentLength: Number.POSITIVE_INFINITY,
  };
}

/** Test helper: report whether a host would be reachable under the policy. */
export function isReachableHost(host: string): boolean {
  try {
    assertUrlAllowed(`https://${normalizeHost(host).includes(":") ? `[${host}]` : host}`);
    return true;
  } catch {
    return false;
  }
}
