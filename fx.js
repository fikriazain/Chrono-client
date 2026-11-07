const cvs = document.getElementById('fx');
const ctx = cvs.getContext('2d');

const FILE = 'assets/Chrono float init.png';   // the same image the mini uses

// ---- timing (ms) ----
const OUT_GLITCH = 650, OUT_FLY = 400;   // leaving: tear apart, then collapse
const IN_FLY = 500, IN_ARRIVE = 700;    // arriving: converge, then impact
const STEP = 66, FLY_FRAMES = 7, NSTRIPS = 28;

const BLUE = '#2f6bff', PURPLE = '#b03cff', CYAN = '#00f0ff', MAGENTA = '#ff2bd6', WHITE = '#ffffff', DEEP = '#0a0620';
const PAL = [BLUE, PURPLE, CYAN, MAGENTA, WHITE, DEEP];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);

let img = null, S = null;
let dpr = 1, W = 0, H = 0, CX = 0, CY = 0, R = { x: 0, y: 0, w: 0, h: 0 };
let kind = 'out', running = false, start = 0, lastStep = -1e9, arrived = false;

const DELAY = Array.from({ length: NSTRIPS }, () => rand(0, 0.4));
const SCATTER = Array.from({ length: NSTRIPS }, () => ({ x: rand(-170, 170), y: rand(-150, 150) }));
const G = { shifts: new Array(NSTRIPS).fill(0), blocks: [], split: 0, alpha: 1, jx: 0, jy: 0, white: false, ox: 0 };

