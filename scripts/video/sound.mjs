// A small synthesiser for the demo video: drums, bass, pads, an arpeggio and
// every sound effect are generated sample by sample, so the soundtrack needs no
// recordings and no downloads. Output is stereo Float32 at 48 kHz.
export const SR = 48000;

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export class Bus {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
  }
  add(i, v, pan = 0) {
    if (i < 0 || i >= this.n) return;
    this.L[i] += v * Math.min(1, 1 - pan);
    this.R[i] += v * Math.min(1, 1 + pan);
  }
}

// Band-limited single-cycle tables, read with a phase accumulator.
const TABLE = 4096;
const table = (harmonic) => {
  const t = new Float32Array(TABLE);
  for (let h = 1; h <= 24; h++) {
    const a = harmonic(h);
    if (!a) continue;
    for (let i = 0; i < TABLE; i++) t[i] += a * Math.sin((2 * Math.PI * h * i) / TABLE);
  }
  return t;
};
const SAW = table((h) => 1 / h);
const SQUARE = table((h) => (h % 2 ? 1 / h : 0));
const read = (tab, phase) => tab[(phase * TABLE) & (TABLE - 1)];

/** RBJ biquad, recomputable per block for sweeps. */
class Biquad {
  constructor(type, f, q = 0.707) {
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(f, q);
  }
  set(f, q = this.q) {
    this.q = q;
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
    const c = Math.cos(w),
      s = Math.sin(w),
      a = s / (2 * q);
    let b0, b1, b2;
    if (this.type === "lp") [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (this.type === "hp") [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else [b0, b1, b2] = [a, 0, -a];
    const a0 = 1 + a;
    [this.b0, this.b1, this.b2, this.a1, this.a2] = [
      b0 / a0,
      b1 / a0,
      b2 / a0,
      (-2 * c) / a0,
      (1 - a) / a0,
    ];
  }
  run(x) {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Schroeder reverb: four combs and two all-passes per channel. */
export function reverb(bus, { mix = 0.25, size = 1, damp = 0.35 } = {}) {
  const combs = [1557, 1617, 1491, 1422].map((d) => Math.round(d * size));
  const alls = [225, 556];
  for (const [ch, spread] of [
    [bus.L, 0],
    [bus.R, 23],
  ]) {
    const out = new Float32Array(ch.length);
    for (const d0 of combs) {
      const d = d0 + spread,
        buf = new Float32Array(d);
      let idx = 0,
        low = 0;
      for (let i = 0; i < ch.length; i++) {
        const y = buf[idx];
        low = y * (1 - damp) + low * damp;
        buf[idx] = ch[i] + low * 0.84;
        out[i] += y;
        idx = (idx + 1) % d;
      }
    }
    for (const d of alls) {
      const buf = new Float32Array(d + spread);
      let idx = 0;
      for (let i = 0; i < out.length; i++) {
        const b = buf[idx],
          x = out[i];
        buf[idx] = x + b * 0.5;
        out[i] = b - x * 0.5;
        idx = (idx + 1) % buf.length;
      }
    }
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * (1 - mix) + out[i] * mix * 0.25;
  }
}

// ------------------------------------------------------------- instruments

function kick(bus, at, gain = 1) {
  const s = Math.round(at * SR);
  let ph = 0;
  for (let i = 0; i < SR * 0.5; i++) {
    const t = i / SR;
    const f = 42 + 110 * Math.exp(-t * 28);
    ph += f / SR;
    const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) + (i < 90 ? (1 - i / 90) * 0.4 : 0);
    bus.add(s + i, v * gain * 0.9);
  }
}
function snare(bus, at, gain = 1, seed = 1) {
  const s = Math.round(at * SR),
    r = rng(seed),
    hp = new Biquad("hp", 1500),
    bp = new Biquad("bp", 2400, 0.9);
  for (let i = 0; i < SR * 0.28; i++) {
    const t = i / SR,
      n = r() * 2 - 1;
    const v =
      bp.run(hp.run(n)) * Math.exp(-t * 18) * 1.4 +
      Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5;
    bus.add(s + i, v * gain * 0.55, 0.05);
  }
}
function hat(bus, at, gain = 1, open = false, seed = 2) {
  const s = Math.round(at * SR),
    r = rng(seed),
    hp = new Biquad("hp", 7000),
    hp2 = new Biquad("hp", 9000);
  const len = open ? 0.25 : 0.05;
  for (let i = 0; i < SR * len; i++) {
    const t = i / SR;
    bus.add(
      s + i,
      hp2.run(hp.run(r() * 2 - 1)) * Math.exp(-t * (open ? 14 : 70)) * gain * 0.32,
      0.25,
    );
  }
}
function bass(bus, at, dur, freq, gain = 1) {
  const s = Math.round(at * SR),
    lp = new Biquad("lp", 320, 1.1);
  let ph = 0,
    ph2 = 0;
  for (let i = 0; i < SR * dur; i++) {
    const t = i / SR;
    ph += freq / SR;
    ph2 += (freq * 0.5) / SR;
    const env = Math.min(1, t * 200) * Math.exp(-t * 3.2) * (t > dur - 0.02 ? (dur - t) / 0.02 : 1);
    lp.set(180 + 600 * Math.exp(-t * 14));
    bus.add(
      s + i,
      lp.run(read(SAW, ph) * 0.6 + Math.sin(2 * Math.PI * ph2) * 0.8) * env * gain * 0.55,
    );
  }
}
function pad(bus, at, dur, freqs, gain = 1) {
  const s = Math.round(at * SR);
  const voices = freqs.flatMap((f, k) => [
    [f * 0.997, -0.5 + k * 0.3],
    [f * 1.003, 0.5 - k * 0.3],
  ]);
  const lps = voices.map(() => new Biquad("lp", 1400, 0.8));
  const r = rng(Math.round(at * 1000));
  const ph = voices.map(() => r());
  for (let i = 0; i < SR * dur; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.8);
    if (i % 256 === 0) lps.forEach((lp) => lp.set(900 + 700 * Math.sin(t * 0.6 + at)));
    voices.forEach(([f, pan], k) => {
      ph[k] += f / SR;
      bus.add(s + i, lps[k].run(read(SAW, ph[k])) * env * gain * 0.07, pan);
    });
  }
}
function pluck(bus, at, freq, gain = 1, pan = 0) {
  const s = Math.round(at * SR),
    lp = new Biquad("lp", 3000, 0.9);
  let ph = 0;
  for (let i = 0; i < SR * 0.35; i++) {
    const t = i / SR;
    ph += freq / SR;
    lp.set(600 + 4000 * Math.exp(-t * 18));
    bus.add(s + i, lp.run(read(SQUARE, ph)) * Math.exp(-t * 9) * gain * 0.12, pan);
  }
}

// ------------------------------------------------------------- effects

const FX = {
  key(bus, at, g, seed) {
    const s = Math.round(at * SR),
      r = rng(seed),
      hp = new Biquad("hp", 2500);
    for (let i = 0; i < SR * 0.03; i++)
      bus.add(s + i, hp.run(r() * 2 - 1) * Math.exp(-(i / SR) * 260) * 0.5 * g, (r() - 0.5) * 0.4);
  },
  pop(bus, at, g) {
    const s = Math.round(at * SR);
    let ph = 0;
    for (let i = 0; i < SR * 0.18; i++) {
      const t = i / SR;
      ph += (700 + 900 * Math.min(1, t * 20)) / SR;
      bus.add(s + i, Math.sin(2 * Math.PI * ph) * Math.exp(-t * 22) * 0.45 * g);
    }
  },
  glitch(bus, at, g, seed) {
    const s = Math.round(at * SR),
      r = rng(seed);
    let hold = 0,
      v = 0;
    for (let i = 0; i < SR * 0.9; i++) {
      if (hold-- <= 0) {
        hold = Math.floor(r() * 900) + 40;
        v = (r() * 2 - 1) * (r() > 0.4 ? 1 : 0);
      }
      const crush = Math.round(v * 4) / 4;
      bus.add(s + i, crush * 0.35 * g * (1 - i / (SR * 0.9)), Math.sin(i / 3000));
    }
  },
  whoosh(bus, at, g, seed, len = 0.7) {
    const s = Math.round(at * SR),
      r = rng(seed),
      bp = new Biquad("bp", 400, 1.2);
    for (let i = 0; i < SR * len; i++) {
      const t = i / SR,
        x = t / len;
      if (i % 64 === 0) bp.set(300 + 3500 * Math.sin(Math.PI * x) ** 2);
      bus.add(
        s + i,
        bp.run(r() * 2 - 1) * Math.sin(Math.PI * x) ** 2 * 1.1 * g,
        Math.cos(Math.PI * x) * 0.6,
      );
    }
  },
  riser(bus, at, g, seed, len = 2) {
    const s = Math.round(at * SR),
      r = rng(seed),
      bp = new Biquad("bp", 300, 2);
    let ph = 0;
    for (let i = 0; i < SR * len; i++) {
      const t = i / SR,
        x = t / len;
      if (i % 64 === 0) bp.set(250 + 6000 * x * x);
      ph += (180 + 900 * x * x) / SR;
      bus.add(s + i, (bp.run(r() * 2 - 1) * 0.8 + Math.sin(2 * Math.PI * ph) * 0.18) * x * x * g);
    }
  },
  impact(bus, at, g, seed) {
    const s = Math.round(at * SR),
      r = rng(seed),
      lp = new Biquad("lp", 900);
    let ph = 0;
    for (let i = 0; i < SR * 2.2; i++) {
      const t = i / SR;
      ph += (38 + 70 * Math.exp(-t * 9)) / SR;
      const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2);
      const crack = lp.run(r() * 2 - 1) * Math.exp(-t * 16);
      bus.add(s + i, (boom * 1.1 + crack * 0.9) * g);
    }
  },
  stamp(bus, at, g, seed) {
    const s = Math.round(at * SR),
      r = rng(seed),
      bp = new Biquad("bp", 900, 0.7);
    let ph = 0;
    for (let i = 0; i < SR * 0.5; i++) {
      const t = i / SR;
      ph += (70 + 60 * Math.exp(-t * 30)) / SR;
      bus.add(
        s + i,
        (Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * 1.0 +
          bp.run(r() * 2 - 1) * Math.exp(-t * 35) * 1.2) *
          g,
      );
    }
  },
  clack(bus, at, g, seed) {
    const s = Math.round(at * SR),
      r = rng(seed),
      bp = new Biquad("bp", 3200, 2);
    for (let i = 0; i < SR * 0.04; i++)
      bus.add(s + i, bp.run(r() * 2 - 1) * Math.exp(-(i / SR) * 140) * 0.9 * g, (r() - 0.5) * 0.6);
  },
  print(bus, at, g, seed, len = 2) {
    const s = Math.round(at * SR),
      r = rng(seed),
      bp = new Biquad("bp", 2600, 1.5);
    for (let i = 0; i < SR * len; i++) {
      const t = i / SR;
      const pulse = 0.55 + 0.45 * Math.sign(Math.sin(2 * Math.PI * 34 * t));
      bus.add(s + i, bp.run(r() * 2 - 1) * pulse * 0.32 * g * Math.min(1, (len - t) * 4), 0.15);
    }
  },
  chime(bus, at, g) {
    const s = Math.round(at * SR);
    for (let i = 0; i < SR * 1.8; i++) {
      const t = i / SR;
      const v = [880, 1318.5, 1760].reduce(
        (a, f, k) => a + (Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (2.5 + k))) / (k + 1.5),
        0,
      );
      bus.add(s + i, v * 0.32 * g);
    }
  },
  down(bus, at, g) {
    const s = Math.round(at * SR);
    let ph = 0;
    for (let i = 0; i < SR * 0.9; i++) {
      const t = i / SR;
      ph += (520 * Math.pow(0.45, t / 0.9)) / SR;
      bus.add(s + i, read(SQUARE, ph) * Math.exp(-t * 2.5) * 0.12 * g);
    }
  },
  buzz(bus, at, g) {
    const s = Math.round(at * SR),
      lp = new Biquad("lp", 1800);
    let p1 = 0,
      p2 = 0;
    for (let i = 0; i < SR * 0.7; i++) {
      const t = i / SR;
      p1 += 110 / SR;
      p2 += 116.5 / SR;
      const gate = Math.sin(2 * Math.PI * 7 * t) > -0.2 ? 1 : 0.2;
      bus.add(
        s + i,
        lp.run(read(SQUARE, p1) + read(SQUARE, p2)) * gate * Math.min(1, (0.7 - t) * 6) * 0.22 * g,
      );
    }
  },
  blip(bus, at, g) {
    const s = Math.round(at * SR);
    for (let i = 0; i < SR * 0.08; i++)
      bus.add(s + i, Math.sin(2 * Math.PI * 1500 * (i / SR)) * Math.exp(-(i / SR) * 50) * 0.25 * g);
  },
};

