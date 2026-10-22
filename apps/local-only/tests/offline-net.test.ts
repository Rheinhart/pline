/**
 * Network boundary tests for the offline build.
 *
 * These run against synthetic targets only: a loopback listener owned by the
 * test, and addresses that must be refused before any bytes leave the process.
 */

import assert from "node:assert/strict";
import * as http from "node:http";
import * as net from "node:net";
import { after, before, test } from "node:test";
import { fetch, getAxiosSettings } from "../offline/net-guard";
import { OfflineNetworkError, assertUrlAllowed, getNetworkOptions, isPrivateHost, setNetworkOptions } from "../offline/net-policy";
import { applyNetworkConfig } from "../offline/network-settings";
import { connect as guardedConnect } from "../offline/node/net";
import { lookup as guardedLookup } from "../offline/node/dns";
import { request as guardedRequest } from "../offline/node/http";

function denied(fn: () => unknown, label: string): void {
  assert.throws(fn, (error) => error instanceof OfflineNetworkError, label);
}

before(() => {
  applyNetworkConfig();
  setNetworkOptions({ lanPlainHttp: false, allowLanDns: false, caCertPath: undefined, pinSha256: undefined });
});

after(() => {
  setNetworkOptions(getNetworkOptions());
});

test("private and loopback addresses are allowed", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "10.1.2.3", "172.16.0.1", "192.168.1.50", "fd12::34"]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  assert.equal(assertUrlAllowed("https://192.168.1.50:8000/v1").host, "192.168.1.50");
  assert.equal(assertUrlAllowed("http://127.0.0.1:11434/v1").protocol, "http:");
});

test("public, link-local and ambiguous targets are refused", () => {
  for (const url of [
    "https://8.8.8.8/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://api.cline.bot/v1",
    "http://0177.0.0.1:11434/v1",
    "http://0x7f.0.0.1:11434/v1",
    "https://user:pass@192.168.1.50/v1",
    "ftp://192.168.1.50/v1",
    "https://[::ffff:8.8.8.8]/v1",
  ]) {
    denied(() => assertUrlAllowed(url), url);
  }
});

test("plaintext http off-loopback needs an explicit opt-in", () => {
  // The real home-LAN case: an OpenAI-compatible server on the LAN over http.
  const lan = "http://192.168.0.33:8080/v1";
  let message = "";
  try {
    assertUrlAllowed(lan);
  } catch (error) {
    message = (error as Error).message;
  }
  denied(() => assertUrlAllowed(lan), "http on the LAN is refused by default");
  // The message has to name the file the operator can actually edit.
  assert.match(message, /lanPlainHttp/, "denial explains the opt-in");
  assert.match(message, /network\.json/, "denial names a config file path");
  setNetworkOptions({ lanPlainHttp: true });
  try {
    assert.equal(assertUrlAllowed(lan).protocol, "http:");
  } finally {
    setNetworkOptions({ lanPlainHttp: false });
  }
});

test("an operator file cannot widen the policy to the internet", () => {
  // Unknown keys are reported and ignored; there is no way to allow a host.
  assert.equal(isPrivateHost("93.184.216.34"), false);
});

test("the guarded fetch reaches a loopback server and follows no redirect", async () => {
  const seen: string[] = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url ?? "");
    if (request.url === "/redirect") {
      response.writeHead(307, { location: "http://127.0.0.1:0/never" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  // A dead proxy must not be able to reroute the request.
  const previousProxy = process.env.http_proxy;
  process.env.http_proxy = "http://127.0.0.1:1";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(seen, ["/v1/chat/completions"]);

    const redirect = await fetch(`http://127.0.0.1:${port}/redirect`).catch((error: unknown) => error);
    assert.ok(redirect, "a redirect must surface as an error, not a silent hop");
    assert.equal(seen.length, 2, "the redirect target is never requested");
  } finally {
    if (previousProxy === undefined) delete process.env.http_proxy;
    else process.env.http_proxy = previousProxy;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the guarded fetch refuses a public endpoint before sending a body", async () => {
  const error = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    body: "source-code-that-must-not-leave",
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof OfflineNetworkError, "expected a policy denial");
});

test("raw sockets, http requests and DNS honour the same policy", () => {
  denied(() => guardedConnect({ host: "8.8.8.8", port: 53 }), "tcp connect to a public address");
  denied(() => guardedRequest({ host: "api.cline.bot", port: 443, path: "/v1" }), "http.request to a public host");
  const probe = guardedConnect({ host: "127.0.0.1", port: 1 });
  probe.on("error", () => undefined); // port 1 is closed; only the policy check matters
  probe.destroy();
  assert.throws(
    () => guardedLookup("example.com", {}, () => undefined),
    (error) => error instanceof OfflineNetworkError,
    "dns.lookup is refused while DNS is disabled",
  );
  assert.equal(Object.keys(getAxiosSettings()).length, 4);
});
