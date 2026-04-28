#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8787}"

echo "[Cross X] Provider Live Readiness Check"
echo "Target: ${BASE_URL}"
echo

missing=0
has_builtin_rail_live=0
if [[ -z "${GAODE_KEY:-}" && -z "${AMAP_KEY:-}" && -z "${AMAP_API_KEY:-}" ]]; then
  echo "- missing: GAODE_KEY or AMAP_KEY or AMAP_API_KEY"
  missing=1
else
  echo "- ok: GAODE_KEY/AMAP_KEY/AMAP_API_KEY present"
fi

if [[ -z "${PARTNER_HUB_KEY:-}" && -z "${RAIL_KEY:-}" ]]; then
  echo "- missing: PARTNER_HUB_KEY or RAIL_KEY (builtin 12306 rail may still satisfy live rail)"
else
  echo "- ok: PARTNER_HUB_KEY/RAIL_KEY present"
fi

if [[ -z "${JUTUI_TOKEN:-}" ]]; then
  echo "- missing: JUTUI_TOKEN"
  missing=1
else
  echo "- ok: JUTUI_TOKEN present"
fi

echo
resp=""
last_err=""
for _attempt in 1 2 3; do
  curl_output=$(curl -sS -f "${BASE_URL}/api/system/providers" 2>&1) && curl_status=0 || curl_status=$?
  if [[ ${curl_status} -eq 0 && -n "${curl_output}" ]]; then
    resp="${curl_output}"
    break
  fi
  last_err="${curl_output}"
  sleep 1
done
if [[ -z "${resp}" ]]; then
  if printf '%s' "${last_err}" | grep -qi 'operation not permitted\|immediate connect fail\|sandbox'; then
    echo "- api: /api/system/providers blocked by local sandbox policy"
    exit 3
  fi
  echo "- api: /api/system/providers unavailable"
  if [[ -n "${last_err}" ]]; then
    echo "- curl-error: ${last_err}"
  fi
  exit 2
fi

echo "- api: /api/system/providers"
echo "${resp}"

rail_mode=$(printf '%s' "${resp}" | node -e 'let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(raw);process.stdout.write(String(json.rail&&json.rail.mode||"unknown"));}catch{process.stdout.write("unknown");}})')
rail_runtime=$(printf '%s' "${resp}" | node -e 'let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(raw);process.stdout.write(String(Boolean(json.rail&&json.rail.runtimeCanServeLiveRail)));}catch{process.stdout.write("false");}})')
rail_source=$(printf '%s' "${resp}" | node -e 'let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(raw);process.stdout.write(String(json.rail&&json.rail.inventorySource||"unknown"));}catch{process.stdout.write("unknown");}})')
rail_provider=$(printf '%s' "${resp}" | node -e 'let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{try{const json=JSON.parse(raw);process.stdout.write(String(json.rail&&json.rail.providerAlias||"unknown"));}catch{process.stdout.write("unknown");}})')
if [[ "${rail_provider}" == "builtin_12306" && "${rail_runtime}" == "true" ]]; then
  has_builtin_rail_live=1
fi
echo "- rail: mode=${rail_mode} runtimeCanServeLiveRail=${rail_runtime} source=${rail_source} provider=${rail_provider}"

echo
if [[ ${missing} -eq 0 || ${has_builtin_rail_live} -eq 1 ]]; then
  echo "Result: ENV looks ready for live provider mode."
else
  echo "Result: ENV not ready. Fill missing keys first."
fi
