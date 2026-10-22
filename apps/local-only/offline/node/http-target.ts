/**
 * Destination checks shared by the guarded `http`/`https` wrappers.
 */

import { assertUrlAllowed } from "../net-policy";

/**
 * Reconstruct the destination of a `request()`/`get()` call and run it through
 * the URL policy. Unknown shapes are allowed to pass: they still hit the
 * guarded `net`/`tls` layer at connect time.
 */
export function assertRequestTarget(args: readonly unknown[], protocol: "http:" | "https:"): void {
  const [first, second] = args;
  if (typeof first === "string") {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(first)) {
      assertUrlAllowed(first);
      return;
    }
    if (second && typeof second === "object") {
      assertRequestTarget([second], protocol);
      return;
    }
    // A bare path with no options resolves to localhost in Node.
    assertUrlAllowed(`${protocol}//127.0.0.1`);
    return;
  }
  if (first instanceof URL) {
    assertUrlAllowed(first);
    return;
  }
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const options = first as { protocol?: string; host?: string; hostname?: string; port?: number | string; path?: string; socketPath?: string };
    if (options.socketPath) return; // unix/named pipe stays on this machine
    const scheme = (options.protocol ?? protocol).replace(/:$/, "") as "http" | "https";
    const host = options.host || options.hostname || "127.0.0.1";
    const port = options.port === undefined || options.port === "" ? "" : `:${options.port}`;
    assertUrlAllowed(`${scheme}://${wrapIpv6(String(host))}${port}${options.path ?? "/"}`);
  }
}

function wrapIpv6(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
