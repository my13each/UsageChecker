# UsageChecker

Claude Code の実コスト($)をリアルタイムで表示する、画面常駐型の軽量ウィジェットです。
Windows / macOS / Linux で動作します(Electron)。

![status](https://img.shields.io/badge/platform-mac%20%7C%20win%20%7C%20linux-blue)
![license](https://img.shields.io/badge/license-MIT-green)

## これは何?

`~/.claude/projects` 配下のトランスクリプト(会話ログ)をローカルで読み取り、
モデル別の実使用トークンを Anthropic の公式単価で掛け算して、**今日の実コスト**を
バー グラフで常時表示します。ネットワーク通信は一切行いません(完全ローカル)。

- 今日の合計 $ とセッション $ をリアルタイム表示
- モデル別(Fable / Opus / Sonnet / Haiku)の使用額をバーで可視化
- `/model` で選択中のモデルを**即時**表示(応答完了を待たない)
- 高コストモデル(Fable / Opus)使用中は枠が赤くなり注意を促す
- 今日の支出額に応じて猫アイコンの表情が変化(😻→😊→😐→😾)
- 画面の好きな位置にドラッグして固定可能

<img src="overlay/renderer/assets/cat-content.png" width="64" alt="cat">

> 社内で Claude Fable / Opus の使用量が急増してクレジットが枯渇する、という
> チャット報告をよく見かけたことがきっかけで作りました。ダッシュボードや `/usage`
> は誰も見ていない一方、**画面に常に出ているウィジェット**なら気づきやすいはず、という発想です。

## 注意 — 2 つの「使用量」の違い

Claude Code には全く別の 2 種類の「使用量」があります。混同しやすいので先に整理します。

| | Claude Code サブスク(`/usage` の %) | このツールが表示する額($) |
|---|---|---|
| 対象 | Pro/Max/Team シートの 5 時間・週ごとの**利用率**上限 | **実際に課金されるドル額**(モデル別トークン単価) |
| 100% の意味 | レート制限。到達するとリセットまで**ブロック**(追加課金なし) | 100% という概念はなく、**使った分だけ純粋にコストが積み上がる** |
| プレミアムシート利用者 | 基本使用量はここに含まれる | シートの上限を超えた **extra usage**(従量課金)がここに出る。理想は $0 に近いほど健全 |
| API 課金(pay-as-you-go)利用者 | 関係なし | 使用量そのものがこの $ になる |

つまり `/usage` の % が低くても、Fable や Opus を多用していれば実コストは高い場合があります。
このツールは常に**後者(実際のドル)**を見ています。

## インストール

### 必要環境

- [Node.js](https://nodejs.org/) 18 以上(`npm` が使えること)
- Claude Code

### 手順

```bash
git clone https://github.com/my13each/UsageChecker.git
cd UsageChecker/overlay
npm install
```

`npm install` で Electron 本体(数十〜100MB程度)がダウンロードされます。初回のみ時間がかかります。

### 動作確認(手動起動)

```bash
npm start
```

画面右下にウィジェットが表示されれば OK です。閉じるには右上の `✕`。

### Claude Code 起動時に自動で立ち上がるようにする

`claude` を起動するたびに自動でウィジェットが立ち上がるようにするには、
`~/.claude/settings.json` の `hooks.SessionStart` に以下を**追記**してください
(既存の他フックを消さないよう、配列に要素を追加する形にしてください)。

**macOS / Linux:**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "/絶対パス/UsageChecker/hooks/on-session.sh", "async": true }
        ]
      }
    ]
  }
}
```

**Windows(PowerShell):**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "powershell -File C:\\絶対パス\\UsageChecker\\hooks\\on-session.ps1", "async": true }
        ]
      }
    ]
  }
}
```

参考テンプレートは [`hooks/settings-snippet.json`](hooks/settings-snippet.json) にあります。
すでにウィジェットが起動している状態でもう一度 `claude` を起動しても、二重には立ち上がりません
(自動的にスキップされます)。

## 使い方

