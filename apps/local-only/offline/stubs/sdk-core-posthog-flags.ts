/**
 * Offline replacement for the SDK core's PostHog feature-flag provider.
 *
 * The extension imports `@cline/core` through its compiled barrel, which
 * re-exports this module; the stub keeps `posthog-node` out of the bundle while
 * leaving the upstream `FeatureFlagsService` in place with no provider.
 */

export interface PostHogFeatureFlagsProviderConfig {
  apiKey?: string;
  flags?: string[];
}

export interface PostHogFeatureFlagsProviderOptions {
  config?: PostHogFeatureFlagsProviderConfig;
}

export function buildClinePostHogClient(_options?: PostHogFeatureFlagsProviderConfig): undefined {
  return undefined;
}

export class PostHogFeatureFlagsProvider {
  public async getFeatureFlags(): Promise<Record<string, never>> {
    return {};
  }

  public isEnabled(): boolean {
    return false;
  }

  public async dispose(): Promise<void> {}
}
