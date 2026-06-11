#!/bin/bash
# build-server.sh — Bundle agent-core for inclusion in the Tauri .app
# Run this before `npm run tauri build`

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
AGENT="$ROOT/packages/agent-core"
RESOURCES="$ROOT/apps/desktop/src-tauri/resources"

echo "🔨 Building agent server bundle..."

cd "$AGENT"

# Bundle to a single CJS file (native modules are external)
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=dist/server.cjs \
  --format=cjs \
  --external:better-sqlite3 \
  --external:node-pty \
  --external:pdf-parse \
  --external:mammoth \
  --external:@modelcontextprotocol/server-filesystem \
  --log-level=warning

echo "✅ Server bundled: dist/server.cjs ($(du -sh dist/server.cjs | cut -f1))"

# Copy to Tauri resources
mkdir -p "$RESOURCES/node_modules"
cp dist/server.cjs "$RESOURCES/server.cjs"

# Modules to copy — check both agent-core and monorepo root node_modules
MODULES=("better-sqlite3" "node-pty" "pdf-parse" "mammoth" "@modelcontextprotocol" "bindings" "file-uri-to-path")

for mod in "${MODULES[@]}"; do
  # Check agent-core first, then monorepo root
  if [ -d "$AGENT/node_modules/$mod" ]; then
    echo "📦 Copying: $mod (from agent-core)"
    cp -r "$AGENT/node_modules/$mod" "$RESOURCES/node_modules/$mod"
  elif [ -d "$ROOT/node_modules/$mod" ]; then
    echo "📦 Copying: $mod (from root)"
    cp -r "$ROOT/node_modules/$mod" "$RESOURCES/node_modules/$mod"
  else
    echo "⚠️  Not found: $mod"
  fi
done

echo ""
echo "✅ Bundle ready: $RESOURCES"
echo "   Contents:"
ls -lh "$RESOURCES/"
echo ""
echo "Next: cd apps/desktop && npm run tauri build"
