#!/usr/bin/env bash
# Claude Code SessionStart hook -> UsageChecker オーバーレイを起動する。
# すでに起動中なら main.js の requestSingleInstanceLock() が自動でスキップするので、
# 二重起動チェックはここでは不要。silent + non-blocking。

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../overlay" && pwd)"
ELECTRON="$DIR/node_modules/.bin/electron"

# セッション生存マーカー: overlay 側の startSessionWatch() がこれを見て
# 「最後の Claude Code セッションが終了したら自動終了」を判定する。
# main.js の os.tmpdir() と一致させるため TMPDIR を使う(未設定なら /tmp にフォールバック)。
SESS_DIR="${TMPDIR:-/tmp}/usagechecker-sessions"
mkdir -p "$SESS_DIR" 2>/dev/null
# $PPID = このフックを起動した claude プロセス自身の PID
echo "$PPID" > "$SESS_DIR/$PPID" 2>/dev/null

# まだ `npm install` していない場合は起動をスキップ(README参照)
[ -x "$ELECTRON" ] || exit 0

nohup "$ELECTRON" "$DIR" >/tmp/usagechecker-overlay.log 2>&1 &
disown 2>/dev/null

exit 0
