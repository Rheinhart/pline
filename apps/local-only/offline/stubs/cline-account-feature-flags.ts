/**
 * Offline replacement for the SDK core's cline-account feature flags.
 *
 * Upstream asks the Cline cloud account whether a feature is on, lazily loading
 * a PostHog client to do it. This distribution has no cloud account, so every
 * flag reports "off" and PostHog never enters the bundle.
 */

export async function isClineAccountFeatureEnabled(_name: string): Promise<boolean> {
  return false;
}
