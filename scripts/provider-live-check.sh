#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8787}"

echo "[Cross X] Provider Live Readiness Check"
echo "Target: ${BASE_URL}"
echo

missing=0
if [[ -z "${GAODE_KEY:-}" && -z "${AMAP_KEY:-}" ]]; then
  echo "- missing: GAODE_KEY or AMAP_KEY"
  missing=1
else
  echo "- ok: GAODE_KEY/AMAP_KEY present"
fi

if [[ -z "${PARTNER_HUB_KEY:-}" ]]; then
  echo "- missing: PARTNER_HUB_KEY"
  missing=1
else
  echo "- ok: PARTNER_HUB_KEY present"
fi

echo
resp=$(curl -sf "${BASE_URL}/api/system/providers" || true)
if [[ -z "${resp}" ]]; then
  echo "- api: /api/system/providers unavailable"
  exit 2
fi

echo "- api: /api/system/providers"
echo "${resp}"

echo
if [[ ${missing} -eq 0 ]]; then
  echo "Result: ENV looks ready for live provider mode."
else
  echo "Result: ENV not ready. Fill missing keys first."
fi
