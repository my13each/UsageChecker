#!/usr/bin/env bash
# UsageChecker installer (macOS / Linux)
#   git clone <repo> && cd UsageChecker && ./install.sh
# 依存関係を入れ、~/.claude/settings.json に SessionStart フックを登録する
# (バックアップを取ってマージ。既存フックは絶対に上書きしない)。
# Windows は README の PowerShell スニペットを手動で追記してください。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$REPO/hooks/on-session.sh"
SETTINGS="$HOME/.claude/settings.json"

command -v node >/dev/null || { echo "❌ Node.js 18+ が必要 → https://nodejs.org"; exit 1; }
command -v npm  >/dev/null || { echo "❌ npm が必要 (Node.js に同梱)"; exit 1; }
command -v python3 >/dev/null || { echo "❌ python3 が必要 (設定マージ用)"; exit 1; }

echo "📦 [1/2] 依存関係のインストール (overlay/npm install)…"
( cd "$REPO/overlay" && npm install --silent )

echo "🔗 [2/2] Claude Code フック登録…"
chmod +x "$HOOK"
mkdir -p "$HOME/.claude"
[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak.usagechecker.$(date +%Y%m%d%H%M%S)"

python3 - "$SETTINGS" "$HOOK" <<'PY'
import json, sys
f, hook = sys.argv[1:3]
try:
    d = json.load(open(f))
    if not isinstance(d, dict): d = {}
except Exception:
    d = {}
h = d.setdefault('hooks', {})
arr = h.setdefault('SessionStart', [])
for g in arr:                                    # 既に登録済みならスキップ(冪等)
    for hk in g.get('hooks', []):
        if hk.get('command') == hook:
            print("   ✓ 既に登録済み (変更なし)"); sys.exit(0)
arr.append({'hooks': [{'type': 'command', 'command': hook, 'async': True}]})
json.dump(d, open(f, 'w'), indent=2, ensure_ascii=False)
print("   ✓ SessionStart フックを登録 (既存フックは保持)")
PY

echo ""
echo "✅ インストール完了!"
echo "   • 次の Claude Code セッションからウィジェットが自動で起動します。"
echo "   • 今すぐ見るには:  cd \"$REPO/overlay\" && npm start"
echo "   • 全セッション終了時にウィジェットも自動終了します。"
echo "   • アンインストール:  ./uninstall.sh"
