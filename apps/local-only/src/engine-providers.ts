// The upstream Agent imports a provider factory even when given a model.
// This build surface makes that path unavailable and excludes all cloud SDKs.
export type GatewayProviderSettings = { options?: Record<string, unknown> };
export function createGateway(..._args: unknown[]): { createAgentModel: (...args: unknown[]) => never } {
  throw new Error("This distribution only accepts its explicitly configured local model.");
}
export function classifyProviderError(error: unknown): "auth" | "unknown" {
  const status = (error as { statusCode?: number })?.statusCode;
  return status === 401 || status === 403 ? "auth" : "unknown";
}
export function isRetryableProviderError(_error: unknown): boolean {
  // No hidden retry/background requests. A user may retry the task explicitly.
  return false;
}
