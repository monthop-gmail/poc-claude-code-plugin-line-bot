import { spawn } from "child_process"

const port = Number(process.env.PORT ?? 4000)
const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6"
const maxTurns = Number(process.env.CLAUDE_MAX_TURNS ?? 3)
const claudeTimeout = 120000

// --- Types ---
interface Message {
  id: string
  role: "user" | "assistant"
  text: string
  source: "line" | "web"
  createdAt: string
}

interface SessionInfo {
  sdkSessionId: string
  userId: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

// --- Stores ---
const sessions = new Map<string, SessionInfo>()
const sseClients = new Set<ReadableStreamDefaultController>()

function broadcast(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const controller of sseClients) {
    try { controller.enqueue(payload) } catch { sseClients.delete(controller) }
  }
}

// --- Claude CLI ---
function callClaude(prompt: string, sessionId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--print", "--output-format", "text", "--model", model, "--max-turns", String(maxTurns)]
    if (sessionId) args.push("--resume", sessionId)
    args.push(prompt)

    const proc = spawn("claude", args, {
      timeout: claudeTimeout,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })

    proc.on("close", (code: number | null) => {
      if (code !== 0) return reject(new Error(stderr || `claude exited with code ${code}`))
      resolve(stdout.trim() || "Done.")
    })
    proc.on("error", (err: Error) => reject(new Error(`Failed to spawn claude: ${err.message}`)))
  })
}

// --- Chat ---
async function chat(userId: string, message: string, source: "line" | "web"): Promise<Message> {
  const session = sessions.get(userId)

  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text: message,
    source,
    createdAt: new Date().toISOString(),
  }

  if (session) {
    session.messages.push(userMsg)
    session.updatedAt = userMsg.createdAt
  }

  broadcast("message", { userId, message: userMsg })

  console.log(`[${new Date().toISOString()}] ${source.toUpperCase()} | User: ${userId} | Message: ${message}`)

  let responseText: string
  try {
    responseText = await callClaude(message)
  } catch (err: any) {
    responseText = `Error: ${err.message}`
  }

  const assistantMsg: Message = {
    id: crypto.randomUUID(),
    role: "assistant",
    text: responseText,
    source: "web",
    createdAt: new Date().toISOString(),
  }

  if (sessions.has(userId)) {
    const s = sessions.get(userId)!
    s.messages.push(assistantMsg)
    s.updatedAt = assistantMsg.createdAt
  } else {
    sessions.set(userId, {
      sdkSessionId: "",
      userId,
      messages: [userMsg, assistantMsg],
      createdAt: userMsg.createdAt,
      updatedAt: assistantMsg.createdAt,
    })
  }

  broadcast("message", { userId, message: assistantMsg })
  console.log(`[${new Date().toISOString()}] Reply: ${responseText.substring(0, 80)}...`)

  return assistantMsg
}

// --- HTTP Server ---
const server = Bun.serve({
  port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      })
    }

    const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() }, { headers })
    }

    if (req.method === "GET" && url.pathname === "/events") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller)
          controller.enqueue("event: connected\ndata: {}\n\n")
          const hb = setInterval(() => { try { controller.enqueue(": heartbeat\n\n") } catch { clearInterval(hb); sseClients.delete(controller) } }, 30000)
          req.signal.addEventListener("abort", () => { clearInterval(hb); sseClients.delete(controller) })
        },
      })
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*", "X-Accel-Buffering": "no" } })
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      const body = await req.json()
      const { userId, message, source = "web" } = body
      if (!userId || !message) return Response.json({ error: "userId and message are required" }, { status: 400, headers })
      const assistantMsg = await chat(userId, message, source)
      return Response.json({ response: assistantMsg.text, sessionId: null }, { headers })
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
      const list = Array.from(sessions.entries()).map(([uid, s]) => ({
        userId: uid, sdkSessionId: s.sdkSessionId, messageCount: s.messages.length,
        lastMessage: s.messages.at(-1)?.text?.substring(0, 50) || "",
        source: s.messages[0]?.source || "unknown", updatedAt: s.updatedAt,
      }))
      return Response.json({ sessions: list }, { headers })
    }

    if (req.method === "GET" && url.pathname.startsWith("/sessions/")) {
      const uid = decodeURIComponent(url.pathname.split("/sessions/")[1])
      const session = sessions.get(uid)
      if (!session) return Response.json({ error: "Session not found" }, { status: 404, headers })
      return Response.json({ userId: uid, messages: session.messages }, { headers })
    }

    if (req.method === "POST" && url.pathname === "/reset") {
      const body = await req.json()
      const oldSession = sessions.get(body.userId)
      // Archive old session with timestamp key so it stays visible
      if (oldSession && oldSession.messages.length > 0) {
        const archiveKey = `${body.userId}@${Date.now()}`
        sessions.set(archiveKey, { ...oldSession, userId: archiveKey })
      }
      sessions.delete(body.userId)
      broadcast("session.reset", { userId: body.userId })
      return Response.json({ status: "ok" }, { headers })
    }

    return new Response("Not Found", { status: 404 })
  },
})

console.log(`
========================================
  Claude Agent Service (CLI)
========================================
  Port:      ${server.port}
  Model:     ${model}
  Max Turns: ${maxTurns}
========================================
`)
