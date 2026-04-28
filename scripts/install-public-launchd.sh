#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/scripts/crossx-public.plist.template"
PLIST_DST="$HOME/Library/LaunchAgents/ai.crossx.public.plist"
APP_SUPPORT_DIR="$HOME/Library/Application Support/CrossXPublic"
PREFLIGHT_SCRIPT="$ROOT_DIR/scripts/security-preflight.js"
PUBLIC_PORT="${PUBLIC_PORT:-8792}"
PUBLIC_MCP_PORT="${PUBLIC_MCP_PORT:-$((PUBLIC_PORT + 1))}"
DEFAULT_PUBLIC_NODE_BIN="$(command -v node || true)"
if [[ -z "$DEFAULT_PUBLIC_NODE_BIN" ]]; then
  DEFAULT_PUBLIC_NODE_BIN="/Users/kwok/.nvm/versions/node/v22.22.0/bin/node"
fi
PUBLIC_NODE_BIN="${PUBLIC_NODE_BIN:-$DEFAULT_PUBLIC_NODE_BIN}"

if [[ ! -x "$PUBLIC_NODE_BIN" ]]; then
  echo "Public node binary not executable: $PUBLIC_NODE_BIN" >&2
  exit 127
fi

echo "[security] Running production/public preflight before launchd install..."
env NODE_ENV=production PUBLIC_MODE=1 "$PUBLIC_NODE_BIN" "$PREFLIGHT_SCRIPT" --strict

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$ROOT_DIR/data"
mkdir -p "$APP_SUPPORT_DIR"
cp "$ROOT_DIR/scripts/run-public.sh" "$APP_SUPPORT_DIR/run-public.sh"
chmod +x "$APP_SUPPORT_DIR/run-public.sh"

read_env_value() {
  local key="$1"
  local current="${!key-}"
  if [[ -n "$current" ]]; then
    printf "%s" "$current"
    return 0
  fi
  local file line value
  for file in "$ROOT_DIR/.env.local" "$ROOT_DIR/.env"; do
    [[ -f "$file" ]] || continue
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
    [[ -n "$line" ]] || continue
    line="${line#export }"
    value="${line#*=}"
    value="$(printf "%s" "$value" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    printf "%s" "$value"
    return 0
  done
  printf ""
}

xml_escape() {
  local val="$1"
  val="${val//&/&amp;}"
  val="${val//</&lt;}"
  val="${val//>/&gt;}"
  val="${val//\"/&quot;}"
  val="${val//\'/&apos;}"
  printf "%s" "$val"
}

EXTRA_ENV_FILE="$(mktemp)"
trap 'rm -f "$EXTRA_ENV_FILE"' EXIT
for key in OPENAI_API_KEY OPENAI_KEY CHATGPT_API_KEY OPENAI_MODEL OPENAI_CHAT_MODEL OPENAI_BASE_URL OPENAI_TIMEOUT_MS GAODE_KEY AMAP_KEY PARTNER_HUB_KEY PARTNER_HUB_BASE_URL PARTNER_HUB_PROVIDER PARTNER_HUB_CHANNELS PARTNER_HUB_TIMEOUT_MS RAIL_KEY RAIL_BASE_URL RAIL_PROVIDER RAIL_CHANNELS RAIL_TIMEOUT_MS JUTUI_TOKEN JUHE_FLIGHT_KEY; do
  value="$(read_env_value "$key")"
  [[ -n "$value" ]] || continue
  escaped="$(xml_escape "$value")"
  printf '    <key>%s</key>\n    <string>%s</string>\n' "$key" "$escaped" >> "$EXTRA_ENV_FILE"
done

if lsof -nP -iTCP:"$PUBLIC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PUBLIC_PORT} is already in use. Refusing to replace the running public instance."
  echo "Set PUBLIC_PORT to another value, or stop the existing listener during a maintenance window."
  exit 2
fi

if lsof -nP -iTCP:"$PUBLIC_MCP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "MCP port ${PUBLIC_MCP_PORT} is already in use. Refusing to start a conflicting public instance."
  echo "Set PUBLIC_MCP_PORT to another value, or stop the existing listener during a maintenance window."
  exit 2
fi

awk -v root="$ROOT_DIR" -v launch_workdir="$APP_SUPPORT_DIR" -v public_port="$PUBLIC_PORT" -v public_mcp_port="$PUBLIC_MCP_PORT" -v public_node_bin="$PUBLIC_NODE_BIN" -v runner="$APP_SUPPORT_DIR/run-public.sh" -v extra_file="$EXTRA_ENV_FILE" '
{
  gsub("__LAUNCH_WORKDIR__", launch_workdir)
  gsub("__WORKDIR__", root)
  gsub("__PUBLIC_PORT__", public_port)
  gsub("__PUBLIC_MCP_PORT__", public_mcp_port)
  gsub("__PUBLIC_NODE_BIN__", public_node_bin)
  gsub("__RUN_PUBLIC_SH__", runner)
  if ($0 ~ /__EXTRA_ENV_VARS__/) {
    while ((getline line < extra_file) > 0) print line
    close(extra_file)
    next
  }
  print
}
' "$PLIST_SRC" > "$PLIST_DST"

: > "$ROOT_DIR/data/public.out.log"
: > "$ROOT_DIR/data/public.err.log"

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/ai.crossx.public" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/ai.crossx.public" 2>/dev/null || true

printf "Installed and started: %s\n" "$PLIST_DST"
printf "Public app health: http://127.0.0.1:%s/healthz\n" "$PUBLIC_PORT"
printf "Public MCP: http://127.0.0.1:%s\n" "$PUBLIC_MCP_PORT"
printf "Logs: %s\n" "$ROOT_DIR/data/public.out.log"
printf "Logs: %s\n" "$ROOT_DIR/data/public.err.log"
