// UsageChecker overlay — cross-platform (Win/Mac/Linux) Electron widget.
// 画面隅に常駐し、~/.claude のトランスクリプトから実コスト($)を毎数秒集計して表示。
// mac 専用 API(osascript/say)は不使用。ドッキングなし・固定コーナー(ドラッグ移動可)。
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const POLL_MS = 2500;
const FX_POLL_MS = 60 * 60 * 1000; // 1時間毎(レートは頻繁に叩く必要が無いため)
const FX_URL = 'https://open.er-api.com/v6/latest/USD'; // 無料・無認証の USD 基準レートAPI
const W = 300, H = 250;
let win = null;
let tray = null;
let collectFn = null;
let quitting = false; // トレイの「終了」経由の本当の終了フラグ(✕ボタンは非表示のみ)
let usdJpyRate = null; // 直近取得できた USD/JPY レート。取得できるまでは null(renderer 側で非表示)

// 円換算表示のためだけに使う外部通信。README にも明記している通り、これが唯一の
// ネットワークアクセス。失敗時は前回値を保持し続ける(オフラインでも壊れない)。
async function fetchFxRate() {
  try {
    const res = await fetch(FX_URL, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    if (j && j.rates && typeof j.rates.JPY === 'number') usdJpyRate = j.rates.JPY;
  } catch {
    // 失敗時は前回値を維持。初回失敗時は null のまま(renderer が非表示にする)。
  }
}

// Claude Code 側の SessionStart フックが書き込むセッション生存マーカー。
// マーカーが 1 つも無くなったら(= 最後の Claude Code セッションが終了したら)自動終了する。
// PID の生死で判定するため、正常終了・強制終了(クラッシュ)どちらも拾える。
const SESS_DIR = path.join(os.tmpdir(), 'usagechecker-sessions');

function layoutFile() { return path.join(app.getPath('userData'), 'usage-layout.json'); }
function loadPos() {
  try { return JSON.parse(fs.readFileSync(layoutFile(), 'utf8')); } catch { return null; }
}
function savePos() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try { fs.writeFileSync(layoutFile(), JSON.stringify({ x, y })); } catch {}
}

async function loadCollector() {
  // lib/usage.mjs は ESM。CJS main から動的 import で取り込む。
  const libUrl = pathToFileURL(path.join(__dirname, '..', 'lib', 'usage.mjs')).href;
  const mod = await import(libUrl);
  collectFn = mod.collect;
}

async function tick() {
  if (!win || win.isDestroyed() || !collectFn) return;
  let data;
  try { data = collectFn(); } catch (e) { return; }
  win.webContents.send('usage', { ...data, usdJpyRate });
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const saved = loadPos();
  const x = saved ? saved.x : workArea.x + workArea.width - W - 24;
  const y = saved ? saved.y : workArea.y + workArea.height - H - 24;

  win = new BrowserWindow({
    width: W, height: H, x, y,
    transparent: true, frame: false, hasShadow: false,
    resizable: false, skipTaskbar: true, alwaysOnTop: true,
    show: false, focusable: false, // クリックやドラッグでターミナルのフォーカスを奪わない
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  if (win.setVisibleOnAllWorkspaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('moved', savePos);

  // ✕ボタンは「隠す」だけ。本当の終了はトレイの「終了」かセッション監視に任せる。
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    savePos();
    win.hide();
  });

  ipcMain.on('uc-quit', () => { if (win && !win.isDestroyed()) win.close(); });
  ipcMain.on('uc-move', (_e, d) => {
    if (!win || win.isDestroyed()) return;
    const [cx, cy] = win.getPosition();
    win.setPosition(cx + Math.round(d.dx || 0), cy + Math.round(d.dy || 0));
  });
}

function showWidget() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  win.showInactive();
}

function createTray() {
  // トレイアイコンは既存の猫アセットを縮小して使う(自前base64は壊れると
  // isEmpty()==true になり、メニューバーに何も表示されない不具合になるため
  // 実在するPNGファイルから作る方が安全)。
  let icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'cat-content.png'));
  if (!icon.isEmpty()) icon = icon.resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('UsageChecker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '表示', click: showWidget },
    { label: '終了', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWidget);
}

// last-Claude-Code-session watch: マーカーが無い状態が続いたら自動終了。
// hooks/on-session.sh がセッション開始毎に SESS_DIR/<pid> を作る前提。
// マーカーが存在しない(フック未設定・古いバージョン等)場合は監視自体をスキップし、
// ウィジェットは手動終了(トレイの「終了」)まで動き続ける。
function startSessionWatch() {
  const launchAt = Date.now();
  let goneCount = 0;
  setInterval(() => {
    if (Date.now() - launchAt < 8000) return; // 起動直後はマーカーがまだ無いことがある
    let alive = 0;
    try {
      for (const f of fs.readdirSync(SESS_DIR)) {
        const pid = parseInt(f, 10);
        if (!pid) continue;
        try { process.kill(pid, 0); alive++; }
        catch (e) {
          if (e.code === 'ESRCH') { try { fs.unlinkSync(path.join(SESS_DIR, f)); } catch {} }
          else alive++; // EPERM 等は生存扱い
        }
      }
    } catch {
      return; // ディレクトリ無し = フック未設定、または最初のセッション開始前 -> 監視しない
    }
    // ディレクトリが存在して空(=マーカー全滅)なら alive は 0 のまま、ここで正しく増分される
    if (alive === 0) { if (++goneCount >= 2) { quitting = true; app.quit(); } }
    else goneCount = 0;
  }, 5000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.setActivationPolicy) app.setActivationPolicy('accessory');
    await loadCollector();
    createWindow();
    createTray();
    fetchFxRate().then(tick); // レート取得を待って一度反映(初回だけ ¥ 表示が少し遅れる)
    tick();
    setInterval(tick, POLL_MS);
    setInterval(fetchFxRate, FX_POLL_MS);
    startSessionWatch();
  });
}
// ✕ボタンは hide のみ(close ハンドラで preventDefault)なので、ここは
// トレイの「終了」/ セッション監視 が quitting=true にした時だけ本当に終わる。
app.on('window-all-closed', () => { if (quitting) app.quit(); });
