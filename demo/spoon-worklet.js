// THE SPOON - browser version of the plugin's sound engine (a straight port of SpoonEngine.h + processBlock).
// It only ever changes volume: one gain per sample, the same for every channel.

const RELEASE_NOTES = [0.0625, 0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2];
const GRIDS = [0, 2, 1, 0.5, 0.25, 0.125, 0.0625, 2 / 3, 1 / 3, 1 / 6, 1 / 12, 1.5, 0.75, 0.375];
const RATES = [2, 1, 0.5, 0.25, 0.125, 0.0625, 2 / 3, 1 / 3, 1 / 6, 1 / 12, 3, 1.5, 0.75, 0.375];
const MAX_TAPS = 4096;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function releaseNoteIndex(knobMs) {
  const n = Math.log(knobMs / 30) / Math.log(50);
  return clamp(Math.round(n * (RELEASE_NOTES.length - 1)), 0, RELEASE_NOTES.length - 1);
}
const pumpShape = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
function blendedRate(base, b) {
  if (b > 0) return base * Math.pow(0.0625 / base, b);
  if (b < 0) return base * Math.pow(2 / base, -b);
  return base;
}
function lockStart(beat, grid, bpm) {
  if (grid <= 0) return beat;
  const prev = Math.floor(beat / grid) * grid;
  return (beat - prev) * 60 / bpm > 0.045 ? prev + grid : prev;
}
const lockLength = (held, grid) => (grid > 0 ? Math.max(grid, Math.round(held / grid) * grid) : Math.max(0.02, held));

class Envelope {
  constructor(sr) { this.sr = sr; this.s = { floor: 0.15, attack: 0.007, release: 0.25, pump: false }; this.reset(); this.set(this.s); }
  reset() { this.gain = 1; this.down = false; this.downSamples = 0; this.autoHold = 0; this.releasing = false; this.relStart = 1; this.relPos = 0; }
  coef(sec) { return Math.exp(-1 / (Math.max(0.0005, sec) * this.sr)); }
  set(s) {
    this.s = s;
    this.attackCoef = this.coef(s.attack);
    this.releaseCoef = this.coef(Math.max(0.005, s.release / 4));
    this.releaseLen = Math.max(1, s.release * this.sr);
    this.minHold = Math.max(1, Math.round(s.attack * 4 * this.sr));
  }
  hit(attack, hold) { this.autoAttackCoef = this.coef(attack); this.autoHold = Math.max(1, Math.round(Math.max(attack * 4, hold) * this.sr)); }
  next(held) {
    const floor = clamp(this.s.floor, 0.0001, 1);
    if (held && !this.down) { this.down = true; this.downSamples = 0; }
    const tapActive = held || (this.down && this.downSamples < this.minHold);
    if (tapActive || this.autoHold > 0) {
      const a = tapActive ? this.attackCoef : this.autoAttackCoef;
      this.gain = floor + (this.gain - floor) * a;
      if (tapActive) this.downSamples++;
      if (this.autoHold > 0) this.autoHold--;
      this.releasing = false;
      if (!held && this.downSamples >= this.minHold) this.down = false;
      return this.gain;
    }
    this.down = false;
    if (!this.releasing) { this.releasing = true; this.relStart = this.gain; this.relPos = 0; }
    if (this.s.pump) {
      this.gain = this.relStart + (1 - this.relStart) * pumpShape(this.relPos / this.releaseLen);
      if (this.relPos < this.releaseLen) this.relPos += 1;
    } else {
      this.gain = 1 + (this.gain - 1) * this.releaseCoef;
    }
    return this.gain;
  }
}

class SpoonProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.env = new Envelope(sampleRate);
    this.p = { howLong: 250, longUnit: 0, howDeep: 0.85, howSoft: 7, grid: 3, autoScoop: 0, autoRate: 1, speedBlender: 0, mode: 0, spoon: 0 };
    this.taps = [[], []];          // [pattern, song]: {start, len} in quarter notes
    this.poff = 0;                 // Pattern: the bar where its loop starts
    this.screenHeld = false; this.midiDown = 0; this.recording = false;
    this.tr = { playing: false, at: 0, ap: 0, bpm: 120 };
    this.wasPlaying = false; this.wasAutoOn = false; this.expected = 0; this.nextAuto = 0; this.lastAuto = -1e9;
    this.prevLive = false; this.recIndex = -1; this.recMode = 0; this.recStartAbs = 0;
    this.recVersion = 0; this.sentVersion = 0; this.level = 0; this.blocks = 0;
    this.port.onmessage = e => this.onMsg(e.data);
  }
  onMsg(m) {
    if (m.type === "param") this.p[m.id] = m.v;
    else if (m.type === "params") Object.assign(this.p, m.p);
    else if (m.type === "tap") this.screenHeld = !!m.on;
    else if (m.type === "midi") this.midiDown = m.on ? this.midiDown + 1 : Math.max(0, this.midiDown - 1);
    else if (m.type === "midiReset") this.midiDown = 0;
    else if (m.type === "rec") this.recording = !!m.on;
    else if (m.type === "transport") this.tr = m.tr;
    else if (m.type === "setTaps") { this.taps[m.mode] = m.taps.slice(0, MAX_TAPS); this.recIndex = -1; if (typeof m.poff === "number") this.poff = m.poff; }
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    const n = output[0] ? output[0].length : 128;
    const p = this.p, tr = this.tr, sr = sampleRate;
    const bpm = Math.max(20, tr.bpm);
    const ppq = tr.ap + (currentTime - tr.at) * bpm / 60;
    const playing = tr.playing && ppq >= 0;
    const loop = 16;

    // input level, for the lane's picture
    let sum = 0, cnt = 0;
    for (const ch of input) for (let i = 0; i < ch.length; i++) { sum += ch[i] * ch[i]; cnt++; }
    this.level = this.level * 0.7 + Math.sqrt(sum / Math.max(1, cnt)) * 0.3;

    const softSec = p.howSoft / 1000;
    const release = p.longUnit < 0.5 ? p.howLong / 1000 : RELEASE_NOTES[releaseNoteIndex(p.howLong)] * 60 / bpm;
    this.env.set({ floor: 1 - p.howDeep, attack: softSec, release, pump: p.longUnit >= 0.5 });

    const autoOn = p.autoScoop >= 0.5 && playing;
    const effRate = blendedRate(RATES[clamp(Math.round(p.autoRate), 0, RATES.length - 1)], p.speedBlender);
    const bps = bpm / 60 / sr;
    const autoAttack = Math.min(softSec, effRate * 60 / bpm / 10);
    const autoHold = effRate * 60 / bpm * 0.5;
    if (autoOn) {
      const jumped = !this.wasPlaying || !this.wasAutoOn || Math.abs(ppq - this.expected) > bps * 4 + 1e-6;
      if (jumped) { this.nextAuto = Math.ceil(ppq / effRate - 1e-9) * effRate; this.lastAuto = this.nextAuto - effRate; }
      else { const want = Math.max(ppq, this.lastAuto + effRate); if (want < this.nextAuto) this.nextAuto = want; }
    }
    this.wasPlaying = playing; this.wasAutoOn = autoOn; this.expected = ppq + n * bps;

    const mode = p.mode >= 0.5 ? 1 : 0;
    const grid = GRIDS[clamp(Math.round(p.grid), 0, GRIDS.length - 1)];
    const taps = this.taps[mode];
    const cands = [];
    if (playing) {
      const p0 = ppq, p1 = ppq + n * bps;
      let a = (p0 - this.poff) % loop; if (a < 0) a += loop;
      const offset = p0 - a;
      for (const t of taps) {
        if (mode === 1) { if (t.start < p1 && t.start + t.len > p0) cands.push(t); }
        else for (let k = -1; k <= 1; k++) { const s0 = offset + t.start + k * loop; if (s0 < p1 && s0 + t.len > p0) cands.push({ start: s0, len: t.len }); }
      }
    }
    const canRecord = playing && this.recording;
    if (this.recIndex >= 0 && (!playing || this.recMode !== mode)) { this.recIndex = -1; this.recVersion++; }

    for (let i = 0; i < n; i++) {
      const beatNow = ppq + i * bps;
      if (autoOn && beatNow >= this.nextAuto - 1e-9) { this.env.hit(autoAttack, autoHold); this.lastAuto = this.nextAuto; this.nextAuto += effRate; }
      const live = this.screenHeld || p.spoon >= 0.5 || this.midiDown > 0;

      if (live && !this.prevLive && canRecord && taps.length < MAX_TAPS) {
        this.recStartAbs = lockStart(beatNow, grid, bpm);
        let start = this.recStartAbs;
        if (mode === 0) {
          if (taps.length === 0) { const bar = loop / 4; this.poff = Math.floor(this.recStartAbs / bar + 1e-9) * bar; }
          start = (start - this.poff) % loop; if (start < 0) start += loop;
        }
        taps.push({ start, len: grid > 0 ? grid : 0.05 });
        this.recIndex = taps.length - 1; this.recMode = mode; this.recVersion++;
      }
      if (!live && this.recIndex >= 0 && this.recIndex < taps.length) {
        taps[this.recIndex].len = lockLength(beatNow - this.recStartAbs, grid);
        this.recIndex = -1; this.recVersion++;
      }
      this.prevLive = live;

      let tapHeld = false;
      for (const c of cands) if (beatNow >= c.start && beatNow < c.start + c.len) { tapHeld = true; break; }
      const g = this.env.next(live || tapHeld);
      for (let ch = 0; ch < output.length; ch++) {
        const src = input[ch] || input[0];
        output[ch][i] = src ? src[i] * g : 0;
      }
    }

    if (++this.blocks % 5 === 0) {
      const msg = { type: "tick", g: this.env.gain, ppq, playing, level: this.level, poff: this.poff, rec: this.recording };
      if (this.recVersion !== this.sentVersion) {
        this.sentVersion = this.recVersion;
        const flat = l => { const o = []; for (const t of l) o.push(t.start, t.len); return o; };
        msg.taps = { pattern: flat(this.taps[0]), song: flat(this.taps[1]) };
      }
      this.port.postMessage(msg);
    }
    return true;
  }
}
registerProcessor("the-spoon", SpoonProcessor);
