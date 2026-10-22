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
				const id = response.request_id
				const tracked = pending.get(id)
				if (!tracked) return
				if (response.error) {
					tracked.reject(new Error(response.error))
					pending.delete(id)
					return
				}
				if (response.message_json != null) {
					tracked.payload = response.message_json
				} else if (response.message_json_chunk != null) {
					tracked.chunks.push(Buffer.from(response.message_json_chunk).toString("utf8"))
				}
				if (response.completed) {
					tracked.resolve(tracked.payload ?? tracked.chunks.join(""))
					pending.delete(id)
				}
				return
			}
			if (message.cancel) pending.delete(message.cancel.request_id)
		})
		call.on("error", (error) => console.log(`[shim] core connection error: ${error.message}`))
		call.on("end", () => {
			console.log("[shim] core connection closed")
			coreStream = undefined
		})
	},
})

function askCore(service, method, messageJson, isStreaming = false) {
	const requestId = crypto.randomBytes(8).toString("hex")
	return new Promise((resolve, reject) => {
		if (!coreStream) {
			reject(new Error("core connection is not ready"))
			return
		}
		pending.set(requestId, { resolve, reject, chunks: [] })
		coreStream.write({ request: { request_id: requestId, service, method, message_json: messageJson, is_streaming: isStreaming } })
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

server.bindAsync(HOST_BRIDGE_ADDRESS, grpc.ServerCredentials.createInsecure(), (error, port) => {
	if (error) {
		console.error(`[shim] cannot listen on ${HOST_BRIDGE_ADDRESS}: ${error.message}`)
		process.exit(1)
	}
	console.log(`[shim] host bridge serving on 127.0.0.1:${port}`)
	const core = startCore()

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
