/**
 * Offline replacement for `services/browser/utils`.
 *
 * Upstream downloads a managed Chromium into global storage when needed. This
 * build never downloads anything, so the call fails with a local message.
 */

const DISABLED = "此发行版不会下载 Chrome / This distribution never downloads a browser.";

export async function ensureChromiumExists(): Promise<never> {
  throw new Error(DISABLED);
}
