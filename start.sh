#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

NODE=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE="$candidate"
    break
  fi
done

if [ -z "$NODE" ]; then
  echo "Node.js not found."
  exit 1
fi

if [ ! -d node_modules/express ]; then
  if [ -d "../BipAi/node_modules/express" ]; then
    ln -sf "../BipAi/node_modules" node_modules
  else
    echo "Run: npm install"
    exit 1
  fi
fi

echo "SubarnaPasal — http://localhost:${PORT:-3002}"
exec "$NODE" server.js
