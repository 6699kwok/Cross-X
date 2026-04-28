#!/usr/bin/env bash
# CrossX dev server — starts in a tmux session named "crossx"
set -e

SESSION="crossx"
DIR="$(cd "$(dirname "$0")" && pwd)"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already running. Attaching..."
  tmux attach-session -t "$SESSION"
else
  tmux new-session -d -s "$SESSION" -c "$DIR"
  tmux send-keys -t "$SESSION" "node server.js" Enter
  echo "Started CrossX in tmux session '$SESSION' on port 8787."
  echo "  Attach : tmux attach -t $SESSION"
  echo "  Detach : Ctrl-b d"
  tmux attach-session -t "$SESSION"
fi