function loadImage(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
function tint(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
function makeSprite(im, boxW, boxH) {
  let w = boxW, h = (boxW * im.height) / im.width;
  if (h > boxH) { h = boxH; w = (boxH * im.width) / im.height; }
  w = Math.round(w); h = Math.round(h);
  const SR = Math.min(dpr, 1.5);
  const full = document.createElement('canvas');
  full.width = Math.round(w * SR); full.height = Math.round(h * SR);
  full.getContext('2d').drawImage(im, 0, 0, full.width, full.height);
  return { w, h, full, cyan: tint(full, CYAN), magenta: tint(full, MAGENTA) };
}

function phaseOf(t) {
  if (kind === 'out') return t < OUT_GLITCH ? 'glitch' : t < OUT_GLITCH + OUT_FLY ? 'fly' : 'end';
  return t < IN_FLY ? 'fly' : t < IN_FLY + IN_ARRIVE ? 'arrive' : 'end';
}

function blocksIn(x, y, w, h, n) {
  for (let i = 0; i < n; i++) G.blocks.push({ x: x + rand(0, w), y: y + rand(0, h), w: rand(8, 70), h: rand(3, 16), c: pick(PAL) });
}

// re-roll the held glitch drawing (every STEP ms)
function roll(t) {
  G.shifts.fill(0); G.blocks = []; G.split = 0; G.alpha = 1; G.jx = 0; G.jy = 0; G.white = false; G.ox = 0;
  const ph = phaseOf(t);
  if (ph === 'glitch') {
    const k = t / OUT_GLITCH;
    for (let i = 0; i < NSTRIPS; i++) if (Math.random() < 0.1 + 0.55 * k) G.shifts[i] = rand(-1, 1) * (8 + 90 * k);
    G.split = 3 + 14 * k;
    G.alpha = Math.random() < 0.25 * k ? rand(0.1, 0.4) : 1;
    G.jx = rand(-1, 1) * 8 * k; G.jy = rand(-1, 1) * 5 * k;
    blocksIn(R.x - 40, R.y, R.w + 80, R.h, 3 + Math.round(8 * k));
  } else if (ph === 'fly') {
    blocksIn(CX - 130, CY - 160, 260, 320, 6);
  } else if (ph === 'arrive') {
    const k = (t - IN_FLY) / IN_ARRIVE;
    G.white = k < 0.12;
    G.ox = rand(-8, 8);
    const n = 3 + Math.round(10 * (1 - k));
    for (let i = 0; i < n; i++)            // scan bars across her spot
      G.blocks.push({ x: R.x - 60 + rand(0, R.w + 120), y: R.y + rand(-20, R.h), w: rand(40, R.w + 120), h: rand(2, 3 + 10 * (1 - k)), c: pick([CYAN, MAGENTA, WHITE, BLUE]) });
    for (let i = 0; i < 8; i++) {          // chips flying outward
      const a = rand(0, Math.PI * 2), r = rand(40, 60 + 200 * k);
      G.blocks.push({ x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r, w: rand(6, 26), h: rand(3, 10), c: pick(PAL) });
    }
  }
}

// strips of the sprite, slid sideways, with color-split ghosts
function drawStrips(cx, cy) {
  const left = cx - S.w / 2, top = cy - S.h / 2;
  const sh = S.full.height / NSTRIPS, dh = S.h / NSTRIPS;
  ctx.globalAlpha = G.alpha;
  for (let i = 0; i < NSTRIPS; i++) {
    const dx = G.shifts[i] || 0, sy = i * sh, dy = top + i * dh;
    if (G.split) {
      ctx.drawImage(S.cyan, 0, sy, S.full.width, sh, left + dx - G.split, dy, S.w, dh + 0.5);
      ctx.drawImage(S.magenta, 0, sy, S.full.width, sh, left + dx + G.split, dy, S.w, dh + 0.5);
    }
    ctx.drawImage(S.full, 0, sy, S.full.width, sh, left + dx, dy, S.w, dh + 0.5);
  }
  ctx.globalAlpha = 1;
}

function pose(i, kk) {
  const p = clamp((kk - DELAY[i]) / 0.6);
  const home = { x: CX, y: CY - S.h / 2 + ((i + 0.5) * S.h) / NSTRIPS };
  if (kind === 'out') {                                   // collapse into a point
    const e = p * p;
    return { p, a: 1, sc: lerp(1, 0.05, e), x: home.x, y: lerp(home.y, CY, e) };
  }
  const e = easeOut(p);                                   // arrive: scattered spot -> her place
  const from = { x: CX + SCATTER[i].x, y: CY + SCATTER[i].y };
  return { p, a: clamp(p * 5), sc: lerp(0.15, 1, e), x: lerp(from.x, home.x, e), y: lerp(from.y, home.y, e) };
}

function drawFlight(u, dur) {
  const k = clamp(u / dur);
  const kq = Math.min(1, Math.floor(k * FLY_FRAMES) / (FLY_FRAMES - 1));   // stepped = choppy
  const prev = Math.max(0, kq - 1 / (FLY_FRAMES - 1));
  const sh = S.full.height / NSTRIPS;
  for (let i = 0; i < NSTRIPS; i++) {
    const a = pose(i, kq), b = pose(i, prev);
    const dw = S.w * a.sc, dh = (S.h / NSTRIPS) * a.sc, sy = i * sh, sp = 10 * Math.sin(a.p * Math.PI);
    if (a.p > 0 && a.p < 1) {
      ctx.strokeStyle = i % 2 ? CYAN : MAGENTA; ctx.globalAlpha = 0.5 * a.a; ctx.lineWidth = Math.max(1, dh);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
    }
    ctx.globalAlpha = a.a;
    ctx.drawImage(S.cyan, 0, sy, S.full.width, sh, a.x - dw / 2 - sp, a.y - dh / 2, dw, dh + 0.5);
    ctx.drawImage(S.magenta, 0, sy, S.full.width, sh, a.x - dw / 2 + sp, a.y - dh / 2, dw, dh + 0.5);
    ctx.drawImage(S.full, 0, sy, S.full.width, sh, a.x - dw / 2, a.y - dh / 2, dw, dh + 0.5);
  }
  ctx.globalAlpha = 1;
}

function drawArrive(t) {
  const k = clamp((t - IN_FLY) / IN_ARRIVE);
  if (G.white) { ctx.fillStyle = WHITE; ctx.fillRect(R.x, R.y, R.w, R.h); }
  ctx.lineWidth = 3; ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = CYAN; ctx.strokeRect(R.x - G.ox, R.y, R.w, R.h);
  ctx.strokeStyle = MAGENTA; ctx.strokeRect(R.x + G.ox, R.y, R.w, R.h);
  const e = easeOut(k);
  ctx.strokeStyle = WHITE; ctx.strokeRect(R.x - 110 * e, R.y - 110 * e, R.w + 220 * e, R.h + 220 * e);
  ctx.globalAlpha = 1;
}

function render(t, ph) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (ph === 'glitch') drawStrips(CX + G.jx, CY + G.jy);
  else if (ph === 'fly') drawFlight(kind === 'out' ? t - OUT_GLITCH : t, kind === 'out' ? OUT_FLY : IN_FLY);
  for (const b of G.blocks) { ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.w, b.h); }
  if (ph === 'arrive') drawArrive(t);
}

function tick(now) {
  if (!running) return;
  const t = Math.max(0, now - start);
  if (now - lastStep >= STEP) { lastStep = now; roll(t); }
  const ph = phaseOf(t);
  if (kind === 'in' && ph === 'arrive' && !arrived) { arrived = true; window.fxApi.arrive(); }   // main shows the mini now
  if (ph === 'end') {
    running = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    window.fxApi.done();
    return;
  }
  render(t, ph);
  requestAnimationFrame(tick);
}

window.fxApi.onStart(async (d) => {
  if (running) return;
  kind = d.kind;
  dpr = window.devicePixelRatio || 1;
  W = d.size.w + 2 * d.pad.x; H = d.size.h + 2 * d.pad.y;
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
  R = { x: d.pad.x, y: d.pad.y, w: d.size.w, h: d.size.h };
  CX = R.x + R.w / 2; CY = R.y + R.h / 2;

  if (!img) img = await loadImage(FILE);
  if (!img) {                                            // image missing: skip the effect
    console.error('[fx] image not found:', FILE);
    if (kind === 'in') window.fxApi.arrive();
    window.fxApi.done();
    return;
  }
  S = makeSprite(img, R.w, R.h);
  arrived = false; lastStep = -1e9; running = true; start = performance.now();
  roll(0); render(0, phaseOf(0));                        // first frame, drawn while still hidden
  window.fxApi.ready();
  requestAnimationFrame(tick);
});