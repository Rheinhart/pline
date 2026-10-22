/**
 * Offline stand-ins for the SDK core's Langfuse/OTel telemetry helpers
 * (`@cline/llms` `services/langfuse-telemetry`, `langfuse-stream-telemetry`,
 * `LangfuseAttributesSpanProcessor`).
 *
 * Langfuse is a hosted tracing backend: prompt text and tool payloads would be
 * exported to it. This build has no tracing exporter at all, so these exports
 * exist only so the upstream re-export graph keeps resolving.
 */

export type LangfuseTraceAttributes = Record<string, unknown>;
export type AiSdkTelemetryDecision = { enabled?: boolean; reason?: string };

export async function withLangfuseTraceAttributes<T>(
  _attributes: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  return await run();
}

export function readEnvTraceAttributes(): Record<string, string> {
  return {};
}

export async function resolveAiSdkTelemetry(): Promise<undefined> {
  return undefined;
}

export async function disposeLangfuseTelemetry(): Promise<void> {}

export function debugLangfuse(_message: string): void {}

export function resetLangfuseTelemetryForTests(): void {}

export class LangfuseStreamTelemetry {
  public recordChunk(_chunk: unknown): void {}
  public async flush(): Promise<void> {}
  public async dispose(): Promise<void> {}
}

export class LangfuseAttributesSpanProcessor {
  public onStart(): void {}
  public onEnd(): void {}
  public async shutdown(): Promise<void> {}
  public async forceFlush(): Promise<void> {}
}
