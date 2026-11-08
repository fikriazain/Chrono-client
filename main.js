// Receiver only: no AI, no screenshots, no reminders. It shows a visit and carries a reply back.
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');

if (!app.requestSingleInstanceLock()) app.quit();   // a second copy would fight over the port

// ---- settings ----
const WIN_W = 250, WIN_H = 375, MARGIN = 20, TASKBAR_H = 48;
const FX_PAD_X = 200, FX_PAD_Y = 160;
const BUB_W = 400, BUB_H = 290;
const TIP = { x: 322, y: 272 };
const HEAD = { x: 0.3, y: 55 };
const MAX_VISIT_MS = 60000;      // a visit never lasts longer than this

const ACK_LINES = ['Fine. I will pass it on.', 'Understood. I will carry it back.', 'Noted. Stay where you are.'];

let win, bubbleWin, fxWin, tray;
let bubbleOpen = false;
let fxKind = null, fxResolve = null;
let visiting = false, visitEnd = null, visitDeadline = 0, replyText = null;
let server = null;
const hits = [];
const seen = new Map();
const discHits = [];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const forwardLogs = (w, tag) => w.webContents.on('console-message', (e, level, msg) => console.log(tag, msg ?? e.message));

// ---------- config ----------
let lan = { token: '', id: '', deviceName: '', named: false, port: 4747, discoveryPort: 4748, discoverable: true, dnd: false, stayMs: 20000 };
const lanFile = () => path.join(app.getPath('userData'), 'lan.json');
const lanIps = () =>
  Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

function saveLan() {
  try { fs.writeFileSync(lanFile(), JSON.stringify(lan, null, 2)); } catch (e) { console.error('[lan] save failed', e); }
}
function loadLan() {
  try { Object.assign(lan, JSON.parse(fs.readFileSync(lanFile(), 'utf8'))); } catch {}
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8')); } catch {}
  if (!lan.token && d.token) lan.token = String(d.token);
  if (!lan.deviceName) lan.deviceName = String(d.deviceName || os.hostname()).slice(0, 24);
  if (!lan.id) lan.id = crypto.randomBytes(8).toString('hex');
  saveLan();
  console.log('[lan] config file:', lanFile());
  console.log('[lan] this PC:', lan.deviceName, lanIps().join(', '));
  if (!lan.token) console.log('[lan] NO TOKEN: put the sender token in defaults.json, then restart');
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- windows ----------
function placeCharacter() {
  const b = screen.getPrimaryDisplay().bounds;
  win.setBounds({ x: b.x + b.width - WIN_W - MARGIN, y: b.y + b.height - WIN_H - TASKBAR_H, width: WIN_W, height: WIN_H });
}

function placeBubble() {
  const c = win.getBounds();
  const area = screen.getDisplayMatching(c).workArea;
  let x = Math.round(c.x + c.width * HEAD.x - TIP.x);
  let y = Math.round(c.y + HEAD.y - TIP.y);
  x = Math.min(Math.max(x, area.x), area.x + area.width - BUB_W);
  y = Math.max(y, area.y);
  bubbleWin.setBounds({ x, y, width: BUB_W, height: BUB_H });
}

function createWindows() {
  const prefs = { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false };
  const base = { transparent: true, frame: false, alwaysOnTop: true, resizable: false, hasShadow: false, skipTaskbar: true };

  win = new BrowserWindow({ ...base, width: WIN_W, height: WIN_H, show: false, focusable: false,
    webPreferences: { ...prefs, webSecurity: false } });   // webSecurity: same reason as on your main PC
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);                          // she is a visitor: clicks pass straight through
  win.loadFile('index.html');
  placeCharacter();
  screen.on('display-metrics-changed', placeCharacter);

  bubbleWin = new BrowserWindow({ ...base, width: BUB_W, height: BUB_H, show: false, webPreferences: prefs });
  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.loadFile('bubble.html');
  forwardLogs(bubbleWin, '[bubble]');

  fxWin = new BrowserWindow({ ...base, width: WIN_W + 2 * FX_PAD_X, height: WIN_H + 2 * FX_PAD_Y,
    show: false, focusable: false, webPreferences: prefs });
  fxWin.setAlwaysOnTop(true, 'screen-saver');
  fxWin.setIgnoreMouseEvents(true);
  fxWin.loadFile('fx.html');
  forwardLogs(fxWin, '[fx]');
}

// ---------- glitch effect ----------
function finishFx() {
  fxWin.hide();
  const r = fxResolve;
  fxResolve = null; fxKind = null;
  if (r) r();
}

