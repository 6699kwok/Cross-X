#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
NODE_BIN="${PUBLIC_NODE_BIN:-/Users/kwok/.nvm/versions/node/v22.22.0/bin/node}"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "[public] node binary not executable: $NODE_BIN" >&2
  exit 127
fi

export NODE_ENV="${NODE_ENV:-production}"
export PUBLIC_MODE="${PUBLIC_MODE:-1}"

cd "$ROOT_DIR"
exec "$NODE_BIN" server.js
