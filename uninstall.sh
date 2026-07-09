#!/usr/bin/env bash
# UsageChecker uninstaller — ~/.claude/settings.json から SessionStart フックを外し、
# 起動中のウィジェットを終了する。フォルダ自体と node_modules は消さない
# (このスクリプトが入っているフォルダごと手動で削除してください)。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$REPO/hooks/on-session.sh"
SETTINGS="$HOME/.claude/settings.json"

echo "🛑 起動中のウィジェットを終了…"
pkill -f "UsageChecker/overlay" 2>/dev/null || true

if [[ -f "$SETTINGS" ]]; then
  cp "$SETTINGS" "$SETTINGS.bak.usagechecker.$(date +%Y%m%d%H%M%S)"
  python3 - "$SETTINGS" "$HOOK" <<'PY'
import json, sys
f, hook = sys.argv[1:3]
try:
    d = json.load(open(f))
except Exception:
    sys.exit(0)
h = d.get('hooks', {})
arr = h.get('SessionStart', [])
new = []
for g in arr:
    g['hooks'] = [hk for hk in g.get('hooks', []) if hk.get('command') != hook]
    if g['hooks']:
        new.append(g)
h['SessionStart'] = new
json.dump(d, open(f, 'w'), indent=2, ensure_ascii=False)
print("   ✓ SessionStart フックを削除 (他のフックは保持)")
PY
fi

# 設定ファイル(任意)を消したい場合は下のコメントを外す
# rm -f "$HOME/.claude/.usage-checker.json"

echo "✅ アンインストール完了。フォルダを消すには:  rm -rf \"$REPO\""
