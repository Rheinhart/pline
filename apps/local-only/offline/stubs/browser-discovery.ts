/**
 * Offline replacement for `services/browser/BrowserDiscovery`.
 *
 * Discovery works by probing TCP ports on this machine; the offline build has
 * no browser to find, so it reports nothing.
 */

export async function isPortOpen(_host: string, _port: number, _timeout = 1000): Promise<boolean> {
  return false;
}

export async function discoverChromeInstances(): Promise<string | null> {
  return null;
}
