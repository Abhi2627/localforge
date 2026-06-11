#!/bin/bash
# LocalForge Launcher - Double-click to start everything

FORGE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find node
NODE=""
for p in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -x "$p" ] && NODE="$p" && break
done
[ -z "$NODE" ] && NODE=$(command -v node 2>/dev/null)

if [ -z "$NODE" ]; then
  osascript -e 'display dialog "Node.js not found.\n\nPlease install Node.js from https://nodejs.org then try again." buttons {"OK"} default button "OK" with icon stop'
  open "https://nodejs.org"
  exit 1
fi

# Kill old server
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 0.3

# Start agent server
AGENT_DIR="$FORGE_DIR/packages/agent-core"
if [ ! -d "$AGENT_DIR/node_modules" ]; then
  osascript -e 'display dialog "Installing dependencies... This will take a minute." buttons {"OK"} default button "OK"'
  cd "$AGENT_DIR" && npm install --silent
fi

cd "$AGENT_DIR"
"$NODE" ./node_modules/.bin/tsx src/index.ts > /tmp/localforge-server.log 2>&1 &
SERVER_PID=$!

# Wait for server (max 15s)
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -s http://localhost:3001/health > /dev/null 2>&1 && break
  sleep 1
done

# Open the app
if [ -d "/Applications/LocalForge.app" ]; then
  open "/Applications/LocalForge.app"
elif [ -d "$FORGE_DIR/apps/desktop/src-tauri/target/release/bundle/macos/LocalForge.app" ]; then
  open "$FORGE_DIR/apps/desktop/src-tauri/target/release/bundle/macos/LocalForge.app"
else
  osascript -e 'display dialog "LocalForge.app not found.\n\nPlease run: npm run tauri build\nfrom apps/desktop to build the app first." buttons {"OK"} default button "OK" with icon caution'
fi
