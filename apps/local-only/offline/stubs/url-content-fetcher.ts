/**
 * Offline replacement for `services/browser/UrlContentFetcher`.
 *
 * `@url` mentions and the web-fetch path use this class to read a page. Reading
 * a public URL would mean sending an outbound request nobody configured, so the
 * offline build refuses it and the caller reports the failure in the chat.
 */

const DISABLED = "无法读取网址：此发行版不联网，只允许访问本机/内网模型端点。/ URL fetching is disabled in this offline distribution.";

export class UrlContentFetcher {
  public async initialize(): Promise<void> {}

  public async launchBrowser(): Promise<void> {}

  public async closeBrowser(): Promise<void> {}

  public async fetchUrlAsHtml(_url: string): Promise<string> {
    throw new Error(DISABLED);
  }

  public async fetchUrlAsMarkdown(_url: string): Promise<string> {
    throw new Error(DISABLED);
  }

  public async urlToMarkdown(_url: string): Promise<string> {
    throw new Error(DISABLED);
  }
}
