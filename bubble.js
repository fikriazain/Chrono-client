// bubble.js
const $ = (id) => document.getElementById(id);
const pop = $('pop'), msg = $('msg'), input = $('in'), g1 = $('g1'), g2 = $('g2');
const rand = (a, b) => a + Math.random() * (b - a);

const GREETING = "You called? Don't make me wait too long, or I'll leave.";
const STEP = 66;                 // glitch holds each drawing this long (anime "on twos")
let burst = 0;                   // > 0 while a glitch burst is running (counts ticks)
let busy = false, closing = false, typeId = 0;
let openCount = 0;
let isOpen = false;
let seq = 0;

// ---------- Glitch: re-rolled every STEP ms, held in between ----------
function slice(g, strong) {
  const a = rand(0, 85), h = rand(6, strong ? 40 : 22);
  g.style.clipPath = `inset(${a}% 0 ${Math.max(0, 100 - a - h)}% 0)`;
  g.style.transform = `translateX(${rand(-1, 1) * (strong ? 26 : 12)}px)`;
  g.style.opacity = 1;
}
setInterval(() => {
  if (!isOpen) return;
  if (burst <= 0 && Math.random() < 0.04) burst = 2 + Math.floor(Math.random() * 3);   // random idle glitch
  if (burst > 0) {
    const strong = burst > 4;
    slice(g1, strong); slice(g2, strong);
    pop.style.transform = `translate(${rand(-1, 1) * (strong ? 6 : 2)}px, ${rand(-1, 1) * 2}px)`;
    msg.style.transform = Math.random() < 0.5 ? `translateX(${rand(-4, 4)}px)` : '';
    burst--;
  } else {
    g1.style.opacity = g2.style.opacity = 0;
    pop.style.transform = msg.style.transform = '';
  }
}, STEP);

// ---------- Typewriter with flickering glyphs ----------
const GLYPHS = '█▓▒░#@%&/\\<>';
function typeText(str) {
  const id = ++typeId;
  let i = 0;
  return new Promise((done) => {
    (function next() {
      if (id !== typeId) return done();
      i++;
      const flick = i < str.length && Math.random() < 0.15 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : '';
      msg.textContent = str.slice(0, i) + flick;
      if (flick && burst <= 0) burst = 1;
      if (i >= str.length) return done();
      setTimeout(next, 24 + Math.random() * 20);
    })();
  });
}

// ---------- Pop in / out ----------
function open(text = GREETING) {
  seq++;
  pop.getAnimations().forEach((a) => a.cancel());
  openCount++;
  isOpen = true;
  closing = false; busy = false;
  input.value = ''; msg.textContent = '';
  pop.style.opacity = 1;
  burst = 9;
  pop.animate(
    [{ transform: 'scale(.15)', opacity: 0 }, { transform: 'scale(1.07)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 420, easing: 'steps(7)' }
  );
  input.focus();
  setTimeout(() => typeText(text), 330);
}

function say(text) {
  if (!isOpen || closing) { open(text); return; }
  burst = 5;
  typeText(text);
}

function close() {
  if (!isOpen) { window.bubble.hidden(); return; }   // out of sync: tell main it is hidden
  if (closing) return;
  const mine = ++seq;
  closing = true; typeId++; burst = 6;
  let done = false;
  const finish = () => {
    if (done || mine !== seq) return;        // already finished, or the bubble was reopened meanwhile
    done = true;
    isOpen = false; closing = false;
    pop.style.opacity = 0;
    console.log('[bubble.js] hidden');
    window.bubble.hidden();
  };
  pop.animate(
    [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.05) skewX(8deg)', opacity: .8, offset: .3 }, { transform: 'scale(.1)', opacity: 0 }],
    { duration: 260, easing: 'steps(4)', fill: 'forwards' }
  ).onfinish = finish;
  setTimeout(finish, 600);                   // if nothing was being drawn, the animation may never finish
}

// ---------- Chat ----------
async function submit() {
  const text = input.value.trim();
  if (!text || busy) return;
  const mine = openCount;
  busy = true; input.value = ''; burst = 4;
  await typeText('▒▒▒');
  const reply = await window.bubble.send(text);
  if (mine !== openCount) return;        // closed and reopened while waiting: drop the old reply
  burst = 3;
  await typeText(reply);
  busy = false;
  input.focus();
}
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
$('x').addEventListener('click', close);

window.bubble.onSay(say);

// if you click or type in a bubble that a drag opened, keep it open
document.addEventListener('pointerdown', () => window.bubble.touch());
input.addEventListener('input', () => window.bubble.touch());

window.bubble.onOpen(open);
window.bubble.onClose(() => {
  if (Date.now() - openedAt < 1500) { console.log('[bubble.js] ignored a close right after opening'); return; }
  close();
});