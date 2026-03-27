FROM oven/bun:latest

WORKDIR /app

# Install Claude Code CLI
RUN apt-get update && apt-get install -y npm && npm install -g @anthropic-ai/claude-code && apt-get clean

# Copy and install dependencies
COPY server/package.json server/bun.lock* ./
RUN bun install --production

COPY server/ ./

EXPOSE 3000

CMD ["bun", "run", "index.js"]
