import { messagingApi } from "@line/bot-sdk";
import crypto from "crypto";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const port = process.env.PORT || 3000;
const serverUrl = process.env.SERVER_URL || "http://claude-agent-service:4096";
const serverPassword = process.env.SERVER_PASSWORD || "";
const lineOaUrl = process.env.LINE_OA_URL || "";

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("Missing LINE credentials.");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// userId → sessionId
const sessions = new Map();

function validateSignature(body, signature) {
  return crypto.createHmac("sha256", config.channelSecret).update(body).digest("base64") === signature;
}

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (serverPassword) h["Authorization"] = `Bearer ${serverPassword}`;
  return h;
}

async function getOrCreateSession(userId) {
  if (sessions.has(userId)) return sessions.get(userId);

  const res = await fetch(`${serverUrl}/session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  const data = await res.json();
  sessions.set(userId, data.id);
  console.log(`[${ts()}] New session for ${userId}: ${data.id}`);
  return data.id;
}

async function sendMessage(sessionId, prompt) {
  const res = await fetch(`${serverUrl}/session/${sessionId}/message`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Server error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.result || data.text || "Done.";
}

async function replyToLine(replyToken, text) {
  const maxLen = 5000;
  const truncated = text.length > maxLen
    ? text.substring(0, maxLen - 20) + "\n...(truncated)"
    : text;

  try {
    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: truncated }],
    });
    console.log(`[${ts()}] Replied: ${truncated.substring(0, 80)}...`);
  } catch (err) {
    console.error("Failed to reply:", err.message);
  }
}

function ts() { return new Date().toISOString(); }

async function handleTextMessage(event) {
  const text = event.message.text;
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  console.log(`[${ts()}] User ${userId}: ${text}`);

  // /help
  if (text.trim() === "/help") {
    await replyToLine(replyToken, "Claude Code LINE Bot\n\n/new - เริ่ม session ใหม่\n/abort - ยกเลิกคำสั่งที่กำลังทำงาน\n/cost - ดูค่าใช้จ่าย\n/about - เกี่ยวกับ bot\n/help - แสดงคำสั่ง\n\nพิมพ์ข้อความอะไรก็ได้เพื่อคุยกับ AI");
    return;
  }

  // /about
  if (text.trim() === "/about") {
    const aboutText = `Claude Code LINE Bot\n\nAI coding assistant ผ่าน LINE\nส่งข้อความเพื่อถามคำถามหรือเขียนโค้ดได้เลย${lineOaUrl ? `\n\nAdd friend: ${lineOaUrl}` : ""}`;
    await replyToLine(replyToken, aboutText);
    return;
  }

  // /new
  if (text.trim() === "/new") {
    const sessionId = sessions.get(userId);
    if (sessionId) {
      await fetch(`${serverUrl}/session/${sessionId}`, { method: "DELETE", headers: authHeaders() });
    }
    sessions.delete(userId);
    await replyToLine(replyToken, "เริ่ม session ใหม่แล้ว พิมพ์ข้อความได้เลย!");
    return;
  }

  // /abort
  if (text.trim() === "/abort") {
    const sessionId = sessions.get(userId);
    if (sessionId) {
      await fetch(`${serverUrl}/session/${sessionId}/abort`, { method: "POST", headers: authHeaders() });
      await replyToLine(replyToken, "ยกเลิกคำสั่งแล้ว");
    } else {
      await replyToLine(replyToken, "ไม่มี session ที่กำลังทำงานอยู่");
    }
    return;
  }

  // /cost
  if (text.trim() === "/cost") {
    const sessionId = sessions.get(userId);
    if (sessionId) {
      const res = await fetch(`${serverUrl}/session/${sessionId}`, { headers: authHeaders() });
      const data = await res.json();
      await replyToLine(replyToken, `Session: ${sessionId}\nCost: $${(data.totalCost || 0).toFixed(4)}\nMessages: ${(data.messages || []).length}`);
    } else {
      await replyToLine(replyToken, "ยังไม่มี session");
    }
    return;
  }

  // Normal message
  try {
    const sessionId = await getOrCreateSession(userId);
    const response = await sendMessage(sessionId, text);
    await replyToLine(replyToken, response);
  } catch (err) {
    console.error("Error:", err.message);
    // Reset session on error
    if (err.message.includes("not found") || err.message.includes("404")) {
      sessions.delete(userId);
    }
    await replyToLine(replyToken, `Error: ${err.message}`);
  }
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: ts() });
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      const body = await req.text();
      const signature = req.headers.get("x-line-signature");

      if (!validateSignature(body, signature)) {
        return new Response("Invalid signature", { status: 403 });
      }

      const parsed = JSON.parse(body);
      for (const event of parsed.events) {
        if (event.type === "message" && event.message.type === "text") {
          handleTextMessage(event);
        }
      }

      return Response.json({ status: "ok" });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`
========================================
  Claude Code LINE Bot
========================================
  Port:    ${server.port}
  Server:  ${serverUrl}
========================================
`);
