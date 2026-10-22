/**
 * Offline replacements for the browser tool
 * (`services/browser/BrowserSession`, `BrowserDiscovery`, `utils`,
 * `UrlContentFetcher`).
 *
 * Upstream drives Chrome over CDP and downloads Chrome on first use, so the
 * browser feature is the single biggest network consumer in the original
 * extension. This build reports "no browser available" instead, which keeps
 * puppeteer, `@puppeteer/browsers` and `chromium-bidi` out of the bundle. The
 * settings UI keeps its browser section; it just reports the feature as
 * unavailable in this distribution.
 */

const DISABLED = "此发行版已禁用浏览器工具（不联网，也不下载 Chrome）。/ The browser tool is disabled in this distribution.";

export interface BrowserConnectionInfo {
  isConnected: boolean;
  isRemote: boolean;
  host?: string;
}

export class BrowserSession {
  public getConnectionInfo(): BrowserConnectionInfo {
    return { isConnected: false, isRemote: false, host: undefined };
  }

  public async testConnection(_host?: string): Promise<{ isConnected: boolean; message: string }> {
    return { isConnected: false, message: DISABLED };
  }

  public async getDetectedChromePath(): Promise<{ chromePath: string | null; error?: string }> {
    return { chromePath: null, error: DISABLED };
  }

  public async relaunchChromeDebugMode(): Promise<void> {
    throw new Error(DISABLED);
  }

  public async launchBrowser(): Promise<void> {
    throw new Error(DISABLED);
  }

  public async navigateToUrl(_url: string): Promise<never> {
    throw new Error(DISABLED);
  }

  public async closeBrowser(): Promise<void> {}
}
