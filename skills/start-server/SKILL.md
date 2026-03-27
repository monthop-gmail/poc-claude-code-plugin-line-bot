---
name: start
description: Start the LINE Bot webhook server that connects LINE to Claude Code
---

Start the LINE Bot webhook server by running the following command from the plugin's server directory:

```bash
cd "$PLUGIN_DIR/server" && node index.js
```

Before starting, verify:
1. The `.env` file exists in the server directory with LINE credentials configured
2. Dependencies are installed (`npm install` in the server directory)

If the server starts successfully, inform the user of the port and webhook URL.
