// THE SPOON - browser version. Stands in for the DAW + plugin: it gives the plugin's own screen
// a fake JUCE backend, plays a demo track, and runs the same sound engine in an AudioWorklet.
(function () {
"use strict";
const LS = "thespoon-web-v1";
// ?mobile=1 : a phone-sized taste (Jelly mode only, tap anywhere). The full plugin screen is for computers.
const MOBILE = new URLSearchParams(location.search).has("mobile");
if (MOBILE) document.documentElement.classList.add("wb-mobile");
let saved = {};
try { saved = JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch (e) { saved = {}; }
const P = Object.assign({ howLong: 250, longUnit: 0, howDeep: 0.85, howSoft: 7, grid: 3, autoScoop: 0, autoRate: 1, speedBlender: 0, mode: 0, spoon: 0 }, saved.params || {});
const UI = Object.assign({ tapKeyCode: "KeyT", tapKeyLabel: "T", drawerOpen: "1" }, saved.ui || {});
const TAPS = { pattern: saved.pattern || [], song: saved.song || [] };
let poff = saved.poff || 0, midiNote = typeof saved.midiNote === "number" ? saved.midiNote : -1, learning = false;
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify({ params: P, ui: UI, pattern: TAPS.pattern, song: TAPS.song, poff, midiNote })); } catch (e) {}
  }, 300);
}

/* ---------- the fake JUCE backend the plugin screen talks to ---------- */
const handlers = {};
function emit(name, payload) { (handlers[name] || []).forEach(f => { try { f(payload); } catch (e) { console.error(e); } }); }
const unflat = f => { const o = []; for (let i = 0; i + 1 < f.length; i += 2) o.push({ start: f[i], len: f[i + 1] }); return o; };
const NATIVE = {
  setParam(id, v) { if (id in P) { P[id] = Number(v); post({ type: "param", id, v: Number(v) }); persist(); } },
  gesture() {},
  tap(on) { ensureAudio(); if (on && !T.playing && !T.everPlayed) play(); post({ type: "tap", on: !!on }); },
  uiState(k, v) { if (MOBILE && k === "drawerOpen") return; UI[k] = v; persist(); },
  learnMidi(on) { learning = !!on; if (on) ensureMidi(); },
  resize() {},
  setTaps(mode, flat) { const key = mode ? "song" : "pattern"; TAPS[key] = (flat || []).slice(); post({ type: "setTaps", mode: mode ? 1 : 0, taps: unflat(TAPS[key]) }); persist(); },
  rec(on) { T.rec = !!on; post({ type: "rec", on: T.rec }); },
  ready() {
    emit("params", Object.assign({}, P, { tapKeyCode: UI.tapKeyCode, tapKeyLabel: UI.tapKeyLabel, midiNote }));
    emit("taps", { pattern: TAPS.pattern, song: TAPS.song });
    fit();
    sendTick({ g: 1, ppq: 0, playing: false, level: 0, poff, rec: false });
  },
};
window.__JUCE__ = {
  initialisationData: { version: "0.4.1 · web", drawerOpen: MOBILE ? "0" : UI.drawerOpen, scale: 1 },
  backend: {
    addEventListener(name, f) { (handlers[name] = handlers[name] || []).push(f); return [name, f]; },
    removeEventListener() {},
    emitEvent(name, payload) {
      if (name !== "__juce__invoke" || !payload) return;
      const fn = NATIVE[payload.name];
      if (fn) { try { fn.apply(null, payload.params || []); } catch (e) { console.error(e); } }
    },
  },
};

/* ---------- transport: a tiny DAW (play / stop / tempo) ---------- */
const T = { playing: false, everPlayed: false, rec: false, bpm: Number(saved.bpm) || 120, at: 0, ap: 0, nextBeat: 0, timer: 0, kick: saved.kick !== false, source: "pad" };
let ctx = null, node = null, master, padBus, kickBus, pad = null, fileBuf = null, fileNode = null, pending = [];
function post(m) { if (node) node.port.postMessage(m); else pending.push(m); }
function sendTick(t) { emit("tick", { g: t.g, bpm: T.bpm, playing: t.playing, ppq: t.ppq, level: t.level, loop: 16, poff: t.poff, rec: t.rec }); }
const ppqAt = t => T.ap + (t - T.at) * T.bpm / 60;
const timeAt = b => T.at + (b - T.ap) * 60 / T.bpm;
function transportMsg() { post({ type: "transport", tr: { playing: T.playing, at: T.at, ap: T.ap, bpm: T.bpm } }); }

