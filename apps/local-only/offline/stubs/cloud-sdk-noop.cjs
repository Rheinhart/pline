/**
 * Silent stub for hosted tracing/telemetry SDKs (`@langfuse/*`,
 * `@opentelemetry/exporter-*`, `@opentelemetry/sdk-*`, `@opentelemetry/otlp-*`,
 * `@opentelemetry/resources`).
 *
 * Unlike the cloud model SDKs these can be touched while modules are being
 * initialised, so they must not throw; they accept anything and do nothing.
 * Telemetry is additionally inlined as disabled by the build, so no exporter is
 * ever constructed in practice.
 */

function noop() {
	return noop;
}

const stub = new Proxy(noop, {
	apply() {
		return stub;
	},
	construct() {
		return stub;
	},
	get(_target, property) {
		if (property === "__esModule") return true;
		if (property === "then") return undefined; // never look like a promise
		if (typeof property === "symbol") return undefined;
		return stub;
	},
	set() {
		return true;
	},
	has() {
		return true;
	},
});

module.exports = stub;
