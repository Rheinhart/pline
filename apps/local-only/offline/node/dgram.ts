/**
 * Guarded `node:dgram` for the offline bundle.
 *
 * UDP is how a quiet DNS or SSDP leak happens, so every send is checked. A
 * bound socket is not enough: the destination of each datagram is verified.
 */

import * as realDgram from "node:dgram";
import { assertAddressAllowed, normalizeHost } from "../net-policy";

export * from "node:dgram";

type SendArgs = unknown[];

function targetOf(args: SendArgs): { host?: string; port?: number } {
  // send(msg, port, host[, cb]) | send(msg, { port, address }[, cb]) | send(msg, cb)
  const [first, second, third] = args;
  if (second && typeof second === "object" && !Array.isArray(second)) {
    const options = second as { port?: number; address?: string; host?: string };
    return { host: options.address ?? options.host, port: options.port };
  }
  if (typeof second === "number") {
    return { port: second, host: typeof third === "string" ? third : "127.0.0.1" };
  }
  return {};
}

function check(args: SendArgs): void {
  const { host, port } = targetOf(args);
  if (host === "255.255.255.255" || host === "::" || normalizeHost(host ?? "") === "224.0.0.1") {
    throw new Error(`Broadcast/multicast to ${host} is disabled in this build.`);
  }
  if (host !== undefined) assertAddressAllowed(host, port);
}

function guardSocket(socket: realDgram.Socket): realDgram.Socket {
  const original = socket.send.bind(socket) as unknown as (...args: unknown[]) => unknown;
  (socket as { send: unknown }).send = (...args: unknown[]) => {
    check(args);
    return original(...args);
  };
  return socket;
}

export const createSocket = ((...args: unknown[]) =>
  guardSocket((realDgram.createSocket as unknown as (...inner: unknown[]) => realDgram.Socket)(...args))) as typeof realDgram.createSocket;

export default { ...realDgram, createSocket };
