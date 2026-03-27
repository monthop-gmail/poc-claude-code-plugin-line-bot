# Claude Code LINE Bot Plugin

Claude Code plugin ที่เชื่อม LINE Bot เข้ากับ Claude Code CLI — ใช้ AI coding assistant ผ่าน LINE และ Web UI

```
LINE App → LINE Bot → Claude Agent Service → Claude Code CLI → ตอบกลับ
Web UI  → Agent Service → Claude Code CLI → ตอบกลับ
```

## Features

- คุยกับ Claude AI ผ่าน LINE ได้ทันที
- Web UI สำหรับงานซับซ้อน พร้อม SSE real-time
- จำบทสนทนาแยกตาม user (session management)
- ข้อความจาก LINE แสดงใน Web UI ได้ (shared session)
- `/new` เก็บ session เดิมไว้ ไม่หาย
- Web UI มีระบบ Login

## LINE Commands

| Command | Description |
|---------|-------------|
| `/new` | เริ่ม session ใหม่ (เก็บ session เดิมไว้) |
| `/about` | เกี่ยวกับ bot |
| `/help` | แสดงคำสั่ง |

## Architecture

```
┌──────────┐     ┌──────────────────┐     ┌───────────────────┐
│ LINE App │────▶│ cowork-claudecode│────▶│ claude-agent-     │
│          │◀────│ -line-bot (:3000)│◀────│ service (:4000)   │
└──────────┘     └──────────────────┘     │                   │
                                          │ claude --print    │
┌──────────┐     ┌──────────────────┐     │ --model sonnet    │
│ Browser  │────▶│ cowork-claudecode│────▶│                   │
│          │◀────│ -server (:4096)  │◀────│ SSE broadcast     │
└──────────┘     └──────────────────┘     └───────────────────┘
                          │
                 ┌────────┴────────┐
                 │ cloudflared     │
                 │ (tunnel)        │
                 └─────────────────┘
```

## Quick Start (Docker)

### 1. Clone repo

```bash
git clone https://github.com/monthop-gmail/poc-claude-code-plugin-line-bot.git
cd poc-claude-code-plugin-line-bot
```

### 2. ตั้งค่า

```bash
cp server/.env.example .env
```

แก้ไข `.env`:

```env
# LINE Bot credentials (จาก https://developers.line.biz/console/)
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret

# Web UI password
WEB_PASSWORD=your_password

# Cloudflare Tunnel token (จาก https://dash.cloudflare.com/)
CLOUDFLARE_TUNNEL_TOKEN=your_tunnel_token

# (Optional)
LINE_OA_URL=https://line.me/ti/p/@your_bot
```

### 3. ตั้งค่า Claude OAuth

ต้องมี Claude OAuth credentials บน host machine:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

ไฟล์ `~/.claude/.credentials.json` จะถูก mount เข้า container อัตโนมัติ

### 4. รัน

```bash
docker compose up --build -d
```

### 5. ตั้ง Webhook URL

ที่ LINE Developer Console → Messaging API:
- Webhook URL: `https://<your-domain>/webhook`
- เปิด **Use webhook** = ON
- กด **Verify**

## โครงสร้างไฟล์

```
├── agent-service/
│   ├── index.ts          # Agent service (Claude CLI + session + SSE)
│   └── package.json
├── server/
│   ├── index.js          # LINE Bot webhook server
│   ├── package.json
│   └── .env.example
├── web-ui/
│   ├── index.html        # Web UI (sessions, chat, SSE real-time)
│   └── server.js         # Web server with login
├── .claude-plugin/
│   └── plugin.json       # Claude Code plugin manifest
├── skills/               # Plugin skills (start/stop)
├── Dockerfile.agent      # Agent service (node + claude CLI)
├── Dockerfile.linebot    # LINE Bot (bun)
├── Dockerfile.webui      # Web UI (bun)
├── docker-compose.yml
└── .env                  # credentials (ไม่อยู่ใน git)
```

## Cloudflare Tunnel Setup

สร้าง tunnel ที่ https://dash.cloudflare.com/ พร้อม 2 public hostnames:

| Hostname | Service |
|----------|---------|
| `your-linebot-domain` | `http://cowork-claudecode-line-bot:3000` |
| `your-web-domain` | `http://cowork-claudecode-server:4096` |
