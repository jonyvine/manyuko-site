// THE SPOON party: in Jelly mode, the more you tap, the wilder the screen gets.
// Screen only: it never touches the sound. Draws nothing (and costs ~nothing) while idle or on the controls screen.
(function () {
"use strict";
const W = 980, H = 736;
let cv, cx, cvB, cxB, cxF, plugin, partyBeats = 0, bpmNow = 120, energy = 0, lastG = 1, playingNow = false, ballPos = 0, peakShown = -1e9, fullSince = 0, t0 = performance.now();
const confetti = [], sparks = [];
const COLS = ["#ff4f9a", "#28d7ff", "#ffd23f", "#8cff5a", "#b06bff", "#ff8a2b"];
const rnd = (a, b) => a + Math.random() * (b - a);
const IMG = {}; ["ball", "dj", "hands"].forEach(n => { const im = new Image(); im.src = "party-" + n + ".png"; IMG[n] = im; });
let djFrame = 0, crowdFrame = 0, djPos = 0, handsPos = 0, cleared = true;

function setup() {
  plugin = document.getElementById("plugin");
  if (!plugin) return setTimeout(setup, 100);
  cv = document.createElement("canvas");
  cv.width = W * 2; cv.height = H * 2;
  cv.style.cssText = "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;pointer-events:none;z-index:4;border-radius:22px";
  plugin.appendChild(cv);
  cx = cv.getContext("2d"); cx.scale(2, 2); cxF = cx;
  // a second layer BEHIND the spoon, bowl and MANYUKO: lights, his spotlight, the ball and the DJ
  cvB = document.createElement("canvas"); cvB.width = W * 2; cvB.height = H * 2;
  cvB.style.cssText = "position:absolute;left:0;top:0;width:" + W + "px;height:" + H + "px;pointer-events:none;z-index:0;border-radius:22px";
  plugin.insertBefore(cvB, plugin.firstChild);
  cxB = cvB.getContext("2d"); cxB.scale(2, 2);
  if (!window.__JUCE__ || !window.__JUCE__.backend) return setTimeout(setup, 100);
  window.__JUCE__.backend.addEventListener("tick", t => {
    playingNow = !!t.playing; bpmNow = t.bpm || 120;
    if (lastG > 0.6 && t.g <= 0.6) onDip();
    lastG = t.g;
  });
  requestAnimationFrame(frame);
}
function stage() { return energy < 0.22 ? 0 : energy < 0.5 ? 1 : energy < 0.8 ? 2 : 3; }
function onDip() {
  if (plugin.classList.contains("open")) return;
  energy = Math.min(1, energy + 0.09);
  const s = stage();
  let f; do { f = (Math.random() * 4) | 0; } while (f === djFrame); djFrame = f;
  crowdFrame = 1 - crowdFrame;
  if (s >= 2) for (let i = 0; i < 9; i++) confetti.push({ x: rnd(80, 900), y: rnd(-30, 0), vx: rnd(-30, 30), vy: rnd(50, 110), r: rnd(0, 6), vr: rnd(-6, 6), c: COLS[i % COLS.length], w: rnd(6, 10), h: rnd(3, 5), floor: rnd(260, 400), a: 1 });
  if (s >= 3) {
    const bx = rnd(150, 830), by = rnd(90, 260), c = COLS[(Math.random() * COLS.length) | 0];
    for (let i = 0; i < 46; i++) { const a = (i / 46) * Math.PI * 2, sp = rnd(120, 260); sparks.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, c }); }
    const nowMs = performance.now();
    if (!fullSince) fullSince = nowMs;
    if (energy > 0.95 && nowMs - fullSince > 8000 && nowMs - peakShown > 20000) peakShown = nowMs;
  }
  while (confetti.length > 70) confetti.shift();
  while (sparks.length > 260) sparks.shift();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const open = plugin.classList.contains("open");
  const folding = open || !playingNow;
  energy = Math.max(0, energy - dt * (folding ? 0.55 : 0.035));
  const ballTarget = energy > 0.18 ? Math.min(1, (energy - 0.18) / 0.4) : 0;
  ballPos += (ballTarget - ballPos) * Math.min(1, dt * (folding ? 1.8 : 0.45));
  const t = (now - t0) / 1000, s = stage();
  if (s < 3) fullSince = 0;
  const idle = energy <= 0 && ballPos < 0.005 && djPos < 0.01 && handsPos < 0.01 && !confetti.length && !sparks.length && now - peakShown > 1400;
  if (idle) { if (!cleared) { cxF.clearRect(0, 0, W, H); cxB.clearRect(0, 0, W, H); cleared = true; } partyBeats = 0; return requestAnimationFrame(frame); }
  cleared = false;
  cxF.clearRect(0, 0, W, H); cxB.clearRect(0, 0, W, H); cx = cxB;
  if (!open && (energy > 0.01 || ballPos > 0.005)) {
    // club darkness

    // spotlights
    cx.save(); cx.globalCompositeOperation = "multiply";
    const beams = [[60, -20, COLS[0]], [920, -20, COLS[1]], [300, -30, COLS[2]], [680, -30, COLS[3]]];
    beams.forEach(([bx, by, c], i) => {
      if (i >= 2 && s < 2) return;
      const a = Math.sin(t * (0.7 + i * 0.23) + i) * 0.55 + (i % 2 ? -0.25 : 0.25);
      cx.save(); cx.translate(bx, by); cx.rotate(a);
      const g = cx.createLinearGradient(0, 0, 0, 760);
      g.addColorStop(0, c + "cc"); g.addColorStop(1, c + "00");
      cx.globalAlpha = Math.min(1, energy * 1.6) * 0.32;
      cx.fillStyle = g; cx.beginPath(); cx.moveTo(-10, 0); cx.lineTo(10, 0); cx.lineTo(110, 760); cx.lineTo(-110, 760); cx.closePath(); cx.fill();
      cx.restore();
    });
    cx.restore();
    // disco ball
    if (ballPos > 0.005) {
      const drop = ballPos, e = drop * drop * (3 - 2 * drop), R = 88, bx = 181, by = -R - 120 + e * (R + 120 + 290);
      const bw = 165, bh = bw * (IMG.ball.naturalHeight || 440) / (IMG.ball.naturalWidth || 332), top = by - bh * 0.62;
      cx.strokeStyle = "#111"; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(bx, 0); cx.lineTo(bx, top + 4); cx.stroke();
      if (IMG.ball.complete) { cx.save(); cx.translate(bx, top); cx.rotate(Math.sin(t * 1.3) * 0.05); cx.drawImage(IMG.ball, -bw / 2, 0, bw, bh); cx.restore(); }
      // light dots from the ball
      cx.save();
      for (let i = 0; i < 34; i++) {
        const a = i * 2.4 + t * 0.5, rr = 140 + (i * 41) % 520;
        cx.fillStyle = COLS[i % COLS.length]; cx.globalAlpha = 0.55 * e;
        cx.beginPath(); cx.arc(bx + Math.abs(Math.cos(a)) * rr * 1.4, by + Math.sin(a) * rr * 0.6, 5, 0, Math.PI * 2); cx.fill();
      }
      cx.restore();
    }
  }
  // MANYUKO gets his own spotlight: he's the star
  if (!open && energy > 0.12) {
    const k = Math.min(1, (energy - 0.12) / 0.3), mx = 795, my = 655;
    cx.save(); cx.globalAlpha = 0.45 * k;
    const g2 = cx.createLinearGradient(0, 0, 0, my);
    g2.addColorStop(0, "#fff3a0"); g2.addColorStop(1, "#ffd84a");
    cx.fillStyle = g2; cx.beginPath(); cx.moveTo(mx - 18, 0); cx.lineTo(mx + 18, 0); cx.lineTo(mx + 120, my); cx.lineTo(mx - 120, my); cx.closePath(); cx.fill();
    cx.globalAlpha = 0.35 * k; cx.fillStyle = "#ffd84a"; cx.beginPath(); cx.ellipse(mx, my + 2, 118, 16, 0, 0, Math.PI * 2); cx.fill();
    cx.restore();
  }
  cx = cxF;
  // confetti
  confetti.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; if (p.y > p.floor || folding) p.a -= dt * (folding ? 2.5 : 1.6); });
  for (let i = confetti.length - 1; i >= 0; i--) if (confetti[i].a <= 0) confetti.splice(i, 1);
  confetti.forEach(p => { cx.save(); cx.globalAlpha = Math.max(0, p.a); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore(); });
  // fireworks
  cx.save(); cx.globalCompositeOperation = "lighter";
  sparks.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.vx *= 0.985; p.life -= dt * (folding ? 2.5 : 0.8); });
  for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
  sparks.forEach(p => { cx.globalAlpha = Math.max(0, p.life); cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); cx.fill(); });
  cx.restore();
  // the DJ slides in and changes pose on every dip
  // the DJ only shows up after 18 bars of party (time to get to know MANYUKO first)
  if (!folding && energy > 0.22) partyBeats += dt * bpmNow / 60; else if (energy < 0.05 || folding) partyBeats = 0;
  const djT = (open || partyBeats < 72 || energy < 0.3) ? 0 : 1;
  djPos += (djT - djPos) * Math.min(1, dt * (folding ? 2.5 : 0.4));
  cx = cxB;
  if (djPos > 0.01 && IMG.dj.complete) {
    // the DJ slides in from the left on MANYUKO's floor line (no fade), and slides out when the party folds
    const fw = IMG.dj.naturalWidth / 4, fh = IMG.dj.naturalHeight, h = 140, w = h * fw / fh;
    const floorY = 594, e = djPos * djPos * (3 - 2 * djPos), x = 104 - (1 - e) * (w + 120);
    cx.fillStyle = "rgba(80,60,80,.16)"; cx.beginPath(); cx.ellipse(x + w / 2, floorY + 3, w * 0.38, 6, 0, 0, Math.PI * 2); cx.fill();
    cx.drawImage(IMG.dj, djFrame * fw, 0, fw, fh, x, floorY - h, w, h);
  }
  cx = cxF;
  // rock-concert hands rise from the bottom at the full party, and bounce with the taps
  handsPos += (((!open && s >= 3) ? 1 : 0) - handsPos) * Math.min(1, dt * (folding ? 4 : 1.5));
  if (handsPos > 0.01 && IMG.hands.complete) {
    const fw = IMG.hands.naturalWidth, fh = IMG.hands.naturalHeight / 2, w = 730, h = w * fh / fw;
    const y = H - h * (handsPos * handsPos * (3 - 2 * handsPos)) + (crowdFrame ? 0 : 10);
    cx.save(); cx.beginPath(); cx.roundRect(0, 0, W, H, 22); cx.clip();
    cx.drawImage(IMG.hands, 0, crowdFrame * fh, fw, fh, (W - w) / 2, y, w, h);
    cx.restore();
  }
  // SPOON IT! flash at the peak
  const since = now - peakShown;
  if (!open && since < 1400) {
    const k = since / 1400, sc = 0.8 + Math.sin(Math.min(1, k * 3) * Math.PI / 2) * 0.35;
    cx.save(); cx.translate(490, 330); cx.rotate(-0.08); cx.scale(sc, sc); cx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
    cx.font = "900 92px 'Rubik','Arial Black',sans-serif"; cx.textAlign = "center"; cx.lineWidth = 10; cx.strokeStyle = "#111"; cx.strokeText("SPOON IT!", 0, 0);
    cx.fillStyle = COLS[Math.floor(now / 120) % COLS.length]; cx.fillText("SPOON IT!", 0, 0);
    cx.restore();
  }
  requestAnimationFrame(frame);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
})();
