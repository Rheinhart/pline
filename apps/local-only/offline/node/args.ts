/**
 * Shared argument inspection for the guarded `node:*` wrappers.
 *
 * Node's connect-style APIs accept several argument shapes; these helpers find
 * the destination in each of them without changing the call, so the guarded
 * wrapper can hand the original arguments straight through afterwards.
 */

export type ConnectTarget = { host?: string; port?: number; pipe?: boolean; named?: boolean };

function isPortLike(value: string): boolean {
  return /^\d+$/.test(value);
}

export function targetFromConnectArgs(args: readonly unknown[]): ConnectTarget {
  const [first, second] = args;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const options = first as { host?: string; port?: number; path?: string };
    if (typeof options.path === "string" && options.path.length > 0) return { pipe: true };
    return { host: typeof options.host === "string" ? options.host : undefined, port: typeof options.port === "number" ? options.port : undefined };
  }
  if (typeof first === "number") {
    if (typeof second === "string" && !isPortLike(second)) return { host: second, port: first };
    return { host: "127.0.0.1", port: first };
  }
  if (typeof first === "string") {
    if (isPortLike(first)) {
      const host = typeof second === "string" && !isPortLike(second) ? second : "127.0.0.1";
      return { host, port: Number(first) };
    }
    return { pipe: true }; // unix socket / named pipe path
  }
  return {};
}

/** Replace or install a validating `lookup` in an options object. */
export function withLookup(options: Record<string, unknown>, lookup: unknown): Record<string, unknown> {
  if (typeof options.lookup === "function") return options;
  return { ...options, lookup };
}

export type AnyFn = (...args: unknown[]) => unknown;

export function isFunction(value: unknown): value is AnyFn {
  return typeof value === "function";
}
