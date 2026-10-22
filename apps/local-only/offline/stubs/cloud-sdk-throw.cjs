/**
 * Stub for the cloud model SDKs (`@ai-sdk/anthropic`, `@ai-sdk/google`,
 * `@ai-sdk/google-vertex`, `@ai-sdk/amazon-bedrock`, `@aws-sdk/*`, `@smithy/*`,
 * `@sap*`, `google-auth-library`, `@openrouter/*`, `@ai-sdk/openai` ...).
 *
 * `@cline/llms` ships as one bundled file, so its vendor modules cannot be
 * replaced individually; the npm specifiers can. Every import resolves to this
 * proxy, so the tree disappears from the offline bundle, and anything that
 * actually tries to build a cloud client gets a clear local error instead of a
 * socket to a vendor nobody configured.
 */

const message =
	"此 provider 的云端 SDK 已从本机/内网专用发行版中移除，不会连接互联网。/ This cloud provider SDK is not part of the local-only distribution.";

function fail() {
	throw new Error(message);
}

const stub = new Proxy(fail, {
	apply: fail,
	construct: fail,
	get(_target, property) {
		if (property === "__esModule") return true;
		if (typeof property === "symbol") return undefined;
		return stub;
	},
});

module.exports = stub;
