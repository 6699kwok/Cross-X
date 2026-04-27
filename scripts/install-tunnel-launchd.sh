#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_DST="$HOME/Library/LaunchAgents/ai.crossx.tunnel.plist"
APP_SUPPORT_DIR="$HOME/Library/Application Support/CrossXTunnel"
PREFLIGHT_SCRIPT="$ROOT_DIR/scripts/security-preflight.js"
PUBLIC_PORT="${PUBLIC_PORT:-8792}"
DEFAULT_TUNNEL_NODE_BIN="$(command -v node || true)"
if [[ -z "$DEFAULT_TUNNEL_NODE_BIN" ]]; then
  DEFAULT_TUNNEL_NODE_BIN="/Users/kwok/.nvm/versions/node/v22.22.0/bin/node"
fi
TUNNEL_NODE_BIN="${TUNNEL_NODE_BIN:-$DEFAULT_TUNNEL_NODE_BIN}"

if [[ ! -x "$TUNNEL_NODE_BIN" ]]; then
  echo "Tunnel preflight node binary not executable: $TUNNEL_NODE_BIN" >&2
  exit 127
fi

echo "[security] Running production/public preflight before tunnel install..."
env NODE_ENV=production PUBLIC_MODE=1 "$TUNNEL_NODE_BIN" "$PREFLIGHT_SCRIPT" --strict

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$ROOT_DIR/data"
mkdir -p "$APP_SUPPORT_DIR"