function playFx(kind) {   // 'in' = she appears here, 'out' = she leaves
  return new Promise((resolve) => {
    if (fxResolve) { const old = fxResolve; fxResolve = null; old(); }   // never leave an older call waiting forever
console.log('[fx] play', kind);
    fxKind = kind;
    fxResolve = resolve;
    const mb = win.getBounds();
    fxWin.setBounds({ x: mb.x - FX_PAD_X, y: mb.y - FX_PAD_Y, width: WIN_W + 2 * FX_PAD_X, height: WIN_H + 2 * FX_PAD_Y });
    const go = () => fxWin.webContents.send('fx-start', { kind, pad: { x: FX_PAD_X, y: FX_PAD_Y }, size: { w: WIN_W, h: WIN_H } });
    if (fxWin.webContents.isLoading()) fxWin.webContents.once('did-finish-load', go); else go();
    setTimeout(() => {   // safety net
      if (fxResolve === resolve) { if (kind === 'in') win.showInactive(); else win.hide(); finishFx(); }
    }, 5000);
    
  });
}
ipcMain.on('fx-ready', () => { fxWin.showInactive(); if (fxKind === 'out') win.hide(); });
ipcMain.on('fx-arrive', () => { win.showInactive(); fxWin.moveTop(); });
ipcMain.on('fx-done', () => finishFx());

// ---------- bubble ----------
function openBubble(text) {
  bubbleGen++;
  bubbleOpen = true;
  placeBubble();
  bubbleWin.showInactive();
  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  bubbleWin.moveTop();
  const send = () => bubbleWin.webContents.send('bubble-open', text);
  if (bubbleWin.webContents.isLoading()) bubbleWin.webContents.once('did-finish-load', send); else send();
}
const closeBubble = () => {
  bubbleWin.webContents.send('bubble-close');
  const g = bubbleGen;
  setTimeout(() => {                            // if the page never confirmed, hide it ourselves
    if (bubbleOpen && bubbleGen === g) {
      console.log('[bubble] force hide (no confirmation from the page)');
      bubbleOpen = false;
      bubbleWin.hide();
    }
  }, 1500);
};
const waitHidden = async (ms) => { const t0 = Date.now(); while (bubbleOpen && Date.now() - t0 < ms) await wait(100); };

ipcMain.on('bubble-hidden', () => {      // closed with x or Esc, or by us
  bubbleOpen = false;
  bubbleWin.hide();
  if (visitEnd) visitEnd();
});
ipcMain.on('bubble-touch', () => {       // he clicked or typed: give him more time
  visitDeadline = Math.max(visitDeadline, Date.now() + lan.stayMs);
});
ipcMain.handle('chat-send', (e, text) => {   // the reply box
  if (!visiting || replyText !== null) return '...';
  replyText = String(text).trim().slice(0, 140) || null;
  if (replyText) setTimeout(() => { if (visitEnd) visitEnd(); }, 2000);   // let her speak her line first
  return pick(ACK_LINES);
});

// ---------- the visit ----------
async function runVisit(m, respond) {
  visiting = true;
  replyText = null;
  const started = Date.now();
  let timer = null;
  try {
    placeCharacter();
    await playFx('in');
    openBubble(`From ${m.from}: ${m.text}`);
    visitDeadline = Date.now() + lan.stayMs;
    await new Promise((end) => {
      visitEnd = end;
      timer = setInterval(() => {
        if (Date.now() > visitDeadline || Date.now() - started > MAX_VISIT_MS) end();
      }, 500);
    });
  } catch (e) {
    console.error('[visit] failed', e);
  } finally {
    clearInterval(timer);
    visitEnd = null;
  }
  respond({ ok: true, reply: replyText });     // the answer goes back to your PC now, while she leaves
  try {
    if (bubbleOpen) { closeBubble(); await waitHidden(900); }
    await playFx('out');
  } catch (e) {
    console.error('[visit] leaving failed', e);
    win.hide();
  }
  visiting = false;
}

// ---------- server ----------
function startServer() {
  if (server || !lan.token) return;
  server = http.createServer((req, res) => {
    const reply = (code, obj) => {
      if (res.writableEnded) return;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST' || req.url !== '/chrono/message') return reply(404, { ok: false });

    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      const now = Date.now();
      const ts = String(req.headers['x-chrono-ts'] || '');
      const sig = String(req.headers['x-chrono-sig'] || '');
      const want = crypto.createHmac('sha256', lan.token).update(ts + '.' + body).digest('hex');
      if (!safeEqual(sig, want) || Math.abs(now - Number(ts)) > 60000 || seen.has(sig)) return reply(401, { ok: false });
      seen.set(sig, now);
      for (const [k, t] of seen) if (now - t > 120000) seen.delete(k);

      while (hits.length && now - hits[0] > 60000) hits.shift();
      if (hits.length >= 10) return reply(429, { ok: false });
      hits.push(now);

      let m;
      try { m = JSON.parse(body); } catch { return reply(400, { ok: false }); }
      const text = String(m.text || '').trim().slice(0, 140);
      const from = String(m.from || 'Someone').slice(0, 24);
      if (!text) return reply(400, { ok: false });
      if (lan.dnd) return reply(200, { ok: false, reason: 'dnd' });
      if (visiting) return reply(200, { ok: false, reason: 'busy' });
      runVisit({ from, text }, (obj) => reply(200, obj));   // the HTTP answer waits for the visit to end
    });
  });
  server.on('error', (e) => console.error('[lan] server error:', e.message));
  server.listen(lan.port, '0.0.0.0', () => console.log(`[lan] listening on port ${lan.port}`));
}

