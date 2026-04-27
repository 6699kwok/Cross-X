#!/usr/bin/env bash
set -euo pipefail

PLIST_DST="$HOME/Library/LaunchAgents/ai.crossx.tunnel.plist"
launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || launchctl unload "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "Stopped and removed $PLIST_DST"
