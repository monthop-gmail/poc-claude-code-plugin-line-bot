# Claude Code LINE Bot Plugin

Claude Code plugin ที่เชื่อม LINE Bot เข้ากับ Claude Code CLI ผ่าน headless mode

```
LINE App → Cloudflare Tunnel → Bun Server → claude --print → ตอบกลับ LINE
```

## Quick Start

### 1. ติดตั้ง Plugin

```bash
claude plugin install poc-claude-code-plugin-line-bot@<your-marketplace>
```

หรือรันตรงจาก repo:

```bash
git clone https://github.com/monthop-gmail/poc-claude-code-plugin-line-bot.git
cd poc-claude-code-plugin-line-bot
```

### 2. ตั้งค่า LINE Credentials

สร้าง `.env` จาก template:

```bash
cp server/.env.example .env
```

แก้ไข `.env`:

```env
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_CHANNEL_SECRET=your_secret_here
```

> รับ credentials ได้ที่ https://developers.line.biz/console/ → สร้าง Messaging API channel

### 3. รัน Server

**ด้วย Docker (แนะนำ):**

```bash
docker compose up --build -d
```

**ด้วย Bun โดยตรง:**

```bash
cd server
bun install
bun run index.js
```

### 4. ตั้ง Webhook URL

ไปที่ LINE Developer Console → Messaging API → Webhook settings:

- Webhook URL: `https://<your-domain>/webhook`
- เปิด **Use webhook** = ON
- กด **Verify** เพื่อทดสอบ

## โครงสร้างไฟล์

```
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── skills/
│   ├── start-server/
│   │   └── SKILL.md         # Skill: start server
│   └── stop-server/
│       └── SKILL.md         # Skill: stop server
├── server/
│   ├── index.js             # Bun webhook server
│   ├── package.json
│   └── .env.example
├── Dockerfile
├── docker-compose.yml
└── .env                     # credentials (ไม่อยู่ใน git)
```

## ข้อจำกัด (POC)

- ไม่จำบทสนทนา — ทุกข้อความเป็น session ใหม่
- รองรับเฉพาะข้อความ text
- LINE message limit 5,000 ตัวอักษร
