/**
 * Offline replacement for `PostHogClientProvider`.
 *
 * `common.ts` still calls `getInstance()`/`dispose()` on it, so the class has to
 * exist; it never creates a client, which keeps `posthog-node` out of the
 * bundle entirely (no request queue, no flush timer, no ingestion host).
 */

export class PostHogClientProvider {
  private static readonly instance = new PostHogClientProvider();

  public static getInstance(): PostHogClientProvider {
    return PostHogClientProvider.instance;
  }

  /** No analytics client exists in this distribution. */
  public static getClient(): null {
    return null;
  }

  public static eventFilter<T>(event: T): T {
    return event;
  }

  public async dispose(): Promise<void> {}
}
