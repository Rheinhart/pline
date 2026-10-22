/**
 * TLS hardening shared by the guarded `tls`/`https` wrappers.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as realTls from "node:tls";
import { getNetworkOptions } from "../net-policy";

let caCache: { path: string; pem: string } | undefined;

export function internalCa(): string[] | undefined {
  const { caCertPath } = getNetworkOptions();
  if (!caCertPath) return undefined;
  if (!caCache || caCache.path !== caCertPath) {
    caCache = { path: caCertPath, pem: fs.readFileSync(caCertPath, "utf8") };
  }
  return [...realTls.rootCertificates, caCache.pem];
}

export function pinOfCertificate(certificate: crypto.X509Certificate): string | undefined {
  if (!certificate.publicKey) return undefined;
  return crypto.createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
}

/** `checkServerIdentity` that also verifies the configured SPKI pin. */
export function pinnedCheckServerIdentity(): (host: string, cert: realTls.PeerCertificate) => Error | void {
  const { pinSha256 } = getNetworkOptions();
  return (host, cert) => {
    const standard = realTls.checkServerIdentity(host, cert);
    if (standard) return standard;
    if (!pinSha256) return undefined;
    let actual: string | undefined;
    try {
      if (cert.raw) actual = pinOfCertificate(new crypto.X509Certificate(cert.raw));
    } catch {
      actual = undefined;
    }
    if (actual !== pinSha256) {
      return new Error(
        `Certificate pin mismatch for ${host}: expected sha256/${pinSha256}, got sha256/${actual ?? "unknown"}. Nothing was sent.`,
      );
    }
    return undefined;
  };
}

/** Apply the offline TLS defaults to an options object. */
export function decorateTlsOptions(options: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...options };
  const ca = internalCa();
  if (ca) next.ca = next.ca ?? ca;
  // Verification is never optional in this distribution.
  delete next.rejectUnauthorized;
  if (getNetworkOptions().pinSha256) {
    if (typeof next.checkServerIdentity !== "function") next.checkServerIdentity = pinnedCheckServerIdentity();
    else {
      const outer = next.checkServerIdentity as (host: string, cert: realTls.PeerCertificate) => Error | void;
      const pin = pinnedCheckServerIdentity();
      next.checkServerIdentity = (host, cert) => pin(host, cert) ?? outer(host, cert);
    }
  }
  return next;
}
