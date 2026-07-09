# CLAUDE.md

このファイルは、このリポジトリを Claude Code で保守・拡張する人(将来の自分 or チームメンバー)
向けの内部ドキュメントです。エンドユーザー向けの説明は [README.md](README.md) を参照してください。

## プロジェクトの目的

Claude Code の実コスト($)を、`~/.claude/projects` のトランスクリプトから直接集計して
画面常駐ウィジェットにリアルタイム表示するツール。社内で Fable/Opus の使用量が急増して
クレジットが枯渇する事例が相次いだため作成した。ネットワーク通信は一切行わない。

## アーキテクチャ

```
lib/usage.mjs (ESM, 依存なし)
  ├─ listTranscripts()   ~/.claude/projects 配下の *.jsonl を再帰列挙
  ├─ costOf() / priceOf() モデル別単価テーブルで実コスト($)を計算
  ├─ readSelectedModel()  ~/.claude/settings.json の "model" を読む(/model の即時反映用)
  ├─ readConfig()          ~/.claude/.usage-checker.json の dailyMax(猫の表情しきい値)
  └─ collect()             上記をまとめて { today, currentModel, selectedModel, dailyMax } を返す
        │
        │ dynamic import (CJS main -> ESM lib)
        ▼
overlay/main.js (Electron main process, CJS)
  ├─ createWindow()   透明・フレームレス・alwaysOnTop の BrowserWindow
  ├─ tick()           2.5秒ごとに collect() を呼び、usdJpyRate を足して IPC で renderer に送る
  ├─ fetchFxRate()    1時間ごとに open.er-api.com から USD/JPY レートを取得(唯一の外部通信)
  ├─ createTray()     トレイアイコン(✕ で隠した後の再表示 / 完全終了はここから)
  └─ startSessionWatch()  hooks/on-session.sh が書く PID マーカーを見て、
                           最後の Claude Code セッションが終了したら自動終了
        │ IPC ('usage' / 'uc-quit' / 'uc-move')
        ▼
overlay/preload.js  contextBridge で window.uc.{onUsage,quit,move} だけ公開
        ▼
overlay/renderer/{index.html,app.js}  純粋な DOM 描画。Node API には触れない
```

## 重要な設計判断とその理由

- **唯一の外部通信は円換算用の為替レート取得(main.js の `fetchFxRate()`)** —
  当初「完全ローカル・ネットワーク通信なし」を売りにしていたが、円換算表示を追加した際に
  ユーザーとの合意の上で例外を設けた。守っている制約: (1) main プロセスからのみ通信
  (renderer からは一切叩かない・CSP的な懸念なし)、(2) 送信するのは何もない(単純GET)、
  受信するのはレート数値のみ、(3) 1時間に1回のみ(`FX_POLL_MS`)、(4) 失敗時は前回値を
  保持し、機能停止しない(オフライン環境でも $ 表示は問題なく動く。¥ 表示だけ出なくなる)。
  新しく外部通信を追加する時は、この4条件をREADMEの該当箇所と一緒に必ず更新すること。
- **依存ライブラリなし(lib/usage.mjs)** — 配布物を軽くし、npm パッケージの脆弱性リスクを避けるため。
  fs/os/path の標準モジュールのみで完結させている。
- **`readdirSync(dir, {recursive:true})` を使わない** — このオプションは Node **v20.1+** 限定。
  README は Node 18+ を要求しているため、`listTranscripts()` は手動スタック再帰で実装している。
  (このミスマッチは実際に見つかったバグ — 修正済みだが、将来 Node の新 API を使う時は必ず
  README の要求バージョンと突き合わせること)
- **`focusable: false`** — ウィジェットをクリック/ドラッグしてもターミナルのフォーカスを奪わない。
- **✕ボタンは非表示のみ、完全終了はトレイ経由** — 誤ってウィジェットを閉じても、Claude Code 側の
  設定(フック)を触らずに再表示できるようにするため。`win.on('close', ...)` で `preventDefault()`
  している。本当に終了させたい時は `quitting = true` をセットしてから `app.quit()` を呼ぶ
  (このフラグが無いと `window-all-closed` が発火しない設計になっている)。
