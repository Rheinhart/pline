/**
 * Guarded `node:http` for the offline bundle.
 */

import * as realHttp from "node:http";
import { assertRequestTarget } from "./http-target";

export * from "node:http";

function wrap(fn: unknown): unknown {
  return (...args: unknown[]) => {
    assertRequestTarget(args, "http:");
    return (fn as (...inner: unknown[]) => unknown)(...args);
  };
}

export const request = wrap(realHttp.request) as typeof realHttp.request;
export const get = wrap(realHttp.get) as typeof realHttp.get;

export default { ...realHttp, request, get };