- ウィジェットは画面右下にデフォルトで表示されます。上部をドラッグして好きな位置に移動できます
  (位置は自動保存され、次回起動時も同じ場所に出ます)
- 表示は 2.5 秒ごとに自動更新されます
- 右上の `✕` は**非表示**にするだけで、アプリ自体は終了しません
- 閉じた後にもう一度表示するには、タスクトレイ(macOS はメニューバー右側)の
  UsageChecker アイコンをクリックしてください。「表示」で再表示、「終了」で完全終了します
- **SessionStart フックを設定している場合**、開いている Claude Code セッションが
  すべて終了すると自動的にウィジェットも終了します(判定まで数十秒かかることがあります)。
  フックを設定していない場合(`npm start` で手動起動した場合など)は自動終了しません —
  手動でトレイの「終了」を選んでください。この自動終了はセッションの PID 生存確認による
  ものなので、Windows では環境によって動作しない場合があります(mac/Linux では動作確認済み)
- **選択中**バッジは `/model` の切替を即時反映します(注: 複数の Claude Code セッションを
  同時に開いている場合、これは「最後にどこかのセッションで `/model` を実行した値」であり、
  「今フォーカスしているセッション」とは必ずしも一致しません。実際の課金額 — 上部のバー
  グラフ — は各セッションの実データを正しく集計しているので、そちらは常に正確です)

## 猫アイコンのしきい値をカスタマイズする

デフォルトでは「1日 $30 使うと 100%」として猫の表情が変わります(😻 ≤25% → 😊 ≤50% →
😐 ≤75% → 😾 それ以上)。この基準はプレミアムシート利用者と API 従量課金利用者で
適正額が全く異なるため、以下のファイルを作って自分に合った額に変更してください:

```bash
# ~/.claude/.usage-checker.json
{
  "dailyMax": 15
}
```

ファイルがない場合は $30 が既定値として使われます。ウィジェットは次回の自動更新
(最大 2.5 秒後)で新しい設定を反映します。

**目安:**
- プレミアムシート(Team/Enterprise)利用者: ここに出る額は本来シート料金に含まれない
  「extra usage」の従量課金分です。理想は $0 に近いほど健全。組織の許容予算が
  分かっている場合はその額を設定してください
- API 従量課金(pay-as-you-go)利用者: 自分の予算に応じて設定してください

## モデル単価について

以下の Anthropic 公式単価(1M トークンあたり、入力/出力)で計算しています。
Sonnet 5 は 2026-08-31 までの導入価格を適用しています。

| モデル | 入力 | 出力 |
|---|---|---|
| Fable 5 | $10 | $50 |
| Opus 4.8 | $5 | $25 |
| Sonnet 5(導入価格) | $2 | $10 |
| Haiku 4.5 | $1 | $5 |

キャッシュ読み取り/書き込みの倍率も考慮しています。単価は変更される可能性があるため、
実際の請求額とは若干のズレが生じる場合があります(**参考値**としてご利用ください)。

## プライバシー

- 完全にローカルで動作します。外部への通信は一切ありません
- 読み取るのは `~/.claude/projects` 配下のトランスクリプト(トークン数・モデル名・
  タイムスタンプ)のみで、会話内容そのものを外部に送信・保存することはありません
- ウィジェットの位置設定は Electron の `userData` フォルダにローカル保存されます

## アンインストール

```bash
# ウィジェットを終了
# (トレイ/✕ ボタンで終了、または)
pkill -f "UsageChecker/overlay"

# フックを設定した場合は ~/.claude/settings.json から該当エントリを削除

# フォルダを削除
rm -rf /path/to/UsageChecker
rm -f ~/.claude/.usage-checker.json
```

## 技術構成

- [Electron](https://www.electronjs.org/)(transparent / frameless / always-on-top window)
- 依存ライブラリなしの Node.js 標準モジュールのみでトランスクリプト集計(`lib/usage.mjs`)
- OS 固有 API は不使用(mac 専用の `osascript`/`say` 等は使っていません)なため
  Windows / Linux でも同じコードで動作します

## ライセンス

MIT — [LICENSE](LICENSE) 参照
