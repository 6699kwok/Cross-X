#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_SRC="$ROOT_DIR/scripts/crossx-agent.plist.template"
PLIST_DST="$HOME/Library/LaunchAgents/ai.crossx.mvp.plist"

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

append_env_entry() {
  local key="$1"
  local value="$2"
  [[ -n "$value" ]] || return 0
  local escaped
  escaped="$(xml_escape "$value")"
  EXTRA_ENV_XML+=$'\n'"    <key>${key}</key>"$'\n'"    <string>${escaped}</string>"
}

EXTRA_ENV_XML=""
for key in OPENAI_API_KEY OPENAI_KEY CHATGPT_API_KEY OPENAI_MODEL OPENAI_CHAT_MODEL OPENAI_BASE_URL OPENAI_TIMEOUT_MS GAODE_KEY AMAP_KEY PARTNER_HUB_KEY PARTNER_HUB_BASE_URL PARTNER_HUB_PROVIDER PARTNER_HUB_CHANNELS PARTNER_HUB_TIMEOUT_MS; do
  value="$(read_env_value "$key")"
  append_env_entry "$key" "$value"
done

awk -v root="$ROOT_DIR" -v extra="$EXTRA_ENV_XML" '
{
  gsub("__WORKDIR__", root)
  if ($0 ~ /__EXTRA_ENV_VARS__/) {
    n = split(extra, arr, "\n")
    for (i = 1; i <= n; i++) {
      if (length(arr[i]) > 0) print arr[i]
    }
    next
  }
  print
}
' "$PLIST_SRC" > "$PLIST_DST"

launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"

printf "Installed and started: %s\n" "$PLIST_DST"
printf "Open: http://127.0.0.1:8787\n"
printf "Logs: %s\n" "$ROOT_DIR/data/launchd.out.log"
printf "Logs: %s\n" "$ROOT_DIR/data/launchd.err.log"
