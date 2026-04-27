#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SUPPORT_DIR="${PUBLIC_TUNNEL_APP_SUPPORT_DIR:-$HOME/Library/Application Support/CrossXTunnel}"
PUBLIC_LAUNCHD_PLIST="${PUBLIC_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/ai.crossx.public.plist}"

read_plist_port() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local want=0 line extracted
  while IFS= read -r line; do
    if [[ $want -eq 1 ]]; then
      extracted="$(printf '%s
' "$line" | sed -n -E 's#.*<string>([^<]+)</string>.*#\1#p' | head -n 1)"
      if [[ -n "$extracted" ]]; then
        printf '%s' "$extracted"
      fi
      return 0
    fi
    if [[ "$line" == *"<key>PORT</key>"* ]]; then
      want=1
    fi
  done < "$file"
}

DETECTED_PUBLIC_PORT="$(read_plist_port "$PUBLIC_LAUNCHD_PLIST")"
PUBLIC_PORT="${PUBLIC_PORT:-${DETECTED_PUBLIC_PORT:-8792}}"
HEALTH_URL="http://127.0.0.1:${PUBLIC_PORT}/healthz"
OUT_LOG="$ROOT_DIR/data/cloudflared.out.log"
ERR_LOG="$ROOT_DIR/data/cloudflared.err.log"
URL_FILE="$ROOT_DIR/data/public-tunnel-url.txt"
STATUS_FILE="$ROOT_DIR/data/public-tunnel-status.json"
if [[ -f "$APP_SUPPORT_DIR/public-tunnel-status.json" ]]; then
  OUT_LOG="$APP_SUPPORT_DIR/cloudflared.out.log"
  ERR_LOG="$APP_SUPPORT_DIR/cloudflared.err.log"
  URL_FILE="$APP_SUPPORT_DIR/public-tunnel-url.txt"
  STATUS_FILE="$APP_SUPPORT_DIR/public-tunnel-status.json"
fi

read_status_field() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 0
  sed -n -E "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\\1/p" "$file" | head -n 1
}

sanitize_status_line() {
  printf "%s" "$1" | sed -E \
    -e 's#https://[-a-z0-9]+\.trycloudflare\.com#[quick-tunnel-url]#g' \
    -e 's#http://127\.0\.0\.1:[0-9]+#[local-target]#g' \
    -e 's#((--token[= ]|token=|Authorization: Bearer )[A-Za-z0-9._:-]+)#token=[REDACTED]#g'
}

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

echo "[CrossX public status]"
echo "Local target: ${HEALTH_URL}"

local_health_ok=0
local_health_blocked=0
health_json=""
health_err=""
health_output="$(curl -sS --max-time 5 "$HEALTH_URL" 2>&1)" && health_status=0 || health_status=$?
if [[ ${health_status} -eq 0 && -n "$health_output" ]]; then
  health_json="$health_output"
  local_health_ok=1
  echo "Health: ${health_json}"
else
  health_err="$health_output"
  if printf '%s' "$health_err" | grep -qi 'operation not permitted\|immediate connect fail\|sandbox'; then
    local_health_blocked=1
    echo "Health: blocked by local sandbox policy"
  else
    echo "Health: unavailable"
  fi
fi

configured_base="$(read_env_value PUBLIC_APP_BASE_URL)"
if [[ -z "$configured_base" ]]; then
  configured_base="$(read_env_value APP_BASE_URL)"
fi
if [[ -n "$configured_base" ]]; then
  echo "Configured public base URL: ${configured_base}"
fi

if [[ -f "$STATUS_FILE" ]]; then
  echo "Tunnel status file: ${STATUS_FILE}"
  state="$(read_status_field state "$STATUS_FILE")"
  mode="$(read_status_field mode "$STATUS_FILE")"
  public_url="$(read_status_field publicUrl "$STATUS_FILE")"
  updated_at="$(read_status_field updatedAt "$STATUS_FILE")"
  [[ -n "$state" ]] && echo "State: ${state}"
  [[ -n "$mode" ]] && echo "Mode: ${mode}"
  [[ -n "$public_url" ]] && echo "Public URL (status): ${public_url}"
  [[ -n "$updated_at" ]] && echo "Updated At: ${updated_at}"
fi

if [[ -f "$URL_FILE" ]]; then
  current_url="$(tr -d '\r' < "$URL_FILE" | tail -n 1)"
  if [[ -n "$current_url" ]]; then
    echo "Current public URL: ${current_url}"
  fi
fi

quick_url=""
for log_file in "$OUT_LOG" "$ERR_LOG"; do
  [[ -f "$log_file" ]] || continue
  quick_url="$(grep -hEo 'https://[-a-z0-9]+\.trycloudflare\.com' "$log_file" | tail -n 1 || true)"
  [[ -n "$quick_url" ]] && break
done
if [[ -n "$quick_url" ]]; then
  echo "Quick tunnel URL: ${quick_url}"
fi

if [[ -f "$ERR_LOG" ]]; then
  last_err="$(tail -n 5 "$ERR_LOG" | sed '/^[[:space:]]*$/d' || true)"
  if [[ -n "$last_err" ]]; then
    echo "Recent tunnel stderr:"
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      echo "$(sanitize_status_line "$line")"
    done <<< "$last_err"
  fi
fi

echo
if [[ ${local_health_ok} -eq 1 ]]; then
  echo "Summary: public local target is healthy."
elif [[ ${local_health_blocked} -eq 1 ]]; then
  echo "Summary: local health verification is blocked by the current sandbox policy. Re-run this script in a normal terminal to verify the public target directly."
elif [[ -f "$STATUS_FILE" ]]; then
  echo "Summary: tunnel metadata exists, but the local public target is not healthy. Public/demo traffic should be treated as degraded until the public app on port ${PUBLIC_PORT} is restored."
else
  echo "Summary: no healthy local public target and no active tunnel metadata found."
fi