/**
 * Renders the music bed and the effects. `grid` sets the tempo and where
 * bars fall; `sections` say which parts play when; `events` are effects.
 */
export function soundtrack({ duration, bpm, origin, sections, events }) {
  const music = new Bus(duration),
    drums = new Bus(duration),
    fx = new Bus(duration);
  const beat = 60 / bpm;
  const CHORDS = [
    { root: 55, tones: [220, 261.63, 329.63] }, // A minor
    { root: 43.65, tones: [174.61, 220, 261.63] }, // F
    { root: 65.41, tones: [261.63, 329.63, 392] }, // C
    { root: 49, tones: [196, 246.94, 293.66] }, // G
  ];
  const ARP = [0, 1, 2, 1];
  const at = (k) => origin + k * beat;
  const firstBeat = Math.ceil(-origin / beat);
  const lastBeat = Math.floor((duration - origin) / beat);
  const sectionOf = (t) => sections.find((s) => t >= s.from && t < s.to)?.kind ?? "none";
  for (let k = firstBeat; k <= lastBeat; k++) {
    const t = at(k),
      kind = sectionOf(t),
      bar = Math.floor(k / 4),
      inBar = ((k % 4) + 4) % 4;
    const chord = CHORDS[((bar % 4) + 4) % 4];
    if (kind === "none") continue;
    if (inBar === 0 && kind !== "cut")
      pad(
        music,
        t,
        beat * 4 + 0.6,
        chord.tones,
        kind === "intro" ? 0.8 : kind === "lite" ? 0.9 : 1,
      );
    if (kind === "intro") {
      hat(drums, t + beat / 2, 0.5, false, k);
      if (inBar === 0) bass(music, t, beat * 2, chord.root, 0.6);
    }
    if (kind === "groove" || kind === "full" || kind === "build") {
      kick(drums, t, kind === "full" ? 1 : 0.85);
      if (inBar === 1 || inBar === 3) snare(drums, t, kind === "full" ? 1 : 0.8, k);
      hat(drums, t + beat / 2, 0.8, inBar === 3, k);
      hat(drums, t, 0.45, false, k + 99);
      bass(music, t, beat * 0.45, chord.root * 2, 0.9);
      bass(music, t + beat / 2, beat * 0.4, chord.root * 2, 0.7);
      for (let q = 0; q < 4; q++)
        pluck(
          music,
          t + (q * beat) / 4,
          chord.tones[ARP[q]] * 2,
          kind === "full" ? 0.9 : 0.6,
          q % 2 ? 0.35 : -0.35,
        );
    }
    if (kind === "build")
      for (let q = 0; q < 4; q++)
        snare(drums, t + (q * beat) / 4, 0.25 + 0.6 * ((k % 8) / 8), k * 4 + q);
    if (kind === "lite") {
      hat(drums, t + beat / 2, 0.6, false, k);
      for (let q = 0; q < 2; q++)
        pluck(music, t + (q * beat) / 2, chord.tones[ARP[(k + q) % 4]] * 2, 0.6, q ? 0.3 : -0.3);
      if (inBar === 0) bass(music, t, beat * 1.5, chord.root * 2, 0.7);
    }
  }
  reverb(music, { mix: 0.35, size: 1.1 });
  let seed = 1;
  for (const e of events) {
    const f = FX[e.name];
    if (f) f(fx, e.at, e.gain ?? 1, seed++, e.len);
  }
  reverb(fx, { mix: 0.18, size: 0.9 });
  return { music, drums, fx };
}
