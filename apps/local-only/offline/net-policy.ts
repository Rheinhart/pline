/**
 * Offline network policy for the Cline Local distribution.
 *
 * The extension host bundle resolves every outbound connection through the
 * guarded `node:*` wrappers in this directory, so this module is the single
 * place that decides whether a destination is reachable. It is deliberately
 * static: a destination is allowed because it is a private address, not
 * because somebody typed it into a settings field.
 *
 * Data flow: nothing here ever performs I/O, so a denial happens before any
 * request body (i.e. source code) can be handed to the operating system.
 */

import { BlockList, isIP } from "node:net";

export type Protocol = "http:" | "https:";

export interface NetworkOptions {
  /** Allow plaintext HTTP to a private (non-loopback) address. Default false. */
  lanPlainHttp: boolean;
  /** Resolve hostnames through DNS, but only accept all-private answers. Default false. */
  allowLanDns: boolean;
  /** Treat 100.64.0.0/10 (Tailscale / carrier NAT) as private. Default true. */
  allowCgnat: boolean;
  /** PEM file with an internal CA used to verify the model endpoint. */
  caCertPath?: string;
  /** Base64 SHA-256 of the endpoint's SPKI, verified after the TLS handshake. */
  pinSha256?: string;
  /** Patch Socket.prototype.connect as well (process wide; use in a dedicated process). */
  strictSockets: boolean;
}

const DEFAULTS: NetworkOptions = {
  lanPlainHttp: false,
  allowLanDns: false,
  allowCgnat: true,
  strictSockets: false,
};

let options: NetworkOptions = { ...DEFAULTS };

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
// IPv6 unique local addresses (fc00::/7).
PRIVATE.addSubnet("fc00::", 7, "ipv6");

const CGNAT = new BlockList();
CGNAT.addSubnet("100.64.0.0", 10, "ipv4");

export class OfflineNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineNetworkError";
  }
}

export function setNetworkOptions(next: Partial<NetworkOptions>): void {
  options = { ...options, ...next };
}

export function getNetworkOptions(): Readonly<NetworkOptions> {
  return options;
}

const denials: string[] = [];
let sink: ((message: string) => void) | undefined;

/** Subscribe to denials so they can be shown in a local log. Returns an unsubscribe. */
export function onNetworkDenial(listener: (message: string) => void): () => void {
  sink = listener;
  for (const message of denials) listener(message);
  return () => {
    sink = undefined;
  };
}

function deny(message: string): never {
  if (!denials.includes(message)) denials.push(message);
  if (denials.length > 50) denials.shift();
  sink?.(message);
  throw new OfflineNetworkError(message);
}

/** Normalise a hostname into a canonical lowercase form without brackets. */
export function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/u, "");
}

export function isLoopbackHost(host: string): boolean {
  const name = normalizeHost(host);
  if (name === "localhost") return true;
  const family = isIP(name);
  if (family === 0) return false;
  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is checked against the IPv4 rules.
  const mapped = family === 6 ? name.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1] : undefined;
  const candidate = mapped ?? name;
  return LOOPBACK.check(candidate, isIP(candidate) === 6 ? "ipv6" : "ipv4");
}

export function isPrivateHost(host: string): boolean {
  const name = normalizeHost(host);
  if (isLoopbackHost(name)) return true;
  const family = isIP(name);
  if (family === 0) return false;
  const mapped = family === 6 ? name.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1] : undefined;
  const candidate = mapped ?? name;
  const kind = isIP(candidate) === 6 ? "ipv6" : "ipv4";
  if (PRIVATE.check(candidate, kind)) return true;
  if (options.allowCgnat && CGNAT.check(candidate, "ipv4")) return true;
  return false;
}

/**
 * Reject ambiguous spellings (`0177.0.0.1`, `0x7f.0.0.1`, trailing dots) so a
 * destination cannot be smuggled past the address rules by re-encoding it.
 */
