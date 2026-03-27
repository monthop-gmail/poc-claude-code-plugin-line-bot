const agentServiceUrl = process.env.AGENT_SERVICE_URL || "http://claude-agent-service:4000";
const port = process.env.PORT || 4096;
const password = process.env.WEB_PASSWORD || "";

function checkAuth(req) {
  if (!password) return true;
  const cookie = req.headers.get("cookie") || "";
  return cookie.includes(`auth=${password}`);
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    // Login page
    if (url.pathname === "/login") {
      if (req.method === "POST") {
        const form = await req.formData();
        if (form.get("password") === password) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: "/",
              "Set-Cookie": `auth=${password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
            },
          });
        }
        return new Response(loginHTML("Wrong password"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response(loginHTML(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Check auth for all other routes
    if (password && !checkAuth(req)) {
      return new Response(null, { status: 302, headers: { Location: "/login" } });
    }

    // Proxy /api/events → SSE passthrough
    if (url.pathname === "/api/events") {
      const agentRes = await fetch(`${agentServiceUrl}/events`, {
        headers: { Accept: "text/event-stream" },
        signal: req.signal,
      });
      return new Response(agentRes.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Proxy /api/* → agent service
    if (url.pathname.startsWith("/api/")) {
      const agentPath = url.pathname.replace("/api", "");
      const agentUrl = `${agentServiceUrl}${agentPath}`;

      const proxyRes = await fetch(agentUrl, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: req.method === "POST" ? await req.text() : undefined,
      });

      const data = await proxyRes.text();
      return new Response(data, {
        status: proxyRes.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Serve HTML
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await Bun.file(import.meta.dir + "/index.html").text();
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    return new Response("Not Found", { status: 404 });
  },
});

function loginHTML(error) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login - Claude Code Web</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .login { background: #16213e; padding: 32px; border-radius: 12px; border: 1px solid #0f3460; width: 300px; }
  h1 { font-size: 18px; color: #e94560; margin-bottom: 20px; }
  input { width: 100%; padding: 10px; border: 1px solid #0f3460; border-radius: 8px; background: #1a1a2e; color: #e0e0e0; font-size: 14px; margin-bottom: 12px; box-sizing: border-box; }
  button { width: 100%; padding: 10px; background: #e94560; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
  .error { color: #e94560; font-size: 13px; margin-bottom: 12px; }
</style></head>
<body><div class="login"><h1>Claude Code Web</h1>
${error ? `<div class="error">${error}</div>` : ""}
<form method="POST"><input type="password" name="password" placeholder="Password" autofocus>
<button type="submit">Login</button></form></div></body></html>`;
}

console.log(`
========================================
  Claude Code Web UI
========================================
  Port:          ${server.port}
  Agent Service: ${agentServiceUrl}
  Auth:          ${password ? "enabled" : "disabled"}
========================================
`);
