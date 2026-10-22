/**
 * Offline stand-ins for the cloud model gateway vendor modules in
 * `@cline/llms` (`providers/vendors/{anthropic,bedrock,google,vertex,cline,community}`).
 *
 * The Settings UI keeps listing those providers, because this distribution
 * copies the upstream interface instead of trimming it. Selecting one and
 * starting a task reports a clear local error instead of opening a socket to a
 * vendor nobody configured, and the vendor SDK trees (Anthropic, Google,
 * Vertex, Bedrock/AWS, SAP, OpenRouter, Cline gateway) never enter the bundle.
 *
 * The two pure helpers are kept as identity functions so capability lookups
 * elsewhere keep working.
 */

const OFFLINE = "本机/内网模型专用发行版不包含该云端 provider（不会连接互联网，也不会使用云端账号）。/ This cloud provider is not part of the offline distribution.";

function removed(provider: string): never {
  throw new Error(`${provider}: ${OFFLINE}`);
}

export async function createAnthropicProviderModule(): Promise<never> {
  return removed("Anthropic");
}

export async function createBedrockProviderModule(): Promise<never> {
  return removed("AWS Bedrock");
}

export async function createGoogleProviderModule(): Promise<never> {
  return removed("Google Gemini");
}

export async function createVertexProviderModule(): Promise<never> {
  return removed("Google Vertex AI");
}

export async function createClineProviderModule(): Promise<never> {
  return removed("Cline gateway");
}

export async function createCline(): Promise<never> {
  return removed("Cline gateway");
}

export async function createSapAiCoreProviderModule(): Promise<never> {
  return removed("SAP AI Core");
}

export async function createClaudeCodeProviderModule(): Promise<never> {
  return removed("Claude Code CLI");
}

export async function createOpenAICodexProviderModule(): Promise<never> {
  return removed("OpenAI Codex (OAuth)");
}

export async function createOpenCodeProviderModule(): Promise<never> {
  return removed("OpenCode");
}

export async function createDifyProviderModule(): Promise<never> {
  return removed("Dify");
}

export function resolveBedrockModelId(modelId: string): string {
  return modelId;
}

export function normalizeGeminiBaseUrl(baseUrl?: string): string | undefined {
  return baseUrl;
}
