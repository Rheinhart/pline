// A minimal stand-in for the JetBrains host, used to find out what cline-core
// actually asks its host for. It is CommonJS on purpose: it must resolve
// @grpc/grpc-js from the standalone bundle's own node_modules via NODE_PATH,
// and ESM ignores that variable.
//
// Nothing here is the final design — the point is the log it produces: every
// host service method the core calls during startup, and a round trip for one
// real controller call through CoreConnectionService.

const crypto = require("crypto")
const path = require("path")
const { spawn } = require("child_process")

const grpc = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const health = require("grpc-health-check")

const BUNDLE = path.resolve(process.env.BUNDLE_DIR || "")
const PROTO_ROOT = path.resolve(process.env.PROTO_ROOT || "")
if (!BUNDLE || !PROTO_ROOT) {
	throw new Error("BUNDLE_DIR and PROTO_ROOT must be set")
}

const HOST_BRIDGE_ADDRESS = `127.0.0.1:${process.env.PORT || 26041}`
const WORKSPACE = process.env.WORKSPACE || "/tmp/pline-core-test/proj"
const token = crypto.randomBytes(24).toString("hex")
const instanceId = crypto.randomUUID()
const calls = []
const started = Date.now()

// The few host methods the core genuinely needs. Everything else is answered
// with an empty message by the generic handler below; this map is the list of
// "the host must actually answer this" and it is deliberately short.
const answers = {
	"host.WorkspaceService.getWorkspacePaths": () => ({ id: crypto.createHash("sha256").update(WORKSPACE).digest("hex"), paths: [WORKSPACE] }),
	"host.EnvService.getHostVersion": () => ({ platform: "CLion", version: "2024.3.5", cline_type: "Cline for JetBrains" }),
	"host.EnvService.getIdeRedirectUri": () => ({ value: "" }),
	"host.EnvService.getTelemetrySettings": () => ({ enabled: false }),
	"host.WindowService.getActiveEditor": () => ({}),
	"host.WorkspaceService.getOpenTabs": () => ({ tab_paths: [] }),
}

const loadOptions = { includeDirs: [PROTO_ROOT], keepCase: true, longs: String, defaults: true }

// ---------------------------------------------------------------- webview relay
const connectionDef = protoLoader.loadSync(path.join(PROTO_ROOT, "host/core_connection.proto"), loadOptions)
const connectionPkg = grpc.loadPackageDefinition(connectionDef)

// ------------------------------------------------------------ host side services
const server = new grpc.Server()
const seen = new Map()

function registerHostService(protoFile) {
	const def = protoLoader.loadSync(path.join(PROTO_ROOT, "host", protoFile), loadOptions)
	const pkg = grpc.loadPackageDefinition(def)
	const services = pkg.host
	for (const [name, Service] of Object.entries(services)) {
		if (!Service.service) continue
		const handlers = {}
		for (const [method, info] of Object.entries(Service.service)) {
			const qualified = `host.${name}.${method}`
			const reply = (call, send) => {
				calls.push(qualified)
				seen.set(qualified, (seen.get(qualified) || 0) + 1)
				if (!call.metadata.get("cline-hostbridge-token").length) {
					console.log(`[shim] ${qualified} arrived WITHOUT the host bridge token`)
				}
				if (info.responseStream) {
					// Nothing to stream yet; closing keeps the core's client happy.
					send()
					return
				}
				const special = answers[qualified]
				send(null, special ? special() : {})
			}
			handlers[method] = info.requestStream
				? (call, cb) => {
						call.on("data", (chunk) => reply({ metadata: call.metadata }, () => {}))
						call.on("end", () => cb(null, {}))
					}
				: reply
		}
		server.addService(Service.service, handlers)
		console.log(`[shim] serving host.${name} (${Object.keys(Service.service).length} methods)`)
	}
}

for (const protoFile of ["workspace.proto", "window.proto", "env.proto", "diff.proto", "testing.proto"]) {
	registerHostService(protoFile)
}

// --------------------------------------------------------------------- health
const healthDef = protoLoader.loadSync(health.protoPath, { keepCase: true })
const healthPkg = grpc.loadPackageDefinition(healthDef)
server.addService(healthPkg.grpc.health.v1.Health.service, {
	Check: (_call, cb) => cb(null, { status: 1 }), // SERVING
	Watch: (call) => {
		call.write({ status: 1 })
		// Stay open: the protocol expects the stream to keep reporting.
	},
})

// ------------------------------------------------------- core connection stream
let coreStream
const pending = new Map()