- **セッション生存マーカー(`${TMPDIR:-/tmp}/usagechecker-sessions/<pid>`)** — hooks/on-session.sh
  が Claude Code の PID でマーカーファイルを作り、main.js の `startSessionWatch()` が
  `process.kill(pid, 0)` で生死確認する。全滅を **2 回連続**確認したら自動終了(1回だけだと
  ファイル書き込みタイミングのブレで誤検知しやすいため)。
  - **macOS の注意**: `os.tmpdir()`(Node)と `$TMPDIR`(bash)は一致するが、これは launchd が
    ユーザーセッションに同じ環境変数を配るため。ハードコードで `/tmp` を使うと macOS では
    ズレる(`$TMPDIR` は `/var/folders/.../T/` のような per-user パスになる)。
  - Windows(`on-session.ps1`)は親プロセス ID の取得(`Get-CimInstance Win32_Process`)が
    best-effort — 失敗しても起動自体は継続する。README にもその旨を明記している。
- **トレイアイコンは既存の cat PNG から生成** — 一度、手打ちの base64 データが壊れていて
  `nativeImage.isEmpty()` が true になり、メニューバーに何も表示されない不具合を出した
  (コミット `4dec88c` で修正)。**base64 を手で書かない** — 必ず実在するファイルから
  `nativeImage.createFromPath()` するか、`sips`/`convert` 等のツールで生成すること。

## 削除した機能とその理由

- **「session」表示(今日の総額の隣に出していた小さい $)** — 「最後に更新されたトランスクリプト
  ファイル」を「現在のセッション」とみなして今日分だけ合計していたが、この定義は
  複数セッション使用時に「今どのセッションを指しているか」が typing している場所によって
  無言で切り替わるため、実運用で「これは何?」という質問が出た。今日の総額 + モデル別バーで
  必要な情報は揃っているため削除した(`lib/usage.mjs` の `newestFile`/`sessionTotal` 関連コード、
  renderer の `.sess` 要素ごと削除)。同種の「セッション単位」の指標を将来追加する場合は、
  この揺れをどう扱うか(固定した1つのウィジェットが複数の同時セッションを跨いで集計している
  という前提)を先に設計すること。

## フッターのメッセージ表示ロジック(renderer/app.js の render())

優先順位: 高コストモデル使用中(`Sonnetへ切替を`) > 予算超過(`上限を超えています`) >
それ以外は `残り $X.XX`(空欄にしない)。widget の赤枠(`.alert`)は「高コストモデル」
または「予算超過」のどちらかが true なら付く(モデル自体は安いのに使いすぎている、
という状態も警告対象にするため)。

## 既知の制約(仕様として割り切っている部分)

- **サブエージェント(Task/Agent ツール)のコストは集計対象外** — サブエージェントの
  transcript は `~/.claude/projects` 配下ではなく `/private/tmp/claude-.../tasks/` 等の
  一時ディレクトリに保存されるため、`listTranscripts()` のスキャン範囲に入らない。
  公式 `/usage` の Session 内訳がサブエージェント分のコスト(例: Haiku 経由の
  claude-code-guide エージェント呼び出し)を含めて表示するのに対し、本ウィジェットは
  含めない。実測では全体の 1% 未満だったが、サブエージェントを多用するワークフローでは
  無視できない差になる可能性がある。恒久的な対応は保留(一時ディレクトリのパスは
  実行毎に変わり、ツールのポリシー上そこを直接読むことも推奨されていない)。
