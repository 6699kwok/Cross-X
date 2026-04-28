#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/scripts/crossx-agent.plist.template"
PLIST_DST="$HOME/Library/LaunchAgents/ai.crossx.mvp.plist"
PREFLIGHT_SCRIPT="$ROOT_DIR/scripts/security-preflight.js"
DEFAULT_LAUNCHD_NODE_BIN="$(command -v node || true)"
if [[ -z "$DEFAULT_LAUNCHD_NODE_BIN" ]]; then
  DEFAULT_LAUNCHD_NODE_BIN="/Users/kwok/.nvm/versions/node/v22.22.0/bin/node"
fi
LAUNCHD_NODE_BIN="${LAUNCHD_NODE_BIN:-$DEFAULT_LAUNCHD_NODE_BIN}"

if [[ ! -x "$LAUNCHD_NODE_BIN" ]]; then
  echo "Launchd node binary not executable: $LAUNCHD_NODE_BIN" >&2
  exit 127
fi

echo "[security] Running production preflight before launchd install..."
env NODE_ENV=production LAUNCHD_NODE_BIN="$LAUNCHD_NODE_BIN" "$LAUNCHD_NODE_BIN" "$PREFLIGHT_SCRIPT"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$ROOT_DIR/data"

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
for key in OPENAI_API_KEY OPENAI_KEY CHATGPT_API_KEY OPENAI_MODEL OPENAI_CHAT_MODEL OPENAI_BASE_URL OPENAI_TIMEOUT_MS GAODE_KEY AMAP_KEY PARTNER_HUB_KEY PARTNER_HUB_BASE_URL PARTNER_HUB_PROVIDER PARTNER_HUB_CHANNELS PARTNER_HUB_TIMEOUT_MS RAIL_KEY RAIL_BASE_URL RAIL_PROVIDER RAIL_CHANNELS RAIL_TIMEOUT_MS; do
  value="$(read_env_value "$key")"
  [[ -n "$value" ]] || continue
  escaped="$(xml_escape "$value")"
  printf '    <key>%s</key>\n    <string>%s</string>\n' "$key" "$escaped" >> "$EXTRA_ENV_FILE"
done

awk -v root="$ROOT_DIR" -v launchd_node_bin="$LAUNCHD_NODE_BIN" -v extra_file="$EXTRA_ENV_FILE" '
{
  gsub("__WORKDIR__", root)
  gsub("__LAUNCHD_NODE_BIN__", launchd_node_bin)
  if ($0 ~ /__EXTRA_ENV_VARS__/) {
    while ((getline line < extra_file) > 0) print line
    close(extra_file)
    next
  }
  print
}
' "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/ai.crossx.mvp" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/ai.crossx.mvp" 2>/dev/null || true

printf "Installed and started: %s\n" "$PLIST_DST"
printf "Open: http://127.0.0.1:8787\n"
printf "Logs: %s\n" "$ROOT_DIR/data/launchd.out.log"
printf "Logs: %s\n" "$ROOT_DIR/data/launchd.err.log"
