/**
 * Optional operator knobs for the offline build.
 *
 * The original Cline settings UI is kept untouched, so the few extra knobs
 * that a home/office LAN deployment needs (internal CA, certificate pin,
 * plaintext HTTP on a trusted segment, internal DNS) live in one small file
 * outside the workspace. Nothing here can widen the address policy to a
 * public destination.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { setNetworkOptions, type NetworkOptions } from "./net-policy";

export const NETWORK_CONFIG_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "cline-local",
  "network.json",
);

const KEYS = ["lanPlainHttp", "allowLanDns", "allowCgnat", "strictSockets"] as const;

function readOptions(): { options: Partial<NetworkOptions>; problems: string[] } {
  const problems: string[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(NETWORK_CONFIG_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      problems.push(`Could not read ${NETWORK_CONFIG_FILE}: ${(error as Error).message}`);
    }
    return { options: {}, problems };
  }
  try {
    const mode = fs.statSync(NETWORK_CONFIG_FILE).mode & 0o777;
    if (mode & 0o077) problems.push(`${NETWORK_CONFIG_FILE} is readable by other users; run chmod 600 on it.`);
  } catch {
    /* ignore stat problems, the read already succeeded */
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { options: {}, problems: [`${NETWORK_CONFIG_FILE} is not valid JSON: ${(error as Error).message}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { options: {}, problems: [`${NETWORK_CONFIG_FILE} must contain a JSON object.`] };
  }
  const input = parsed as Record<string, unknown>;
  const options: Partial<NetworkOptions> = {};
  for (const key of KEYS) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") problems.push(`${key} must be true or false.`);
      else options[key] = input[key];
    }
  }
  for (const key of ["caCertPath", "pinSha256"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim()) {
      problems.push(`${key} must be a non-empty string.`);
      continue;
    }
    if (key === "caCertPath") {
      const file = path.resolve(value.replace(/^~(?=\/|$)/u, os.homedir()));
      if (!fs.existsSync(file)) problems.push(`caCertPath "${file}" does not exist; TLS verification will use system roots only.`);
      else options.caCertPath = file;
    } else {
      const pin = value.trim().replace(/^sha256\//iu, "");
      if (!/^[A-Za-z0-9+/=]{43,44}$/u.test(pin)) problems.push("pinSha256 must be the base64 SHA-256 of the certificate SPKI.");
      else options.pinSha256 = pin;
    }
  }
  for (const key of Object.keys(input)) {
    if (!KEYS.includes(key as (typeof KEYS)[number]) && key !== "caCertPath" && key !== "pinSha256") {
      problems.push(`Unknown key "${key}" in ${NETWORK_CONFIG_FILE} is ignored.`);
    }
  }
  return { options, problems };
}

/** Apply the operator file and return problems to log. Missing file is fine. */
export function applyNetworkConfig(): string[] {
  const { options, problems } = readOptions();
  setNetworkOptions(options);
  return problems;
}