- **「選択中」バッジはセッション単位ではない** — `~/.claude/settings.json` の `model` フィールドは
  **グローバル単一ファイル**。複数の Claude Code セッションを同時に開いて別々のモデルを
  使っている場合、バッジは「どこかのセッションで最後に `/model` を実行した値」を表示するだけで、
  「今フォーカスしているセッション」とは無関係。実際の課金額(バーグラフ)は各セッションの
  transcript を正しく集計しているので、そちらは常に正確。この制約は実機検証済み
  (3セッション同時起動で確認した)。
- **`/model default` を選ぶと `settings.json` から `model` キー自体が消える** — 非デフォルト
  (sonnet/haiku/fable)を選んだ時だけ値が書かれる。`readSelectedModel()` は「キーなし = default
  = Opus」として扱っている。この挙動が将来の Claude Code のバージョンで変わる可能性はある。
- **単価テーブル(`lib/usage.mjs` の `PRICING`)は手動更新が必要** — Anthropic が価格改定したら
  ここを直接編集する。Sonnet 5 は導入価格($2/$10, 2026-08-31まで)を適用中 — 期限が来たら
  $3/$15 に変更すること。
- **モデル ID の前方一致順序に依存**(`PRICING` 配列の順番)— 例えば `sonnet-5` は `sonnet` より
  先に置く必要がある(そうしないと汎用 `sonnet` 単価にマッチしてしまう)。新モデル追加時は
  配列の先頭付近に具体的なパターンを置くこと。

## 開発時の動かし方

```bash
cd overlay
npm install       # electron 本体をダウンロード(初回のみ)
npm start         # 起動確認
node ../lib/usage.mjs   # 集計ロジックだけ単体で確認(CLI 出力 + JSON)
```

設定ファイルの動作確認:

```bash
echo '{"dailyMax": 5}' > ~/.claude/.usage-checker.json   # 猫の表情しきい値を変えて確認
```

## コミット履歴に残っている過去の失敗(再発防止用)

- `bfd6acc` → `e1c7483` → `4dec88c` の間に見つかった不具合:
  1. Node 18 では動かない `readdirSync recursive` オプションの使用(README との不整合)
  2. ✕ボタンが `app.quit()` を直接呼んでいて、閉じたら二度と再表示できなかった
  3. Claude Code の全セッション終了後もウィジェットが永久に起動し続けた(監視ロジック無し)
  4. トレイアイコンが未定義変数参照+壊れた base64 で表示されなかった
  5. **【重大】コストを実際の約1.9〜2倍に過大集計していた。** 1回の応答が
     thinking/text/tool_use など複数行の transcript エントリに分かれて記録され、
     各行が「同一の usage オブジェクトをそのまま複製した状態」で保存されていたため、
     全行を単純合計すると同じ課金を2〜3回数えてしまっていた(実測: あるセッションで
     usage 付き行が411、ユニークな `message.id` は206 — 平均2.00倍の重複)。
     加えて Sonnet 5 の導入価格($2/$10)をハードコードしていたが、実際の `/usage`
     表示との突き合わせで **Team シートの extra usage 課金では標準価格($3/$15)で
     課金されていた**ことが判明(標準価格で再計算すると実測との差が0.7%まで縮まった)。
     この2つの複合効果で、ユーザーが公式 `/usage` の Session 内訳と本ウィジェットの
     数字を見比べて気づいた(表示 $128 → 修正後 $73)。**検証方法**: 同じ transcript
     ファイルを手動で集計し、`message.id` ごとの出現回数と usage の内容が完全に同一か
     確認した上で、公式 `/usage` の「Session」内訳(モデル別 $)と直接比較した。
     **教訓**: 課金計算のような「静かに間違っていても動いているように見える」ロジックは、
     実装時に一度、公式の `/usage` 表示と突き合わせて検算すること。動くこと ≠ 正しいこと。

いずれも「動いてはいるが検証していない部分」で発生した。新機能を足す時は、実際に
プロセスを起動して目視確認するまでを一区切りとすること(README を書いただけで終わらない)。
