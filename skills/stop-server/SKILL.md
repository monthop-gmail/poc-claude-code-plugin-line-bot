---
name: stop
description: Stop the running LINE Bot webhook server
---

Stop the LINE Bot webhook server by finding and killing the process:

```bash
pkill -f "node.*claude-code-line-bot/server/index.js" || echo "Server is not running"
```

Inform the user whether the server was stopped or was not running.
