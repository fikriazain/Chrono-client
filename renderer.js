const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });

const dpr = window.devicePixelRatio || 1;
canvas.width = innerWidth * dpr;
canvas.height = innerHeight * dpr;
gl.viewport(0, 0, canvas.width, canvas.height);

// ---------- Poses ----------
const poses = {
  stand: { src: 'assets/Chrono float init.png', tex: null, aspect: 1, scale: 1 },
  drag:  { src: 'assets/chrono_drag.png',       tex: null, aspect: 1, scale: 0.9 },
  sleep: { src: 'assets/chrono_sleep.png',      tex: null, aspect: 1, scale: 0.95 },
};
let pose = 'stand';
let wantDrag = false;
let sleeping = false;

// ---------- Click vs drag (we handle dragging ourselves) ----------
let press = null;
let lastX = 0, pendingDx = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  press = { x: e.screenX, y: e.screenY, dragging: false };
  lastX = e.screenX;
  pendingDx = 0;
  window.mini.dragStart();
});
canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!press.dragging && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 5) {
    press.dragging = true;               // moved more than 5px: a drag, not a click
    setDragging(true);
    window.mini.dragBegin();
  }
  if (press.dragging) {
    pendingDx += e.screenX - lastX;
    window.mini.dragMove();
  }
  lastX = e.screenX;
});
function release(isClick) {
  if (!press) return;
  const wasDrag = press.dragging;
  press = null;
  if (wasDrag) setDragging(false);
  window.mini.dragEnd();
  if (isClick && !wasDrag) window.mini.click();
}
canvas.addEventListener('pointerup', () => release(true));
canvas.addEventListener('pointercancel', () => release(false));

canvas.addEventListener('lostpointercapture', () => release(false));

