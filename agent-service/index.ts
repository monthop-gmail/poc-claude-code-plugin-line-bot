import { query } from "@anthropic-ai/claude-agent-sdk"

const port = Number(process.env.PORT ?? 4000)
const model = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6"
const maxTurns = Number(process.env.CLAUDE_MAX_TURNS ?? 3)
const maxBudgetUsd = Number(process.env.CLAUDE_MAX_BUDGET_USD ?? 1.00)

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

// --- Claude Agent SDK ---
async function callClaude(prompt: string, resumeSessionId?: string): Promise<{ text: string; sessionId: string; costUsd: number }> {
  let sdkSessionId = ""
  let resultText = ""
  let costUsd = 0
  let isError = false

  const q = query({
    prompt,
    options: {
      model,
      maxTurns,
      maxBudgetUsd,
      resume: resumeSessionId,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  })

  for await (const msg of q) {
    switch (msg.type) {
      case "system": {
        if ("session_id" in msg && msg.session_id) {
          sdkSessionId = msg.session_id as string
        }
        break
      }
      case "assistant": {
        const m = msg as any
        sdkSessionId = m.session_id || sdkSessionId
        break
      }
      case "result": {
        const m = msg as any
        sdkSessionId = m.session_id || sdkSessionId
        costUsd = m.total_cost_usd ?? 0
        isError = m.is_error ?? false
        resultText = m.subtype === "success"
          ? (m.result ?? "")
          : (m.result ?? m.error ?? "Error")
        if (m.subtype !== "success") isError = true
        break
      }
    }
  }

  return { text: resultText || "Done.", sessionId: sdkSessionId, costUsd }
}

// --- Chat ---
async function chat(userId: string, message: string, source: "line" | "web"): Promise<Message> {
  const session = sessions.get(userId)
  const resumeSessionId = session?.sdkSessionId

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
  console.log(`[${new Date().toISOString()}] ${source.toUpperCase()} | User: ${userId} | Session: ${resumeSessionId ?? "new"} | ${message}`)

  let responseText: string
  let newSessionId = resumeSessionId || ""

  try {
    const result = await callClaude(message, resumeSessionId)
    responseText = result.text
    newSessionId = result.sessionId || newSessionId
    console.log(`[${new Date().toISOString()}] Cost: $${result.costUsd.toFixed(4)}`)
  } catch (err: any) {
    // Session expired — retry without resume
    if (resumeSessionId && (err?.message?.includes("not found") || err?.message?.includes("No conversation") || err?.message?.includes("exited with code"))) {
      console.log(`[${new Date().toISOString()}] Session expired, retrying without resume`)
      try {
        const result = await callClaude(message)
        responseText = result.text
        newSessionId = result.sessionId
      } catch (retryErr: any) {
        responseText = `Error: ${retryErr.message}`
      }
    } else {
      responseText = `Error: ${err.message}`
    }
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
    s.sdkSessionId = newSessionId || s.sdkSessionId
    s.messages.push(assistantMsg)
    s.updatedAt = assistantMsg.createdAt
  } else {
    sessions.set(userId, {
      sdkSessionId: newSessionId,
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
      const session = sessions.get(userId)
      return Response.json({ response: assistantMsg.text, sessionId: session?.sdkSessionId || null }, { headers })
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
  Claude Agent Service (Agent SDK)
========================================
  Port:      ${server.port}
  Model:     ${model}
  Max Turns: ${maxTurns}
  Budget:    $${maxBudgetUsd}
========================================
`)
