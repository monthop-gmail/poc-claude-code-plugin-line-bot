import { messagingApi } from "@line/bot-sdk";
import { spawn } from "child_process";
import crypto from "crypto";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const port = process.env.PORT || 3000;
const claudeWorkDir = process.env.CLAUDE_WORK_DIR || process.env.HOME;
const claudeTimeout = parseInt(process.env.CLAUDE_TIMEOUT || "120000", 10);

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("Missing LINE credentials. Copy .env.example to .env and fill in your credentials.");
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

function callClaudeCode(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", [
      "--print",
      "--output-format", "text",
      "--max-turns", "1",
      prompt,
    ], {
      cwd: claudeWorkDir,
      timeout: claudeTimeout,
      env: { ...process.env, NO_COLOR: "1" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr || `claude exited with code ${code}`));
      const response = stdout.trim();
      if (!response) return reject(new Error("Empty response from Claude Code"));
      resolve(response);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
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

  try {
    const response = await callClaudeCode(userMessage);
    await replyToLine(replyToken, response);
  } catch (err) {
    console.error("Error processing message:", err.message);
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
  Claude Code LINE Bot Server (Bun)
========================================
  Port:        ${server.port}
  Webhook URL: http://localhost:${server.port}/webhook
  Health:      http://localhost:${server.port}/health
  Work Dir:    ${claudeWorkDir}
  Timeout:     ${claudeTimeout}ms
========================================
`);
