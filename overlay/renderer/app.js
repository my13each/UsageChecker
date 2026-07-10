const COLORS = { Fable:"#4A90E2", Opus:"#3CB371", Sonnet:"#E8A33D", Haiku:"#8BC34A", Other:"#9aa4b0" };
const HOT = new Set(["Fable", "Opus"]);   // 高コストモデル
const fmt = (n) => "$" + (n || 0).toFixed(2);
const yenFmt = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });

/**
 * 今日の支出 $ -> 猫の表情ファイル名。dailyMax($/日 = 100%)は設定ファイル由来
 * (~/.claude/.usage-checker.json の dailyMax)。プレミアムシート/API 従量課金で
 * 適正額が違うため各ユーザーが自分で編集する前提。
 */
function catFace(total, dailyMax) {
  const pct = (total / (dailyMax || 30)) * 100;
  if (pct <= 25) return "cat-happy.png";
  if (pct <= 50) return "cat-content.png";
  if (pct <= 75) return "cat-neutral.png";
  return "cat-grumpy.png";
}

const el = (id) => document.getElementById(id);

// 表示モード。"limit" = 使用上限(dailyMax 対比の1本バー / 既定), "analysis" = 使用量分析(モデル別内訳)。
// トグルで切替。最後に受け取ったデータを保持し、トグル時に IPC を待たず即再描画する。
let mode = "limit";
let lastData = null;

/**
 * 使用上限バー: 「今日の総額 / dailyMax」を1本のバーで描く。/usage の "X% used" 感覚のローカル等価物。
 * 100% 超は 100% 幅で頭打ち + 赤。しきい値: 〜75% 緑, 〜100% 橙, 超過 赤。
 */
function limitBars(total, dailyMax) {
  const max = dailyMax || 30;
  const pct = max > 0 ? (total / max) * 100 : 0;
  const col = pct > 100 ? "var(--warn)" : pct > 75 ? COLORS.Sonnet : COLORS.Opus;
  return `
    <div class="bar-row">
      <div class="bl"><span>使用上限 ${fmt(max)}</span><span class="amt">${Math.round(pct)}% 使用</span></div>
      <div class="track"><div class="fill" style="width:${Math.max(4, Math.min(100, pct))}%;background:${col}"></div></div>
    </div>`;
}

/** 使用量分析バー: 今日の総額に対するモデル別の割合。右の % 表記とバー長を必ず同基準で揃える。 */
function analysisBars(per, total) {
  return per.map((d) => `
    <div class="bar-row">
      <div class="bl"><span>${d.m}</span><span class="amt">${fmt(d.v)} · ${Math.round(d.v / total * 100)}%</span></div>
      <div class="track"><div class="fill" style="width:${Math.max(4, d.v / total * 100)}%;background:${COLORS[d.m] || COLORS.Other}"></div></div>
    </div>`).join("");
}

function render(data) {
  lastData = data;
  const per = (data.today && data.today.perModel) || [];
  const total = (data.today && data.today.total) || 0;
  el("total").textContent = fmt(total);
  // header に既に "today" があるため、ここは重複させず円換算(小さい字)に置き換える。
  // レート未取得(起動直後 or 通信失敗継続中)の間は何も表示しない。
  el("jpy").textContent = typeof data.usdJpyRate === "number"
    ? `約¥${yenFmt.format(total * data.usdJpyRate)} 使用中`
    : "";
  el("cat").src = "assets/" + catFace(total, data.dailyMax);

  // バー描画(モードで切替)
  const bars = el("bars");
  if (mode === "limit") {
    bars.innerHTML = limitBars(total, data.dailyMax);
  } else if (!per.length) {
    bars.innerHTML = '<div class="empty">今日の使用なし</div>';
  } else {
    bars.innerHTML = analysisBars(per, total);
  }

  // 選択中モデル(/model の即時反映) + 警告
  const sel = data.selectedModel || "-";
  const hot = HOT.has(sel);
  const dailyMax = data.dailyMax || 30;
  const overBudget = total > dailyMax;
  const pill = el("sel");
  pill.textContent = sel;
  pill.className = "pill" + (hot ? " hot" : "");

  // 高コストモデル使用中の切替提案 > 上限超過の警告 > 残り予算(安全な状態でも空欄にしない)
  const msg = el("msg");
  if (hot) {
    msg.textContent = "Sonnetへ切替を";
  } else if (overBudget) {
    msg.textContent = "上限を超えています";
  } else {
    msg.textContent = `残り ${fmt(dailyMax - total)}`;
  }
  msg.className = "msg" + ((hot || overBudget) ? " hot" : "");
  el("widget").className = "widget" + ((hot || overBudget) ? " alert" : "");
}

window.uc.onUsage(render);

// 表示モード切替のセグメントボタン2個(使用上限 / 使用量分析)。
// アクティブなほうに .on(青)を付ける。既定は使用上限。
const segLimit = el("m-limit");
const segAnalysis = el("m-analysis");
function setMode(next) {
  mode = next;
  segLimit.classList.toggle("on", mode === "limit");
  segAnalysis.classList.toggle("on", mode === "analysis");
  if (lastData) render(lastData);
}
segLimit.addEventListener("click", () => setMode("limit"));
segAnalysis.addEventListener("click", () => setMode("analysis"));

// 閉じる
el("close").addEventListener("click", () => window.uc.quit());

// フォールバック用ドラッグ(app-region が効かない環境向け)
let dragging = false, lx = 0, ly = 0;
const head = document.querySelector(".head");
head.addEventListener("mousedown", (e) => {
  if (e.target.id === "close") return;
  dragging = true; lx = e.screenX; ly = e.screenY;
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  window.uc.move(e.screenX - lx, e.screenY - ly);
  lx = e.screenX; ly = e.screenY;
});
window.addEventListener("mouseup", () => { dragging = false; });
