// @ts-check
/**
 * usage.mjs — Claude Code のトランスクリプトから実コスト($)を集計する。
 *
 * ~/.claude/projects 配下の *.jsonl を走査し、assistant メッセージの
 * message.model + message.usage からモデル別の実使用額を算出する。
 * OS 非依存(os.homedir() が Win/Mac 双方を解決)。依存なし。
 *
 * CLI:  node lib/usage.mjs        → 人間可読 + JSON を表示(検証用)
 * API:  import { collect } from "./lib/usage.mjs"
 */

import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── モデル単価表(per 1M tokens, 入力/出力)───────────────────────
// id は前方一致で照合。上から順にマッチした最初のものを採用。
// 出典: Anthropic 公式単価。Sonnet 5 は導入価格($2/$10, 2026-08-31まで)。
const PRICING = [
  { re: /fable|mythos/,        label: "Fable",  in: 10, out: 50 },
  { re: /opus/,                label: "Opus",   in: 5,  out: 25 },
  { re: /sonnet-5|sonnet5/,    label: "Sonnet", in: 2,  out: 10 }, // 導入価格
  { re: /sonnet/,              label: "Sonnet", in: 3,  out: 15 },
  { re: /haiku/,               label: "Haiku",  in: 1,  out: 5  },
];
const UNKNOWN = { label: "Other", in: 5, out: 25 };

// キャッシュ倍率(入力単価に対する係数)
const CACHE_READ_MULT = 0.1;   // キャッシュ読取
const CACHE_5M_MULT   = 1.25;  // 5分キャッシュ書込
const CACHE_1H_MULT   = 2.0;   // 1時間キャッシュ書込

/** @param {string} modelId */
export function priceOf(modelId) {
  const id = (modelId || "").toLowerCase();
  return PRICING.find((p) => p.re.test(id)) || UNKNOWN;
}

/**
 * 1メッセージの usage オブジェクトから実コスト($)を算出。
 * @param {any} u  message.usage
 * @param {{in:number,out:number}} p  単価(per 1M)
 */
export function costOf(u, p) {
  if (!u) return 0;
  const M = 1_000_000;
  const input = (u.input_tokens || 0) * p.in;
  const output = (u.output_tokens || 0) * p.out;
  const cacheRead = (u.cache_read_input_tokens || 0) * p.in * CACHE_READ_MULT;
  // 書込は 1h/5m の内訳があれば分けて計算、なければ 5m 扱い
  const cc = u.cache_creation || {};
  let cacheWrite;
  if (cc.ephemeral_1h_input_tokens != null || cc.ephemeral_5m_input_tokens != null) {
    cacheWrite =
      (cc.ephemeral_1h_input_tokens || 0) * p.in * CACHE_1H_MULT +
      (cc.ephemeral_5m_input_tokens || 0) * p.in * CACHE_5M_MULT;
  } else {
    cacheWrite = (u.cache_creation_input_tokens || 0) * p.in * CACHE_5M_MULT;
  }
  return (input + output + cacheRead + cacheWrite) / M;
}

// `/model` の別名 -> 表示ラベル。settings.json の "model" フィールドは即時反映されるため、
// これを見れば「選択中」のモデルが transcript の書込みを待たずにわかる。
const ALIAS = {
  default: "Opus", opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable", mythos: "Fable",
};

// `/model default`(=Opus 4.8)を選ぶと settings.json から "model" キー自体が消える。
// 非デフォルト(sonnet/haiku/fable)を選んだ時だけ値が書かれる。
// よって「キーなし = default = Opus」として扱う。
const DEFAULT_LABEL = "Opus";

// ユーザー毎の設定ファイル。dailyMax($/日 = 100%とみなす基準)をここで上書きできる。
// プレミアムシート(サブスク内)ユーザーと API 従量課金ユーザーで適正額が全く異なるため、
// 単一のハードコード値ではなく各自が編集できるファイルにする。
const CONFIG_PATH = join(homedir(), ".claude", ".usage-checker.json");
const DEFAULT_DAILY_MAX = 30; // $/日。プレミアムシートの extra usage は本来0に近いほど健全なので低め既定値。

/** @returns {{dailyMax:number}} */
export function readConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    const dailyMax = Number(raw.dailyMax);
    return { dailyMax: Number.isFinite(dailyMax) && dailyMax > 0 ? dailyMax : DEFAULT_DAILY_MAX };
  } catch {
    return { dailyMax: DEFAULT_DAILY_MAX };
  }
}

/** ~/.claude/settings.json の "model" から選択中モデルのラベルを取得。 */
export function readSelectedModel() {
  const path = join(homedir(), ".claude", "settings.json");
  try {
    const raw = readFileSync(path, "utf8");
    const alias = JSON.parse(raw).model;
    if (typeof alias !== "string" || alias === "") return DEFAULT_LABEL; // キーなし = default = Opus
    return ALIAS[alias.toLowerCase()] || priceOf(alias).label;
  } catch {
    return DEFAULT_LABEL; // 読めない場合もデフォルト扱い
  }
}

