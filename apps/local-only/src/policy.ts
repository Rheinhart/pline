import { isIP } from "node:net";

export interface ModelSettings {
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

export function modelEndpoint(value: string): URL {
  if (typeof value !== "string" || value.length > 512 || /[\s\\]/u.test(value)) {
    throw new Error("Enter a literal private IP model URL, for example http://192.168.1.50:8000/v1.");
  }
  const match = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::([0-9]+))?(\/v1\/?)?$/u.exec(value);
  if (!match) throw new Error("Only http(s)://PRIVATE_IP:PORT/v1 is supported; DNS, credentials and query strings are forbidden.");
  const url = new URL(value);
  // Reject alternative IPv4 representations and IPv6 normalization ambiguities.
  if (match[2].toLowerCase() !== url.hostname) throw new Error("Use a canonical literal IP address.");
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const version = isIP(host);
  let allowed = false;
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    allowed = host === "127.0.0.1" || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  } else if (version === 6) {
    allowed = host === "::1" || /^(fc|fd)[0-9a-f]{2}:/u.test(host);
  }
  if (!allowed) throw new Error("Only loopback and explicitly configured private IPv4/IPv6 model addresses are allowed.");
  url.pathname = "/v1/chat/completions";
  return url;
}

export function validateSettings(input: ModelSettings): Readonly<ModelSettings> {
  modelEndpoint(input.baseUrl);
  if (typeof input.model !== "string" || !input.model.trim() || input.model.length > 200 || /[\r\n\0]/u.test(input.model)) {
    throw new Error("A local model ID is required.");
  }
  if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || /[\r\n\0]/u.test(input.apiKey) || input.apiKey.length > 4096)) {
    throw new Error("Invalid model credential.");
  }
  const maxTokens = input.maxTokens ?? 4096;
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > 32768) throw new Error("maxTokens must be 128–32768.");
  return Object.freeze({ baseUrl: input.baseUrl, model: input.model.trim(), apiKey: input.apiKey, maxTokens });
}