// ---------- Shaders ----------
const VERT = `
attribute vec2 aUV;
uniform float uTime;
uniform float uHeadAngle;
uniform float uAspect;     // image width / height
uniform float uBob;
uniform float uDrag;       // 1 while dangling
uniform float uSleep;      // 1 while sleeping
uniform float uSwing;      // pendulum angle (dangling) or slow sway (sleeping)
uniform vec2  uFit;        // keeps the image's proportions inside the window
varying vec2 vUV;

// rotate point p around center c (aspect-corrected so it doesn't shear)
vec2 rotateAround(vec2 p, vec2 c, float a) {
  vec2 d = p - c;
  d.x *= uAspect;
  float s = sin(a), co = cos(a);
  d = vec2(co * d.x - s * d.y, s * d.x + co * d.y);
  d.x /= uAspect;
  return c + d;
}

void main() {
  vec2 p = aUV;                       // (0,0) = top-left, (1,1) = bottom-right
  float stand = 1.0 - uDrag;
  float awake = 1.0 - uSleep;

  // Wings: sway around each shoulder (off while sleeping)
  float wWing = smoothstep(0.12, 0.40, abs(p.x - 0.5))
              * (1.0 - smoothstep(0.62, 0.80, p.y))
              * awake;
  float side = p.x < 0.5 ? -1.0 : 1.0;
  vec2 shoulder = vec2(0.5 + side * 0.10, mix(0.26, 0.17, uDrag));
  float wingAngle = sin(uTime * 1.6 + side * 0.8) * mix(0.035, 0.06, uDrag);
  p = mix(p, rotateAround(p, shoulder, wingAngle), wWing);

  // Head: rotate around the neck (standing only)
  vec2 neck = vec2(0.5, 0.25);
  float wHead = (1.0 - smoothstep(0.22, 0.30, p.y))
              * (1.0 - smoothstep(0.12, 0.19, abs(p.x - 0.5)))
              * stand * awake;
  p = mix(p, rotateAround(p, neck, uHeadAngle), wHead);

  // Dangling: swing from the grab point. Sleeping: a slow sway around the center.
  vec2 pivot = mix(vec2(0.5, 0.5), vec2(0.42, 0.14), uDrag);
  p = mix(p, rotateAround(p, pivot, uSwing), max(uDrag, uSleep));

  // Floating bob (breathing while sleeping)
  p.y -= uBob * stand;

  // Fit the image into the window without stretching
  p = (p - vec2(0.5)) * uFit + vec2(0.5);

  vUV = aUV;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUV); }
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(prog);
gl.useProgram(prog);

// ---------- Mesh: a grid covering the whole image ----------
const COLS = 32, ROWS = 48;
const uvs = [], idx = [];
for (let y = 0; y <= ROWS; y++)
  for (let x = 0; x <= COLS; x++) uvs.push(x / COLS, y / ROWS);
for (let y = 0; y < ROWS; y++)
  for (let x = 0; x < COLS; x++) {
    const a = y * (COLS + 1) + x, b = a + 1, c = a + COLS + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'aUV');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

// ---------- Uniforms ----------
const U = (n) => gl.getUniformLocation(prog, n);
const uTime = U('uTime'), uHead = U('uHeadAngle'), uAspect = U('uAspect'), uBob = U('uBob');
const uDrag = U('uDrag'), uSleep = U('uSleep'), uSwing = U('uSwing'), uFit = U('uFit');

// ---------- Textures ----------
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

function loadPose(name) {
  return new Promise((resolve) => {
    const P = poses[name];
    const im = new Image();
    im.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      P.tex = tex;
      P.aspect = im.width / im.height;
      resolve(true);
    };
    im.onerror = () => { console.error('Could not load', P.src); resolve(false); };
    im.src = P.src;
  });
}

// the size she should have, in pixels (the normal window size)
const BASE_W = 250, BASE_H = 375;

// pick which texture and settings to use right now: dragging > sleeping > standing
function applyPose() {
  let name = 'stand';
  if (wantDrag && poses.drag.tex) name = 'drag';
  else if (sleeping && poses.sleep.tex) name = 'sleep';

  const P = poses[name];
  if (!P.tex) return;
  pose = name;
  gl.bindTexture(gl.TEXTURE_2D, P.tex);
  gl.uniform1f(uAspect, P.aspect);

  // fit the image inside a BASE_W x BASE_H box, then convert to a fraction of the current window
  const boxW = BASE_W * P.scale, boxH = BASE_H * P.scale;
  let w = boxW, h = boxW / P.aspect;
  if (h > boxH) { h = boxH; w = boxH * P.aspect; }
  gl.uniform2f(uFit, w / innerWidth, h / innerHeight);
  gl.uniform1f(uDrag, name === 'drag' ? 1 : 0);
  gl.uniform1f(uSleep, name === 'sleep' ? 1 : 0);
}

function draw() {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
}

window.addEventListener('resize', () => {
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  applyPose();
  draw();
});

// ---------- Zzz effect ----------
const zzz = document.getElementById('zzz');
let zTimer = null;

function spawnZ() {
  const z = document.createElement('span');
  z.className = 'z';
  z.textContent = Math.random() < 0.5 ? 'z' : 'Z';
  z.style.fontSize = (16 + Math.random() * 12) + 'px';
  z.style.left = (54 + Math.random() * 6) + '%';
  z.addEventListener('animationend', () => z.remove());
  zzz.appendChild(z);
}
function startZzz() {
  if (zTimer) return;
  spawnZ();
  zTimer = setInterval(spawnZ, 1500);
}
function stopZzz() {
  clearInterval(zTimer);
  zTimer = null;
  zzz.innerHTML = '';
}

// main.js tells us when she falls asleep or wakes up
function setSleeping(v) {
  sleeping = v;
  applyPose();
  if (v) startZzz(); else stopZzz();
}
window.mini.onSleep(setSleeping);

// ---------- Dangle physics ----------
let swing = 0, swingVel = 0, vx = 0;

function setDragging(v) {
  wantDrag = v;
  if (v) { swing = 0; swingVel = 0; vx = 0; pendingDx = 0; }
  applyPose();
}

// ---------- Animation ----------
let headNow = 0, headTarget = 0, nextLook = 0, last = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (now - last < 1000 / 12) return;   // 12 fps "on twos"; delete this line for smooth motion
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const t = now / 1000;

  // pick a new head direction every few seconds
  if (t > nextLook) {
    headTarget = Math.random() < 0.4 ? 0 : (Math.random() * 2 - 1) * 0.12;   // radians
    nextLook = t + 2 + Math.random() * 4;
  }
  headNow += (headTarget - headNow) * 0.15;

  // dangling: lag behind the cursor like a pendulum
  if (pose === 'drag') {
    vx = vx * 0.5 + (pendingDx / dt) * 0.5;    // cursor speed in px/s
    pendingDx = 0;
    const target = Math.max(-0.4, Math.min(0.4, vx * 0.0007)) + Math.sin(t * 2.2) * 0.03;
    swingVel += ((target - swing) * 40 - swingVel * 5) * dt;   // spring + damping
    swing += swingVel * dt;
  }

  const sl = pose === 'sleep';
  gl.uniform1f(uTime, t);
  gl.uniform1f(uHead, headNow);
  gl.uniform1f(uBob, sl ? Math.sin(t * 0.7) * 0.012 : Math.sin(t * 1.4) * 0.006);   // slow "breathing" when asleep
  gl.uniform1f(uSwing, sl ? Math.sin(t * 0.5) * 0.025 : swing);

  draw();
}

loadPose('stand').then((ok) => {
  if (!ok) return;
  applyPose();
  requestAnimationFrame(frame);
});
loadPose('drag').then(applyPose);    // if it finishes loading mid-drag, it switches right away
loadPose('sleep').then(applyPose);