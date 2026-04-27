#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PUBLIC_TUNNEL_DATA_DIR:-$ROOT_DIR/data}"
PUBLIC_PORT="${PUBLIC_PORT:-8792}"
TARGET_URL="${PUBLIC_TUNNEL_TARGET_URL:-http://127.0.0.1:${PUBLIC_PORT}}"
METRICS_PORT="${CLOUDFLARED_METRICS_PORT:-20241}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
OUT_LOG="${CLOUDFLARED_OUT_LOG:-$DATA_DIR/cloudflared.out.log}"
ERR_LOG="${CLOUDFLARED_ERR_LOG:-$DATA_DIR/cloudflared.err.log}"
URL_FILE="${PUBLIC_TUNNEL_URL_FILE:-$DATA_DIR/public-tunnel-url.txt}"
STATUS_FILE="${PUBLIC_TUNNEL_STATUS_FILE:-$DATA_DIR/public-tunnel-status.json}"
PID_FILE="${PUBLIC_TUNNEL_PID_FILE:-$DATA_DIR/public-tunnel.pid}"

mkdir -p "$DATA_DIR"
: >> "$OUT_LOG"
: >> "$ERR_LOG"

if [[ -z "$CLOUDFLARED_BIN" ]]; then
  echo "[cloudflared] binary not found in PATH and CLOUDFLARED_BIN is empty" | tee -a "$ERR_LOG" >&2
  exit 127
fi

if ! curl -fsS --max-time 5 "${TARGET_URL%/}/healthz" >/dev/null; then
  echo "[cloudflared] target is not healthy: ${TARGET_URL}" | tee -a "$ERR_LOG" >&2
  exit 1
fi

TUNNEL_MODE="quick"
CURRENT_PUBLIC_URL=""
CF_PID=0

write_status() {
  local state="$1"
  local public_url="$2"
  cat > "$STATUS_FILE" <<JSON
{
  "state": "$state",
  "mode": "$TUNNEL_MODE",
  "publicUrl": "$public_url",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
}

cleanup() {
  local exit_code=$?
  if [[ "${CF_PID}" -gt 0 ]] && kill -0 "${CF_PID}" 2>/dev/null; then
    kill "${CF_PID}" 2>/dev/null || true
    wait "${CF_PID}" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  write_status "stopped" "$CURRENT_PUBLIC_URL"
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  TUNNEL_MODE="named"
  CURRENT_PUBLIC_URL="${PUBLIC_APP_BASE_URL:-${APP_BASE_URL:-${CLOUDFLARE_TUNNEL_HOSTNAME:-}}}"
  echo "[cloudflared] starting named tunnel" >> "$OUT_LOG"
  "$CLOUDFLARED_BIN" tunnel --no-autoupdate --metrics "127.0.0.1:${METRICS_PORT}" run --token "$CLOUDFLARE_TUNNEL_TOKEN" >>"$OUT_LOG" 2>>"$ERR_LOG" &
else
  echo "[cloudflared] named tunnel credentials unavailable; starting quick tunnel" >> "$OUT_LOG"
  "$CLOUDFLARED_BIN" tunnel --no-autoupdate --metrics "127.0.0.1:${METRICS_PORT}" --url "$TARGET_URL" >>"$OUT_LOG" 2>>"$ERR_LOG" &
fi

CF_PID=$!
printf '%s\n' "$CF_PID" > "$PID_FILE"
write_status "starting" "$CURRENT_PUBLIC_URL"

while kill -0 "${CF_PID}" 2>/dev/null; do
  if [[ "$TUNNEL_MODE" == "quick" ]]; then
    latest_url="$(grep -hEo 'https://[-a-z0-9]+\.trycloudflare\.com' "$ERR_LOG" "$OUT_LOG" 2>/dev/null | tail -n 1 || true)"
    if [[ -n "$latest_url" && "$latest_url" != "$CURRENT_PUBLIC_URL" ]]; then
      CURRENT_PUBLIC_URL="$latest_url"
      printf '%s\n' "$CURRENT_PUBLIC_URL" > "$URL_FILE"
    fi
  elif [[ -n "$CURRENT_PUBLIC_URL" ]]; then
    printf '%s\n' "$CURRENT_PUBLIC_URL" > "$URL_FILE"
  fi
  write_status "running" "$CURRENT_PUBLIC_URL"
  sleep 2
done

wait "${CF_PID}"
