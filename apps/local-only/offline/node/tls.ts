/**
 * Guarded `node:tls` for the offline bundle.
 *
 * Verification always stays on, the operator's internal CA is appended to the
 * system roots, and an optional SPKI pin is checked after the handshake so a
 * man in the middle (a captive-portal box, an inspection device on the VLAN)
 * cannot substitute its own certificate.
 */

import * as realTls from "node:tls";
import { assertAddressAllowed, getNetworkOptions } from "../net-policy";
import { targetFromConnectArgs } from "./args";
import { privateLookup } from "./dns-lookup";
import { decorateTlsOptions, pinOfCertificate } from "./tls-options";

export * from "node:tls";
export { internalCa, pinnedCheckServerIdentity, pinOfCertificate } from "./tls-options";

function enforcePin(socket: realTls.TLSSocket): void {
  const { pinSha256 } = getNetworkOptions();
  if (!pinSha256) return;
  socket.once("secureConnect", () => {
    const certificate = socket.getPeerX509Certificate();
    const actual = certificate ? pinOfCertificate(certificate) : undefined;
    if (actual !== pinSha256) {
      const error = new Error(
        `Certificate pin mismatch for ${socket.remoteAddress ?? "endpoint"}: expected sha256/${pinSha256}, got sha256/${actual ?? "unknown"}. Nothing was sent.`,
      );
      socket.destroy(error);
      socket.emit("error", error);
    }
  });
}

function decorate(options: Record<string, unknown>): Record<string, unknown> {
  const next = decorateTlsOptions(options);
  if (getNetworkOptions().allowLanDns) next.lookup = next.lookup ?? privateLookup;
  return next;
}

function guard(args: unknown[]): unknown[] {
  const target = targetFromConnectArgs(args);
  if (!target.pipe) assertAddressAllowed(target.host, target.port);
  const optionsIndex = args.findIndex((arg) => arg && typeof arg === "object" && !Array.isArray(arg));
  if (optionsIndex >= 0) {
    return args.map((arg, index) => (index === optionsIndex ? decorate(arg as Record<string, unknown>) : arg));
  }
  return args;
}

export const connect = ((...args: unknown[]) => {
  const socket = (realTls.connect as unknown as (...inner: unknown[]) => realTls.TLSSocket)(...guard(args));
  enforcePin(socket);
  return socket;
}) as unknown as typeof realTls.connect;

export const createConnection = connect as typeof realTls.createConnection;
export const checkServerIdentity = realTls.checkServerIdentity;
export const ROOT_CERTIFICATES = realTls.rootCertificates;
export const Server = realTls.Server;
export const TLSSocket = realTls.TLSSocket;

export default { ...realTls, connect, createConnection };