server.addService(connectionPkg.host.CoreConnectionService.service, {
	connect(call) {
		call.on("data", (message) => {
			if (message.hello) {
				if (message.hello.token !== token) {
					console.log(`[shim] rejected core hello: token mismatch (instance ${message.hello.instance_id})`)
					call.end()
					return
				}
				console.log(`[shim] core hello accepted; instance_id=${message.hello.instance_id}`)
				coreStream = call
				call.write({ ready: {} })
				return
			}
			if (message.response) {
				const response = message.response
				const tracked = pending.get(response.request_id)
				if (!tracked) return
				if (response.error) {
					tracked.onError(new Error(response.error))
					pending.delete(response.request_id)
					return
				}
				// The core always sends message_json_chunk, bounded; a payload ends at
				// message_json_complete, and the request ends at completed.
				let payload
				if (response.message_json != null) {
					payload = response.message_json
				} else if (response.message_json_chunk != null) {
					tracked.chunks.push(Buffer.from(response.message_json_chunk).toString("utf8"))
					if (response.message_json_complete) {
						payload = tracked.chunks.join("")
						tracked.chunks = []
					}
				}
				if (payload != null) tracked.onPayload(JSON.parse(payload))
				if (response.completed) {
					tracked.onEnd()
					pending.delete(response.request_id)
				}
				return
			}
			if (message.cancel) {
				const cancelled = pending.get(message.cancel.request_id)
				if (cancelled) cancelled.onEnd()
				pending.delete(message.cancel.request_id)
			}
		})
		call.on("error", (error) => console.log(`[shim] core connection error: ${error.message}`))
		call.on("end", () => {
			console.log("[shim] core connection closed")
			coreStream = undefined
		})
	},
})

// Sends one controller call over the core connection. A streaming call fires
// onPayload once per logical payload and then onEnd when the core closes it.
function sendToCore(service, method, messageJson, isStreaming, handlers) {
	if (!coreStream) {
		handlers.onError(new Error("core connection is not ready"))
		return
	}
	const requestId = handlers.requestId || crypto.randomBytes(8).toString("hex")
	pending.set(requestId, { chunks: [], ...handlers })
	coreStream.write({ request: { request_id: requestId, service, method, message_json: messageJson, is_streaming: isStreaming } })
}

function askCore(service, method, messageJson) {
	return new Promise((resolve, reject) => {
		let answer
		sendToCore(service, method, messageJson, false, {
			onPayload: (payload) => {
				answer = payload
			},
			onEnd: () => resolve(answer),
			onError: reject,
		})
	})
}

