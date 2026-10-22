/**
 * A `dns.lookup` replacement that refuses public answers.
 *
 * Only used when the operator explicitly enables `allowLanDns`; with the
 * default policy a hostname never reaches resolution at all.
 */

import * as realDns from "node:dns";
import { assertLookupResult } from "../net-policy";

type LookupCallback = (error: Error | null, address: string | string[], family?: number) => void;

export function privateLookup(hostname: string, options: unknown, callback: LookupCallback): void {
  const done = (fn: LookupCallback): LookupCallback => (error, address, family) => {
    if (!error) {
      const addresses = Array.isArray(address) ? address : [address];
      try {
        assertLookupResult(hostname, addresses);
      } catch (assertion) {
        fn(assertion as Error, []);
        return;
      }
    }
    fn(error, address, family);
  };
  if (typeof options === "function") {
    (realDns.lookup as unknown as (host: string, cb: LookupCallback) => void)(hostname, done(options as LookupCallback));
    return;
  }
  (realDns.lookup as unknown as (host: string, opts: unknown, cb: LookupCallback) => void)(
    hostname,
    options,
    done(callback),
  );
}
