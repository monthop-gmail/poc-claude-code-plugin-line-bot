# Claude Code LINE Bot

ใช้ Claude AI ผ่าน LINE และ Web UI — สร้างจาก Claude Agent SDK + botforge server

```
LINE App → LINE Bot → Agent Service (botforge) → Claude AI → ตอบกลับ
Web UI  → Agent Service (botforge) → Claude AI → ตอบกลับ
```

## Features

- คุยกับ Claude AI ผ่าน LINE ได้ทันที
- Web UI สำหรับงานซับซ้อน พร้อม SSE real-time
- จำบทสนทนาแยกตาม user (session management + resume)
- ข้อความจาก LINE แสดงใน Web UI ได้ (shared sessions)
- Cost tracking ต่อ session
- Web UI มีระบบ Login
- Agent Service ใช้ botforge server (Hono + Agent SDK 0.2.85)

## LINE Commands

| Command | Description |
|---------|-------------|
| `/new` | เริ่ม session ใหม่ |
| `/abort` | ยกเลิกคำสั่งที่กำลังทำงาน |
| `/cost` | ดูค่าใช้จ่ายของ session |
| `/about` | เกี่ยวกับ bot |
| `/help` | แสดงคำสั่ง |

## Architecture

```
┌──────────┐     ┌──────────────────┐     ┌───────────────────┐
│ LINE App │────▶│ cowork-claudecode│────▶│ claude-agent-     │
│          │◀────│ -line-bot (:3000)│◀────│ service (:4000)   │
└──────────┘     └──────────────────┘     │                   │
                                          │ botforge server   │
┌──────────┐     ┌──────────────────┐     │ (Hono + Agent SDK │
│ Browser  │────▶│ cowork-claudecode│────▶│  + OAuth + SSE)   │
│ (login)  │◀────│ -server (:4096)  │◀────│                   │
└──────────┘     └──────────────────┘     └───────────────────┘
                          │
                 ┌────────┴────────┐
                 │ cloudflared     │
                 │ (tunnel)        │
                 └─────────────────┘
```

## Agent Service API (botforge server)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/session` | POST | สร้าง session ใหม่ |
| `/session` | GET | list sessions ทั้งหมด |
| `/session/:id` | GET | ดู session details |
| `/session/:id/message` | POST | ส่งข้อความ `{ prompt }` |
| `/session/:id/message` | GET | ดูประวัติข้อความ |
| `/session/:id/abort` | POST | ยกเลิกคำสั่ง |
| `/session/:id` | DELETE | ลบ session |
| `/event` | GET | SSE real-time stream |
| `/health` | GET | health check |

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

# API password (optional, สำหรับ protect agent service)
API_PASSWORD=

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
├── agent-service/            # botforge server (shared service)
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.ts          # Hono HTTP server + REST API
│       ├── claude.ts         # Agent SDK wrapper (query, resume, SSE)
│       ├── session.ts        # Session management (CRUD, cost tracking)
│       └── events.ts         # SSE event bus
├── server/
│   ├── index.js              # LINE Bot webhook server
│   ├── package.json
│   └── .env.example
├── web-ui/
│   ├── index.html            # Web UI (sessions, chat, SSE real-time)
│   └── server.js             # Web server with login + proxy
├── Dockerfile.linebot
├── Dockerfile.webui
├── docker-compose.yml
└── .env                      # credentials (ไม่อยู่ใน git)
```

## Cloudflare Tunnel Setup

สร้าง tunnel ที่ https://dash.cloudflare.com/ พร้อม 2 public hostnames:

| Hostname | Service |
|----------|---------|
| `your-linebot-domain` | `http://cowork-claudecode-line-bot:3000` |
| `your-web-domain` | `http://cowork-claudecode-server:4096` |