function assertCanonicalAddress(name: string): void {
  if (isIP(name) === 4) {
    const parts = name.split(".");
    if (parts.length !== 4 || parts.some((part) => part === "" || (part.length > 1 && part.startsWith("0")) || Number(part) > 255)) {
      deny(`Use a canonical IPv4 address; "${name}" is ambiguous.`);
    }
  }
}

export type Target = { protocol: Protocol; host: string; port: number };

const DEFAULT_PORT: Record<Protocol, number> = { "http:": 80, "https:": 443 };

/**
 * The authority exactly as written, so an ambiguous spelling cannot be hidden
 * by the URL parser (`http://0177.0.0.1` is loopback to WHATWG but 177.0.0.1 to
 * anything that reads the digits as decimal).
 */
function rawHostOf(href: string): string | undefined {
  return /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]+)/iu.exec(href)?.[1];
}

/**
 * Check an absolute URL before a request is built. Throws before any body is
 * produced, so a denied request never leaks source code.
 */
export function assertUrlAllowed(value: string | URL): Target {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : value;
  } catch {
    return deny(`Not an absolute URL: ${String(value).slice(0, 120)}`);
  }
  const protocol = url.protocol as Protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return deny(`Only http(s) destinations are allowed, got ${protocol}`);
  }
  if (url.username || url.password) deny("URL credentials are not allowed; pass the model key in settings.");
  const raw = rawHostOf(typeof value === "string" ? value : url.href);
  if (raw !== undefined && normalizeHost(raw) !== normalizeHost(url.hostname)) {
    deny(`"${raw}" has an ambiguous address spelling; use a canonical IP address.`);
  }
  const host = normalizeHost(url.hostname);
  if (!host) deny(`URL ${url.href} has no host.`);
  assertPort(host, portOf(url));
  if (host !== "localhost" && isIP(host) === 0) {
    if (!options.allowLanDns) {
      deny(`DNS names are disabled; use a literal private IP instead of "${host}".`);
    }
  } else {
    assertCanonicalAddress(host);
    if (!isPrivateHost(host)) {
      deny(`${url.hostname} is not a loopback or private LAN address; this build never connects to the internet.`);
    }
    if (protocol === "http:" && !isLoopbackHost(host) && !options.lanPlainHttp) {
      deny(`Plaintext http to ${host} would expose your code on the LAN. Use https, or set lanPlainHttp in the local network config.`);
    }
  }
  return { protocol, host, port: portOf(url) };
}

function portOf(url: URL): number {
  if (url.port) return Number(url.port);
  return DEFAULT_PORT[url.protocol as Protocol] ?? 0;
}

function assertPort(host: string, port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) deny(`Invalid port for ${host || "destination"}.`);
  if (port === 0) deny("Port 0 is not a valid destination.");
}

/**
 * Check a connect-level target. `host` may be absent (default loopback) or a
 * pipe path (unix domain / named pipe), which is always local.
 */
export function assertAddressAllowed(host: string | undefined, port: number | undefined): void {
  if (host === undefined || host === null) return;
  if (host !== "" && !isIP(host) && host.includes("/")) return; // unix socket path
  const name = normalizeHost(host);
  if (name === "localhost" || isLoopbackHost(name)) return;
  if (name !== "localhost" && isIP(name) === 0) {
    if (!options.allowLanDns) deny(`DNS names are disabled; use a literal private IP instead of "${name}".`);
    return; // validated by the dns wrapper
  }
  assertCanonicalAddress(name);
  if (!isPrivateHost(name)) {
    deny(`${name} is not a loopback or private LAN address; this build never connects to the internet.`);
  }
  if (port !== undefined) assertPort(name, port);
}

/** Reject a DNS answer that contains anything outside the private ranges. */
export function assertLookupResult(hostname: string, addresses: readonly string[]): void {
  if (!options.allowLanDns && normalizeHost(hostname) !== "localhost") {
    deny(`DNS names are disabled; use a literal private IP instead of "${hostname}".`);
  }
  const bad = addresses.filter((address) => !isPrivateHost(address));
  if (bad.length > 0) {
    deny(`"${hostname}" resolves to ${bad.join(", ")}, which is not a private LAN address.`);
  }
}