let audioPromise = null;
function ensureAudio() {
  if (audioPromise) { if (ctx && ctx.state === "suspended") ctx.resume(); return audioPromise; }
  if (!window.isSecureContext || !(window.AudioContext || window.webkitAudioContext)) {
    // browsers only run this sound engine on secure (https://) pages
    setStatus("Sound needs a secure page. Open https://manyuko.com (with the s).");
    audioPromise = Promise.reject(new Error("insecure"));
    audioPromise.catch(() => {});
    return audioPromise;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (!ctx.audioWorklet) { setStatus("This browser can't run the demo. Try Chrome or Safari."); audioPromise = Promise.reject(new Error("noworklet")); audioPromise.catch(() => {}); return audioPromise; }
  master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
  kickBus = ctx.createGain(); kickBus.gain.value = 0.5; kickBus.connect(master);   // the kick is not spooned
  padBus = ctx.createGain(); padBus.gain.value = 0.9;
  pad = makePad(ctx, padBus);
  audioPromise = ctx.audioWorklet.addModule("spoon-worklet.js").then(() => {
    node = new AudioWorkletNode(ctx, "the-spoon", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    padBus.connect(node); node.connect(master);
    node.port.onmessage = e => {
      const m = e.data;
      if (m.type !== "tick") return;
      poff = m.poff;
      if (m.taps) { TAPS.pattern = m.taps.pattern; TAPS.song = m.taps.song; emit("taps", m.taps); persist(); }
      sendTick(m);
    };
    node.port.postMessage({ type: "params", p: P });
    node.port.postMessage({ type: "setTaps", mode: 0, taps: unflat(TAPS.pattern), poff });
    node.port.postMessage({ type: "setTaps", mode: 1, taps: unflat(TAPS.song) });
    pending.splice(0).forEach(m => node.port.postMessage(m));
    transportMsg();
  }).catch(err => { console.error(err); setStatus("Audio couldn't start in this browser. Try Chrome or Safari."); });
  ensureMidi();
  return audioPromise;
}

function kickAt(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g); g.connect(kickBus); o.start(t); o.stop(t + 0.36);
}
function schedule() {
  if (!T.playing) return;
  const end = ppqAt(ctx.currentTime + 0.12);
  while (T.nextBeat < end) {
    const t = timeAt(T.nextBeat);
    if (t >= ctx.currentTime - 0.01) {
      if (T.kick) kickAt(t);
      if (T.source === "pad" && T.nextBeat % 4 === 0) pad.chord(t, (T.nextBeat / 4) % 4, 4 * 60 / T.bpm);
    }
    T.nextBeat++;
  }
}
async function play() {
  try { await ensureAudio(); } catch (e) { return; }
  if (T.playing) return;
  T.playing = true; T.everPlayed = true;
  T.at = ctx.currentTime + 0.08; T.ap = 0; T.nextBeat = 0;
  if (T.source === "file" && fileBuf) startFile(T.at); else pad.start(T.at);
  transportMsg();
  T.timer = setInterval(schedule, 25); schedule();
  syncBar();
}
function stop() {
  if (!T.playing) return;
  T.playing = false; clearInterval(T.timer);
  const now = ctx.currentTime;
  pad.stop(now); stopFile();
  T.rec = false; post({ type: "rec", on: false });
  transportMsg(); syncBar();
}
function setBpm(v) {
  v = Math.max(60, Math.min(180, Math.round(Number(v) || 120)));
  if (ctx && T.playing) { const now = ctx.currentTime; T.ap = ppqAt(now); T.at = now; }
  T.bpm = v; saved.bpm = v; transportMsg(); syncBar(); persistBar();
}
function startFile(t) {
  if (!fileBuf) return;
  fileNode = ctx.createBufferSource(); fileNode.buffer = fileBuf; fileNode.loop = true;
  fileNode.connect(padBus); fileNode.start(t);
}
function stopFile() { if (fileNode) { try { fileNode.stop(); } catch (e) {} fileNode = null; } }
function persistBar() { try { const s = JSON.parse(localStorage.getItem(LS) || "{}"); s.bpm = T.bpm; s.kick = T.kick; localStorage.setItem(LS, JSON.stringify(s)); } catch (e) {} }

/* ---------- MIDI keyboards / pads (Chrome, Edge) ---------- */
let midiAsked = false;
function ensureMidi() {
  if (midiAsked || !navigator.requestMIDIAccess) return;
  midiAsked = true;
  navigator.requestMIDIAccess().then(access => {
    const hook = input => { input.onmidimessage = onMidi; };
    access.inputs.forEach(hook);
    access.onstatechange = e => { if (e.port && e.port.type === "input" && e.port.state === "connected") hook(e.port); };
  }).catch(() => {});
}
function onMidi(e) {
  const [st, note, vel] = e.data, type = st & 0xf0;
  const on = type === 0x90 && vel > 0, off = type === 0x80 || (type === 0x90 && vel === 0);
  if (type === 0xb0 && (note === 123 || note === 120)) { post({ type: "midiReset" }); return; }
  if (!on && !off) return;
  if (on && learning) { midiNote = note; learning = false; persist(); emit("midiLearned", { note }); return; }
  if (midiNote < 0 || note === midiNote) {
    if (on) { ensureAudio(); if (!T.playing && !T.everPlayed) play(); }
    post({ type: "midi", on });
  }
}

/* ---------- fit the plugin into the window ---------- */
function fit() {
  const bar = document.getElementById("wb-bar");
  if (MOBILE) {
    // show just the jelly scene (spoon, bowl, dancer), as big as the phone allows
    const s = Math.max(0.3, (window.innerWidth - 8) / 640);
    emit("scale", { s });
    const wrap = document.querySelector(".wrap");
    if (wrap) { wrap.style.marginLeft = (-262 * s) + "px"; wrap.style.marginTop = (-128 * s) + "px"; wrap.style.marginRight = "0"; wrap.style.marginBottom = (580 * s - 736 * s - 0) + "px"; }
    return;
  }
  const availW = window.innerWidth - 24, availH = window.innerHeight - (bar ? bar.offsetHeight : 0) - 28;
  const s = Math.max(0.3, Math.min(1.25, availW / 980, Math.max(availH, 420) / 736));
  emit("scale", { s });
  const wrap = document.querySelector(".wrap");
  if (wrap) { wrap.style.marginRight = (980 * s - 980) + "px"; wrap.style.marginBottom = (736 * s - 736) + "px"; }
}
window.addEventListener("resize", fit);

/* ---------- the little transport bar under the plugin ---------- */
function setStatus(t) { const el = document.getElementById("wb-status"); if (el) el.textContent = t || ""; }
function syncBar() {
  const b = document.getElementById("wb-play"); if (!b) return;
  b.textContent = T.playing ? "■ Stop" : "▶ Play"; b.classList.toggle("on", T.playing);
  document.getElementById("wb-bpm").value = T.bpm;
  document.getElementById("wb-kick").classList.toggle("on", T.kick);
  document.getElementById("wb-kick").setAttribute("aria-pressed", T.kick);
  document.getElementById("wb-pad").classList.toggle("on", T.source === "pad");
  document.getElementById("wb-own").classList.toggle("on", T.source === "file");
  if (MOBILE) setStatus(T.playing ? "Tap anywhere on the jelly." : "Press play, then tap the jelly. Silent mode on? Turn it off to hear it.");
  else setStatus(T.playing ? "" : (T.everPlayed ? "" : "Press play (or just tap the spoon) and play your sidechain."));
}
document.addEventListener("DOMContentLoaded", () => {
  const $ = id => document.getElementById(id);
  $("wb-play").onclick = () => (T.playing ? stop() : play());
  $("wb-bpm").onchange = e => setBpm(e.target.value);
  $("wb-kick").onclick = () => { T.kick = !T.kick; persistBar(); syncBar(); };
  $("wb-pad").onclick = async () => { T.source = "pad"; if (T.playing) { stopFile(); pad.start(ctx.currentTime); } syncBar(); };
  $("wb-own").onclick = () => $("wb-file").click();
  $("wb-file").onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    await ensureAudio();
    try {
      const buf = await f.arrayBuffer();
      fileBuf = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
      T.source = "file";
      if (T.playing) { pad.stop(ctx.currentTime); stopFile(); startFile(ctx.currentTime); }
      syncBar();
    } catch (err) { setStatus("Couldn't read that file. Try a WAV or MP3."); }
    e.target.value = "";
  };
  // Space = play / stop, like a DAW (unless it's the tap key)
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && UI.tapKeyCode !== "Space" && !e.repeat && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) {
      e.preventDefault(); T.playing ? stop() : play();
    }
  }, true);
  syncBar();
  requestAnimationFrame(fit);
});
document.addEventListener("pointerdown", () => { if (!ctx) ensureAudio(); }, { capture: true, once: true });
if (MOBILE) {
  // on a phone the whole scene is the spoon: touch anywhere (except the player bar) to dip
  let held = false;
  const inBar = e => e.target && e.target.closest && e.target.closest("#wb-bar");
  document.addEventListener("pointerdown", e => { if (inBar(e) || held) return; held = true; NATIVE.tap(true); }, true);
  const up = () => { if (!held) return; held = false; NATIVE.tap(false); };
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
}

