// Behaves exactly like the standalone webview client: the same message shapes
// webview-ui/src/services/grpc-client-base.ts sends, over the bridge WebSocket
// instead of window.standalonePostMessage. Run it while host-shim.cjs serves the
// bridge, e.g.
//
//   PROBE=1 WEBVIEW_DIR=.../build-standalone node apps/local-only/standalone/host-shim.cjs &
//   node apps/local-only/standalone/webview-probe.cjs

const WebSocket = require("ws")

const port = Number(process.env.WEB_PORT || 26060)
const socket = new WebSocket(`ws://127.0.0.1:${port}/cline-bridge`)
const id = () => Math.random().toString(36).slice(2)

const results = []
let streamingPayloads = 0

socket.on("open", () => {
	socket.send(
		JSON.stringify({
			type: "grpc_request",
			grpc_request: { service: "cline.StateService", method: "getLatestState", message: {}, request_id: id(), is_streaming: false },
		}),
	)
	// A stream is what the real UI uses to stay current; the webview expects the
	// final frame to carry is_streaming: false and no message.
	socket.send(
		JSON.stringify({
			type: "grpc_request",
			grpc_request: { service: "cline.StateService", method: "subscribeToState", message: {}, request_id: "probe-stream", is_streaming: true },
		}),
	)
})

socket.on("message", (raw) => {
	const message = JSON.parse(String(raw))
	if (message.type !== "grpc_response") return
	const response = message.grpc_response
	if (response.request_id === "probe-stream") streamingPayloads += 1
	results.push({
		id: response.request_id === "probe-stream" ? "stream" : "unary",
		fields: response.message ? Object.keys(response.message).length : 0,
		error: response.error || null,
		streaming: response.is_streaming,
	})
})

setTimeout(() => {
	console.log(`responses received: ${results.length} (stream payloads: ${streamingPayloads})`)
	for (const result of results.slice(0, 4)) {
		console.log(`  ${result.id}: fields=${result.fields} is_streaming=${result.streaming} ${result.error ? `error=${result.error}` : ""}`)
	}
	process.exit(results.length > 0 ? 0 : 1)
}, 4000)
