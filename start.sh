#!/usr/bin/env sh
# Start the ApplyPilot local server (macOS / Linux).
cd "$(dirname "$0")/server" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js was not found: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund || exit 1
exec node src/index.js