/* ---------- the demo track: original atmospheric pad in A minor (same as the prototype) ---------- */
function makePad(ac, dest) {
  const input = ac.createGain(); input.gain.value = 1;
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500; lp.Q.value = 0.6;
  const lfo = ac.createOscillator(), lfoAmt = ac.createGain(); lfo.frequency.value = 0.06; lfoAmt.gain.value = 650; lfo.connect(lfoAmt); lfoAmt.connect(lp.frequency);
  const dry = ac.createGain(); dry.gain.value = 0.8;
  const verb = ac.createConvolver(), wet = ac.createGain(); wet.gain.value = 0.55;
  const len = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lpS = 0; for (let i = 0; i < len; i++) { const t = i / len; const k = 0.35 + 0.6 * t; lpS = lpS * k + (Math.random() * 2 - 1) * (1 - k); d[i] = lpS * Math.pow(1 - t, 2.4) * 2.2; } }
  verb.buffer = ir;
  input.connect(lp); lp.connect(dry); lp.connect(verb); verb.connect(wet); dry.connect(dest); wet.connect(dest);
  let noiseSrc = null, started = false;
  const VOICES = [[45, 52, 55, 59, 60], [41, 48, 52, 57, 64], [48, 55, 59, 64, 67], [40, 47, 55, 62, 67]];
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const live = [];
  function start(t) {
    if (!started) { lfo.start(t); started = true; }
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    noiseSrc = ac.createBufferSource(); noiseSrc.buffer = nb; noiseSrc.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.4;
    const ng = ac.createGain(); ng.gain.value = 0.0001; ng.gain.setTargetAtTime(0.010, t, 1.5);
    noiseSrc.connect(bp); bp.connect(ng); ng.connect(input); noiseSrc.start(t);
  }
  function chord(t, bar, dur) {
    const notes = VOICES[bar % 4], g = ac.createGain(), out = [];
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.9);
    g.gain.setValueAtTime(0.05, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.4);
    g.connect(input);
    notes.forEach((m, i) => {
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (pan) { pan.pan.value = ((i % 2) ? 1 : -1) * (0.15 + 0.12 * i); pan.connect(g); }
      const tgt = pan || g, bass = i === 0;
      const types = bass ? [["triangle", 0, 1.3]] : [["sawtooth", -7, 0.45], ["sawtooth", 7, 0.45], ["triangle", 0, 0.5]];
      types.forEach(([type, det, lvl]) => {
        const o = ac.createOscillator(), og = ac.createGain(); o.type = type; o.frequency.value = hz(m); o.detune.value = det + (Math.random() * 4 - 2);
        og.gain.value = lvl; o.connect(og); og.connect(tgt); o.start(t); o.stop(t + dur + 1.5); out.push(o);
      });
    });
    const top = notes[notes.length - 1] + 12, ao = ac.createOscillator(), ag = ac.createGain(), trem = ac.createOscillator(), tg = ac.createGain();
    ao.type = "sine"; ao.frequency.value = hz(top); ag.gain.value = 0.25; trem.frequency.value = 0.35; tg.gain.value = 0.15;
    trem.connect(tg); tg.connect(ag.gain); ao.connect(ag); ag.connect(g);
    ao.start(t); trem.start(t); ao.stop(t + dur + 1.5); trem.stop(t + dur + 1.5); out.push(ao, trem);
    const v = { o: out, g }; live.push(v); out[0].onended = () => { const k = live.indexOf(v); if (k >= 0) live.splice(k, 1); };
  }
  function stop(now) {
    live.splice(0).forEach(v => { try { v.g.gain.cancelScheduledValues(0); v.g.gain.setTargetAtTime(0, now, 0.05); v.o.forEach(o => o.stop(now + 0.3)); } catch (e) {} });
    if (noiseSrc) { try { noiseSrc.stop(now + 0.2); } catch (e) {} noiseSrc = null; }
  }
  return { start, chord, stop };
}
})();
