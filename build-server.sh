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

# Copy the backend into Tauri resources FIRST — this is the critical artifact.
# Doing it before MCP bundling guarantees the app never ships a stale backend even
# if a later step has problems.
mkdir -p "$RESOURCES/node_modules"
cp dist/server.cjs "$RESOURCES/server.cjs"
echo "✅ Backend copied to resources/server.cjs"

# Bundle the MCP filesystem server into a single standalone ESM file too, so the
# packaged app doesn't need server-filesystem's transitive deps (diff, glob,
# minimatch, zod-to-json-schema, …) copied into resources. MCPClient prefers
# this bundled file (mcp-server-filesystem.mjs) when present.
MCP_FS_ENTRY=""
for cand in \
  "$AGENT/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js" \
  "$ROOT/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"; do
  [ -f "$cand" ] && MCP_FS_ENTRY="$cand" && break
done
if [ -n "$MCP_FS_ENTRY" ]; then
  # server-filesystem uses top-level await → it must be bundled as ESM (.mjs),
  # not CJS. `if ...; then` keeps a failure from aborting the whole script (set -e).
  if npx esbuild "$MCP_FS_ENTRY" \
    --bundle --platform=node --target=node20 --format=esm \
    --outfile="$RESOURCES/mcp-server-filesystem.mjs" \
    --log-level=warning; then
    echo "✅ MCP filesystem server bundled: mcp-server-filesystem.mjs ($(du -sh "$RESOURCES/mcp-server-filesystem.mjs" | cut -f1))"
  else
    echo "⚠️  MCP bundle failed — packaged app will fall back to the node_modules copy"
  fi
else
  echo "⚠️  server-filesystem entry not found — MCP may not work in the packaged app"
fi

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