/** ローカル日の 0:00 (今日の開始) の epoch ms */
function todayStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ~/.claude/projects 配下の *.jsonl を再帰列挙 */
function listTranscripts() {
  const base = join(homedir(), ".claude", "projects");
  if (!existsSync(base)) return [];
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(base, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".jsonl")) {
      // Node の recursive dirent は parentPath を持つ
      const dir = e.parentPath || e.path || base;
      out.push(join(dir, e.name));
    }
  }
  return out;
}

/** ファイル末尾 maxBytes だけ読む(巨大セッション対策) */
function readTail(path, maxBytes) {
  let fd;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const n = Math.min(size, maxBytes);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * 全トランスクリプトを走査して今日の実コストを集計。
 * @returns {{
 *   today: { total:number, perModel: {m:string,v:number}[] },
 *   session: { total:number, model:string|null },
 *   currentModel: string|null,
 *   selectedModel: string|null,
 *   dailyMax: number,
 *   at: number
 * }}
 */
export function collect() {
  const start = todayStartMs();
  /** @type {Record<string, number>} */
  const perModel = {}; // label -> $
  let latestTs = 0;
  let currentModel = null;

  // 最新の(=現在の)セッション: 今日 mtime が最も新しい .jsonl
  let newestFile = null, newestMtime = 0;

  for (const file of listTranscripts()) {
    let st;
    try { st = statSync(file); } catch { continue; }
    // 今日更新されていないファイルは今日の行を持たない → スキップ(IO削減)
    if (st.mtimeMs < start) continue;
    if (st.mtimeMs > newestMtime) { newestMtime = st.mtimeMs; newestFile = file; }

    // 今日分だけなら末尾数MBで十分。安全側で最大 8MB。
    const text = st.size <= 8 * 1024 * 1024 ? readTail(file, st.size) : readTail(file, 8 * 1024 * 1024);
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s[0] !== "{") continue;
      let obj;
      try { obj = JSON.parse(s); } catch { continue; }
      const msg = obj.message;
      if (!msg || typeof msg.model !== "string" || !msg.usage) continue;
      // タイムスタンプで今日フィルタ(ファイルは今日更新だが古い行も混在しうる)
      const ts = obj.timestamp ? Date.parse(obj.timestamp) : st.mtimeMs;
      if (Number.isFinite(ts) && ts < start) continue;

      const p = priceOf(msg.model);
      const cost = costOf(msg.usage, p);
      perModel[p.label] = (perModel[p.label] || 0) + cost;

      if (ts >= latestTs) { latestTs = ts; currentModel = p.label; }
    }
  }

  // セッション(最新ファイル)合計: そのファイルの今日分合計
  let sessionTotal = 0, sessionModel = null;
  if (newestFile) {
    const text = readTail(newestFile, 8 * 1024 * 1024);
    let ts2 = 0;
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s[0] !== "{") continue;
      let obj; try { obj = JSON.parse(s); } catch { continue; }
      const msg = obj.message;
      if (!msg || typeof msg.model !== "string" || !msg.usage) continue;
      const ts = obj.timestamp ? Date.parse(obj.timestamp) : 0;
      if (Number.isFinite(ts) && ts < start) continue;
      const p = priceOf(msg.model);
      sessionTotal += costOf(msg.usage, p);
      if (ts >= ts2) { ts2 = ts; sessionModel = p.label; }
    }
  }

  const perModelArr = Object.entries(perModel)
    .map(([m, v]) => ({ m, v }))
    .sort((a, b) => b.v - a.v);
  const total = perModelArr.reduce((s, d) => s + d.v, 0);

  return {
    today: { total, perModel: perModelArr },
    session: { total: sessionTotal, model: sessionModel },
    currentModel,
    selectedModel: readSelectedModel(),
    dailyMax: readConfig().dailyMax,
    at: Date.now(),
  };
}

// ─── CLI(検証用)─────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = collect();
  const fmt = (n) => "$" + n.toFixed(2);
  console.log("── 今日の AI コスト ──");
  console.log("合計:", fmt(r.today.total));
  for (const d of r.today.perModel) {
    const pct = r.today.total ? Math.round((d.v / r.today.total) * 100) : 0;
    console.log(`  ${d.m.padEnd(7)} ${fmt(d.v).padStart(9)}  ${pct}%`);
  }
  console.log("実行中(直近の課金):", r.currentModel ?? "(なし)");
  console.log("選択中(/model):", r.selectedModel ?? "(なし)");
  console.log("日次上限設定:", fmt(r.dailyMax), `(${CONFIG_PATH} で変更可)`);
  console.log("セッション合計:", fmt(r.session.total), `(${r.session.model ?? "-"})`);
  console.log("\n--- JSON ---");
  console.log(JSON.stringify(r, null, 2));
}
