import { messagingApi } from "@line/bot-sdk";
import crypto from "crypto";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const port = process.env.PORT || 3000;
const agentServiceUrl = process.env.AGENT_SERVICE_URL || "http://claude-agent-service:4000";
const lineOaUrl = process.env.LINE_OA_URL || "";

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("Missing LINE credentials.");
  process.exit(1);
}

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", config.channelSecret)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function chatWithAgent(userId, message) {
  const res = await fetch(`${agentServiceUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, message, source: "line" }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `Agent service error: ${res.status}`);
  }
  const data = await res.json();
  return data.response;
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
    console.log(`[${new Date().toISOString()}] Replied: ${truncated.substring(0, 100)}...`);
  } catch (err) {
    console.error("Failed to reply to LINE:", err.message);
  }
}

async function handleTextMessage(event) {
  const userMessage = event.message.text;
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  console.log(`[${new Date().toISOString()}] User ${userId}: ${userMessage}`);

  // /help
  if (userMessage.trim() === "/help") {
    await replyToLine(replyToken, "Claude Code LINE Bot\n\n/new - เริ่ม session ใหม่\n/about - เกี่ยวกับ bot\n/help - แสดงคำสั่ง\n\nพิมพ์ข้อความอะไรก็ได้เพื่อคุยกับ AI");
    return;
  }

  // /about
  if (userMessage.trim() === "/about") {
    const aboutText = `Claude Code LINE Bot\n\nAI coding assistant ผ่าน LINE\nส่งข้อความเพื่อถามคำถามหรือเขียนโค้ดได้เลย${lineOaUrl ? `\n\nAdd friend: ${lineOaUrl}` : ""}`;
    await replyToLine(replyToken, aboutText);
    return;
  }

  // /new
  if (userMessage.trim() === "/new") {
    try {
      await fetch(`${agentServiceUrl}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await replyToLine(replyToken, "เริ่ม session ใหม่แล้ว พิมพ์ข้อความได้เลย!");
    } catch (err) {
      await replyToLine(replyToken, `Error: ${err.message}`);
    }
    return;
  }

  try {
    const response = await chatWithAgent(userId, userMessage);
    await replyToLine(replyToken, response);
  } catch (err) {
    console.error("Error:", err.message);
    await replyToLine(replyToken, `Error: ${err.message}`);
  }
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", timestamp: new Date().toISOString() });
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
  Claude Code LINE Bot (Bun)
========================================
  Port:          ${server.port}
  Agent Service: ${agentServiceUrl}
========================================
`);
