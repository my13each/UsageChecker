// UsageChecker overlay — cross-platform (Win/Mac/Linux) Electron widget.
// 画面隅に常駐し、~/.claude のトランスクリプトから実コスト($)を毎数秒集計して表示。
// mac 専用 API(osascript/say)は不使用。ドッキングなし・固定コーナー(ドラッグ移動可)。
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const POLL_MS = 2500;
const W = 300, H = 250;
let win = null;
let collectFn = null;

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
  win.webContents.send('usage', data);
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
    show: false,
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

  ipcMain.on('uc-quit', () => { savePos(); app.quit(); });
  ipcMain.on('uc-move', (_e, d) => {
    if (!win || win.isDestroyed()) return;
    const [cx, cy] = win.getPosition();
    win.setPosition(cx + Math.round(d.dx || 0), cy + Math.round(d.dy || 0));
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.setActivationPolicy) app.setActivationPolicy('accessory');
    await loadCollector();
    createWindow();
    tick();
    setInterval(tick, POLL_MS);
  });
}
app.on('window-all-closed', () => app.quit());