// ---------- discovery: answer "who runs Chrono?" (name, id and port only: never the token) ----------
function startDiscovery() {
  const sock = dgram.createSocket('udp4');
  sock.on('error', (e) => console.error('[discover] error:', e.message));
  sock.on('message', (buf, rinfo) => {
    if (!lan.discoverable || buf.length > 200) return;
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    if (!m || m.chrono !== 'who') return;
    const now = Date.now();
    while (discHits.length && now - discHits[0] > 60000) discHits.shift();
    if (discHits.length >= 30) return;
    discHits.push(now);
    sock.send(Buffer.from(JSON.stringify({ chrono: 'here', id: lan.id, name: lan.deviceName, port: lan.port })), rinfo.port, rinfo.address, () => {});
  });
  sock.bind(lan.discoveryPort, '0.0.0.0', () => console.log(`[discover] answering on UDP ${lan.discoveryPort}`));
}

// ---------- tray: he can always see it is running, and stop it ----------
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: `Chrono receiver: ${lan.deviceName}`, enabled: false },
    { label: lanIps().join(', ') || 'No network', enabled: false },
    { type: 'separator' },
    { label: 'Rename this PC...', click: () => openSetup(false) },
    { label: 'Do not disturb', type: 'checkbox', checked: lan.dnd, click: (i) => { lan.dnd = i.checked; saveLan(); } },
    { label: 'Visible to other PCs', type: 'checkbox', checked: lan.discoverable, click: (i) => { lan.discoverable = i.checked; saveLan(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray() {
  try {
    let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'Chrono float init.png'));
    if (!icon.isEmpty()) icon = icon.resize({ height: 24 });
    tray = new Tray(icon);
    tray.setToolTip('Chrono receiver');
    tray.setContextMenu(trayMenu());
  } catch (e) {
    console.error('[tray] could not create the tray icon:', e.message);
  }
}

const updateTray = () => { if (tray) tray.setContextMenu(trayMenu()); };

// ---------- first-run window (also opened from the tray: "Rename this PC...") ----------
let setupWin = null;

function openSetup(first) {
  if (setupWin) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 420, height: lan.token ? 240 : 320,
    resizable: false, minimizable: false, maximizable: false,
    title: 'Chrono receiver', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  setupWin.setMenu(null);
  setupWin.loadFile('setup.html', { query: { name: lan.deviceName, needToken: lan.token ? '' : '1' } });
  setupWin.on('closed', () => { setupWin = null; });
}

ipcMain.on('setup-save', (e, d) => {
  if (!lan.token && !String((d && d.token) || '').trim()) return;   // never save without a pairing code
  const name = String((d && d.name) || '').trim().replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 24);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  if (name) lan.deviceName = name;
  const tok = String((d && d.token) || '').trim();
  if (tok && !lan.token) lan.token = tok;
  lan.named = true;
  saveLan();
  if (setupWin) setupWin.close();
  updateTray();
  startServer();            // starts now if the token only just arrived

});

// ---------- silent auto-update ----------
let updateReady = false;

function installWhenIdle() {
  if (!updateReady) return;
  if (visiting || setupWin) { setTimeout(installWhenIdle, 60 * 1000); return; }   // never during a visit or while he is typing
  autoUpdater.quitAndInstall(true, true);   // install silently, then start again
}

function setupUpdates() {
  if (!app.isPackaged) return;              // only the installed app updates itself
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;  // fallback: installs when he shuts down
  autoUpdater.on('error', (e) => console.error('[update]', e.message));
  autoUpdater.on('update-available', (i) => console.log('[update] found', i.version));
  autoUpdater.on('update-downloaded', (i) => { console.log('[update] ready', i.version); updateReady = true; installWhenIdle(); });
  const check = () => autoUpdater.checkForUpdates().catch((e) => console.error('[update] check failed:', e.message));
  setTimeout(check, 30 * 1000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');   // known workaround for animations stalling in covered windows

app.whenReady().then(() => {
  loadLan();
  createWindows();
  createTray();
  startServer();
  startDiscovery();
  setupUpdates();
});