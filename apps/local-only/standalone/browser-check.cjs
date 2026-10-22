// Loads the standalone webview in a real Chrome and reports whether the UI
// actually renders against the core — the acceptance test for the JetBrains work.
// Plain CDP over a WebSocket, no test framework.
//
//   /tmp/chrome-headless-shell-linux64/chrome-headless-shell --headless --no-sandbox \
//       --remote-debugging-port=9222 about:blank &
//   WEB_URL=http://127.0.0.1:26063/ node apps/local-only/standalone/browser-check.cjs

const WebSocket = require("ws")

const url = process.env.WEB_URL || "http://127.0.0.1:26063/"
const cdpPort = Number(process.env.CDP_PORT || 9222)
const waitMs = Number(process.env.WAIT_MS || 12000)

async function target() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      const list = await response.json()
      const page = list.find((entry) => entry.type === "page")
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("no CDP page target")
}

async function main() {
  const socket = new WebSocket(await target(), { perMessageDeflate: false })
  await new Promise((resolve, reject) => {
    socket.on("open", resolve)
    socket.on("error", reject)
  })

  let id = 0
  const waiting = new Map()
  const errors = []
  const requests = []

  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw))
    if (message.id && waiting.has(message.id)) {
      waiting.get(message.id)(message.result)
      waiting.delete(message.id)
      return
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 200))
    }
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(`exception: ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`.slice(0, 300))
    }
  })

  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const next = ++id
      waiting.set(next, resolve)
      socket.send(JSON.stringify({ id: next, method, params }))
    })

  await call("Runtime.enable")
  await call("Page.enable")
  await call("Page.navigate", { url })
  await new Promise((resolve) => setTimeout(resolve, waitMs))

  const probe = await call("Runtime.evaluate", {
    expression: `(() => {
      const root = document.getElementById("root")
      const text = root ? root.innerText.replace(/\\s+/g, " ").trim() : ""
      return JSON.stringify({
        bridge: typeof window.standalonePostMessage === "function" ? (window.__clineBridge() === 1 ? "open" : "closed") : "missing",
        nodes: root ? root.querySelectorAll("*").length : 0,
        text: text.slice(0, 240),
      })
    })()`,
    returnByValue: true,
  })

  const state = JSON.parse(probe.result.value)
  console.log(`bridge websocket: ${state.bridge}`)
  console.log(`rendered nodes:   ${state.nodes}`)
  console.log(`visible text:     ${state.text || "(none)"}`)
  if (errors.length) {
    console.log(`console errors (${errors.length}):`)
    errors.slice(0, 5).forEach((error) => console.log(`  ${error}`))
  }
  socket.close()
  process.exit(state.nodes > 50 ? 0 : 1)
}

main().catch((error) => {
  console.log(`browser check failed: ${error.message}`)
  process.exit(1)
})
