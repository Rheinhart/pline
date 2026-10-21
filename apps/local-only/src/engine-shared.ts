// Deliberately narrow build surface for the upstream Cline Agent loop.
// Never re-export @cline/shared's barrel: it includes cloud configuration/storage.
export type * from "../../../sdk/packages/shared/src/agent";
export type * from "../../../sdk/packages/shared/src/llms/tools";
export type * from "../../../sdk/packages/shared/src/services/telemetry";
export { createTool } from "../../../sdk/packages/shared/src/tools/create";
export { estimateTokens } from "../../../sdk/packages/shared/src/llms/tokens";
export { mergeModelOptions } from "../../../sdk/packages/shared/src/llms/model-options";
export { normalizeJsonLikeStringsForSchema } from "../../../sdk/packages/shared/src/parse/json";
export { omitUndefinedValues } from "../../../sdk/packages/shared/src/parse/object";
export { trimNonEmpty } from "../../../sdk/packages/shared/src/parse/string";
export { TOOL_REJECTION_SUFFIX } from "../../../sdk/packages/shared/src/llms/tools";

// Compile-time removal of the upstream observability hooks, not a user setting.
export function captureAgentUnexpectedReasoningTokens(..._args: unknown[]): void {}
export function captureSdkError(..._args: unknown[]): void {}
export function captureTaskLifecycleEvent(..._args: unknown[]): void {}
export const TASK_CANCELLED_EVENT = "task.cancelled";
export const TASK_FIRST_CHUNK_RECEIVED_EVENT = "task.first_chunk_received";
export const TASK_MAX_TOKENS_RECOVERY_EVENT = "task.max_tokens_recovery";
export const TASK_PROVIDER_REQUEST_STARTED_EVENT = "task.provider_request_started";
export const TASK_PROVIDER_STREAM_FAILED_EVENT = "task.provider_stream_failed";
export const TASK_PROVIDER_STREAM_STARTED_EVENT = "task.provider_stream_started";
