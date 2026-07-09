#!/usr/bin/env bash
# Claude Code SessionStart hook -> UsageChecker オーバーレイを起動する。
# すでに起動中なら main.js の requestSingleInstanceLock() が自動でスキップするので、
# 二重起動チェックはここでは不要。silent + non-blocking。

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../overlay" && pwd)"
ELECTRON="$DIR/node_modules/.bin/electron"

# まだ `npm install` していない場合は何もしない(README参照)
[ -x "$ELECTRON" ] || exit 0

nohup "$ELECTRON" "$DIR" >/tmp/usagechecker-overlay.log 2>&1 &
disown 2>/dev/null

exit 0