read_env_value() {
  local key="$1"
  local current="${!key-}"
  if [[ -n "$current" ]]; then
    printf "%s" "$current"
    return 0
  fi
  local file line value
  for file in "$ROOT_DIR/.env.runtime.local" "$ROOT_DIR/.env.local" "$ROOT_DIR/.env"; do
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

TARGET_URL="$(read_env_value PUBLIC_TUNNEL_TARGET_URL)"
if [[ -z "$TARGET_URL" ]]; then
  TARGET_URL="http://127.0.0.1:${PUBLIC_PORT}"
fi

if ! curl -fsS --max-time 5 "${TARGET_URL%/}/healthz" >/dev/null; then
  echo "Target is not healthy: ${TARGET_URL}"
  exit 2
fi

CLOUDFLARED_BIN="$(read_env_value CLOUDFLARED_BIN)"
if [[ -z "$CLOUDFLARED_BIN" ]]; then
  CLOUDFLARED_BIN="$(command -v cloudflared || true)"
fi
if [[ -z "$CLOUDFLARED_BIN" ]]; then
  echo "cloudflared not found. Install it or set CLOUDFLARED_BIN."
  exit 2
fi

program_arg_xml() {
  local value="$1"
  printf '    <string>%s</string>\n' "$(xml_escape "$value")"
}

RUNNER_SRC="$ROOT_DIR/scripts/run-cloudflared.sh"
RUNNER="$APP_SUPPORT_DIR/run-cloudflared.sh"
cp "$RUNNER_SRC" "$RUNNER"
chmod +x "$RUNNER"

PROGRAM_ARGS=(
  "/bin/bash"
  "$RUNNER"
)

CLOUDFLARE_TUNNEL_TOKEN="$(read_env_value CLOUDFLARE_TUNNEL_TOKEN)"
APP_BASE_URL_VALUE="$(read_env_value APP_BASE_URL)"
PUBLIC_APP_BASE_URL_VALUE="$(read_env_value PUBLIC_APP_BASE_URL)"

{
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
  printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  printf '%s\n' '<plist version="1.0">'
  printf '%s\n' '<dict>'
  printf '%s\n' '  <key>Label</key>'
  printf '%s\n' '  <string>ai.crossx.tunnel</string>'
  printf '%s\n' ''
  printf '%s\n' '  <key>WorkingDirectory</key>'
  printf '  <string>%s</string>\n' "$(xml_escape "$APP_SUPPORT_DIR")"
  printf '%s\n' ''
  printf '%s\n' '  <key>ProgramArguments</key>'
  printf '%s\n' '  <array>'
  for arg in "${PROGRAM_ARGS[@]}"; do
    program_arg_xml "$arg"
  done
  printf '%s\n' '  </array>'
  printf '%s\n' ''
  printf '%s\n' '  <key>EnvironmentVariables</key>'
  printf '%s\n' '  <dict>'
  printf '%s\n' '    <key>PUBLIC_PORT</key>'
  printf '    <string>%s</string>\n' "$(xml_escape "$PUBLIC_PORT")"
  printf '%s\n' '    <key>PUBLIC_TUNNEL_TARGET_URL</key>'
  printf '    <string>%s</string>\n' "$(xml_escape "$TARGET_URL")"
  printf '%s\n' '    <key>CLOUDFLARED_BIN</key>'
  printf '    <string>%s</string>\n' "$(xml_escape "$CLOUDFLARED_BIN")"
  printf '%s\n' '    <key>CLOUDFLARED_METRICS_PORT</key>'
  printf '%s\n' '    <string>20241</string>'
  printf '%s\n' '    <key>PUBLIC_TUNNEL_DATA_DIR</key>'
  printf '    <string>%s</string>\n' "$(xml_escape "$APP_SUPPORT_DIR")"
  if [[ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]]; then
    printf '%s\n' '    <key>CLOUDFLARE_TUNNEL_TOKEN</key>'
    printf '    <string>%s</string>\n' "$(xml_escape "$CLOUDFLARE_TUNNEL_TOKEN")"
  fi
  if [[ -n "$APP_BASE_URL_VALUE" ]]; then
    printf '%s\n' '    <key>APP_BASE_URL</key>'
    printf '    <string>%s</string>\n' "$(xml_escape "$APP_BASE_URL_VALUE")"
  fi
  if [[ -n "$PUBLIC_APP_BASE_URL_VALUE" ]]; then
    printf '%s\n' '    <key>PUBLIC_APP_BASE_URL</key>'
    printf '    <string>%s</string>\n' "$(xml_escape "$PUBLIC_APP_BASE_URL_VALUE")"
  fi
  printf '%s\n' '  </dict>'
  printf '%s\n' ''
  printf '%s\n' '  <key>RunAtLoad</key>'
  printf '%s\n' '  <true/>'
  printf '%s\n' ''
  printf '%s\n' '  <key>KeepAlive</key>'
  printf '%s\n' '  <true/>'
  printf '%s\n' ''
  printf '%s\n' '  <key>StandardOutPath</key>'
  printf '  <string>%s</string>\n' "$(xml_escape "$APP_SUPPORT_DIR/launchd.out.log")"
  printf '%s\n' '  <key>StandardErrorPath</key>'
  printf '  <string>%s</string>\n' "$(xml_escape "$APP_SUPPORT_DIR/launchd.err.log")"
  printf '%s\n' '</dict>'
  printf '%s\n' '</plist>'
} > "$PLIST_DST"

: > "$APP_SUPPORT_DIR/cloudflared.out.log"
: > "$APP_SUPPORT_DIR/cloudflared.err.log"
: > "$APP_SUPPORT_DIR/launchd.out.log"
: > "$APP_SUPPORT_DIR/launchd.err.log"

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/ai.crossx.tunnel" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/ai.crossx.tunnel" 2>/dev/null || true

printf "Installed and started: %s\n" "$PLIST_DST"
printf "Tunnel target: http://127.0.0.1:%s\n" "$PUBLIC_PORT"
printf "Logs: %s\n" "$APP_SUPPORT_DIR/cloudflared.out.log"
printf "Logs: %s\n" "$APP_SUPPORT_DIR/cloudflared.err.log"
printf "URL file: %s\n" "$APP_SUPPORT_DIR/public-tunnel-url.txt"
printf "Status file: %s\n" "$APP_SUPPORT_DIR/public-tunnel-status.json"
printf "Status: bash scripts/public-status.sh\n"