// --------------------------------------------------------------------- run core
function startCore() {
	const bin = process.env.BUN_BIN
	const child = spawn(bin, ["cline-core.js"], {
		cwd: BUNDLE,
		env: {
			// Deliberately minimal: the core logs the whole environment at startup,
			// so a host that inherits its own shell leaks every API key to the log.
			PATH: process.env.PATH,
			HOME: process.env.CORE_HOME,
			CLINE_DIR: path.join(process.env.CORE_HOME, ".cline"),
			HOST_BRIDGE_ADDRESS,
			CLINE_CORE_CONNECTION_TOKEN: token,
			CLINE_CORE_INSTANCE_ID: instanceId,
			INSTALL_DIR: BUNDLE,
			NODE_PATH: path.join(BUNDLE, "node_modules"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	})
	const pipe = (stream) =>
		stream.on("data", (chunk) =>
			String(chunk)
				.split("\n")
				.filter((line) => line.trim() && !line.includes("Environment variables"))
				.forEach((line) => console.log(`[core] ${line.trim()}`)),
		)
	pipe(child.stdout)
	pipe(child.stderr)
	child.on("exit", (code, signal) => {
		console.log(`[core] exited code=${code} signal=${signal}`)
		finish(code ?? 1)
	})
	return child
}

function finish(code) {
	console.log(`\n[shim] host methods the core called: ${calls.length}`)
	for (const [name, count] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(count).padStart(3)}  ${name}`)
	}
	shutdownServer()
	process.exit(code)
}

function shutdownServer() {
	try {
		if (coreStream) coreStream.end()
	} catch {}
	try {
		server.forceShutdown()
	} catch {}
}

// ---------------------------------------------------------------- web bridge
// Serves the standalone webview and carries its messages to the core. This is
// the piece the JetBrains host will do with JCEF: inject standalonePostMessage,
// and deliver host messages back as window message events.
const BRIDGE_SCRIPT = `<script>
(() => {
  const ws = new WebSocket("ws://" + location.host + "/cline-bridge")
  const queued = []
  ws.addEventListener("open", () => queued.splice(0).forEach((m) => ws.send(m)))
  ws.addEventListener("message", (event) => window.postMessage(JSON.parse(event.data), "*"))
  window.standalonePostMessage = (json) => {
    if (ws.readyState === 1) ws.send(json)
    else queued.push(json)
  }
  window.__clineBridge = () => ws.readyState
})()
</script>`

function startWebBridge() {
  const root = process.env.WEBVIEW_DIR
  if (!root) return
  const http = require("http")
  const fs = require("fs")
  const WebSocket = require("ws")
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }

  const server = http.createServer((request, response) => {
    const relative = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\//, "")
    const file = path.join(root, relative)
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      response.writeHead(404)
      response.end("not found")
      return
    }
    let body = fs.readFileSync(file)
    if (relative.endsWith("index.html")) {
      body = Buffer.from(String(body).replace("</head>", `${BRIDGE_SCRIPT}</head>`))
    }
    response.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" })
    response.end(body)
  })

  const sockets = new WebSocket.Server({ noServer: true })
  server.on("upgrade", (request, socket, head) => {
    if (!request.url.startsWith("/cline-bridge")) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) => handleBridgeClient(client))
  })

  function handleBridgeClient(client) {
    console.log("[bridge] webview connected")
    client.on("message", async (raw) => {
      let message
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message.type === "grpc_request_cancel") {
        coreStream?.write({ cancel: { request_id: message.grpc_request_cancel.request_id } })
        return
      }
      if (message.type !== "grpc_request") return
      const request = message.grpc_request
      const id = request.request_id
      const log = `${request.service}.${request.method}${request.is_streaming ? " (stream)" : ""}`
      sendToCore(request.service, request.method, JSON.stringify(request.message ?? {}), Boolean(request.is_streaming), {
        requestId: id,
        onPayload: (payload) => {
          console.log(`[bridge] ${log} -> payload forwarded`)
          // A unary response must not claim to be a stream; the webview resolves
          // on the first frame with a message either way, but the host that ships
          // should be exact.
          send(client, id, payload, Boolean(request.is_streaming))
        },
        onEnd: () => send(client, id, undefined, false),
        onError: (error) => {
          console.log(`[bridge] ${log} -> error: ${error.message}`)
          client.send(JSON.stringify({ type: "grpc_response", grpc_response: { request_id: id, error: error.message, is_streaming: false } }))
        },
      })
    })
    client.on("close", () => console.log("[bridge] webview disconnected"))
  }

  function send(client, requestId, payload, streaming) {
    if (client.readyState !== 1) return
    const response = { request_id: requestId, is_streaming: streaming }
    if (payload !== undefined) response.message = payload
    client.send(JSON.stringify({ type: "grpc_response", grpc_response: response }))
  }

  server.listen(Number(process.env.WEB_PORT || 26060), "127.0.0.1", () =>
    console.log(`[bridge] webview at http://127.0.0.1:${process.env.WEB_PORT || 26060}`),
  )
}

server.bindAsync(HOST_BRIDGE_ADDRESS, grpc.ServerCredentials.createInsecure(), (error, port) => {
	if (error) {
		console.error(`[shim] cannot listen on ${HOST_BRIDGE_ADDRESS}: ${error.message}`)
		process.exit(1)
	}
	console.log(`[shim] host bridge serving on 127.0.0.1:${port}`)
	const core = startCore()
	startWebBridge()

	if (!process.env.PROBE) {
		return
	}

	const probe = async () => {
		if (!coreStream) {
			setTimeout(probe, 250)
			return
		}
		const answer = await askCore("cline.StateService", "getLatestState", "{}")
		const parsed = JSON.parse(answer)
		console.log(`[shim] StateService.getLatestState answered with ${Object.keys(parsed).length} top-level fields`)
		console.log(`[shim] settings present: ${parsed.settings ? "yes" : "no"}; apiProvider=${parsed.settings?.apiProvider ?? "n/a"}`)
		console.log(`[shim] round trip took ${Date.now() - started} ms`)
		setTimeout(() => {
			core.kill("SIGTERM")
		}, 500)
	}

	probe().catch((probeError) => {
		console.log(`[shim] probe failed: ${probeError.message}`)
		setTimeout(() => core.kill("SIGTERM"), 200)
	})
})

process.on("SIGINT", () => finish(0))
