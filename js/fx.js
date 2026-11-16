/* The Lamp Room — effects.
   Two kinds, the way Finished Hour split them:
   · Track chain (live): high-pass, tone EQ, de-esser, compressor, limiter. Runs as the track plays and exports; files are never touched.
   · Creative effects: pitch, doubler, reverb, echo, chorus, robot, filter. Applied to a passage (a new file is written and
     placed over the old audio, so Undo brings the original back), previewed first, or armed on a track so every new take
     recorded there is processed when you press Stop. */
(function () {
  "use strict";
  const pause = () => new Promise(r => setTimeout(r, 0));
  const dbToG = db => Math.pow(10, db / 20);

  // ---------------- biquads (RBJ cookbook) ----------------
  function coef(type, f, rate, Q, gainDb) {
    const w = 2 * Math.PI * Math.min(f, rate * 0.45) / rate, c = Math.cos(w), s = Math.sin(w), al = s / (2 * (Q || 0.7071)), A = Math.pow(10, (gainDb || 0) / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case "hp": b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case "lp": b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case "bp": b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
      case "peak": b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
      case "lowshelf": { const k = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * c + k); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - k); a0 = (A + 1) + (A - 1) * c + k; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - k; break; }
      default: { const k = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * c + k); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - k); a0 = (A + 1) - (A - 1) * c + k; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - k; }
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  // one sample through a biquad (direct form I, keeps its own state so a chain can run in pieces)
  const bq = (k, x) => { const y = k.b0 * x + k.b1 * k.x1 + k.b2 * k.x2 - k.a1 * k.y1 - k.a2 * k.y2; k.x2 = k.x1; k.x1 = x; k.y2 = k.y1; k.y1 = y; return y; };
  function filterAll(x, k) { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = bq(k, x[i]); return y; }

  // ---------------- track chain ----------------
  const CHAIN_DEFAULT = () => ({ on: false,
    hpf: { on: true, f: 80 }, eq: { on: false, lo: 0, mud: 0, mid: 0, hi: 0 }, ds: { on: false, amt: 0.4 },
    comp: { on: false, thr: -22, ratio: 2.5, att: 10, rel: 150, mk: 2 }, lim: { on: true, ceil: -3.2 } });
  const CHAIN_VOICE = () => ({ on: true,
    hpf: { on: true, f: 80 }, eq: { on: true, lo: 0.5, mud: -1.5, mid: 1.5, hi: 1 }, ds: { on: true, amt: 0.35 },
    comp: { on: true, thr: -24, ratio: 2.5, att: 10, rel: 160, mk: 3 }, lim: { on: true, ceil: -3.2 } });
  function chainOf(st) {
    const d = CHAIN_DEFAULT(), f = (st && st.chain) || {};
    for (const k in d) if (typeof d[k] === "object") d[k] = Object.assign(d[k], f[k] || {}); else if (f[k] != null) d[k] = f[k];
    return d;
  }
  const chainActive = c => c && c.on && ["hpf", "eq", "ds", "comp", "lim"].some(k => c[k].on);

  // A running chain: process(x) works in place and remembers its state, so playback and export can feed it piece by piece.
  function Chain(cfg, rate) {
    const c = cfg, hp = c.hpf.on ? [coef("hp", c.hpf.f, rate, 0.5412), coef("hp", c.hpf.f, rate, 1.3066)] : [];
    const eq = c.eq.on ? [coef("lowshelf", 140, rate, 0.7, c.eq.lo), coef("peak", 300, rate, 1.1, c.eq.mud), coef("peak", 3200, rate, 0.9, c.eq.mid), coef("highshelf", 9500, rate, 0.7, c.eq.hi)].filter((_, i) => [c.eq.lo, c.eq.mud, c.eq.mid, c.eq.hi][i]) : [];
    const dsLp = coef("lp", 5200, rate, 0.7071), dsDet = coef("bp", 7000, rate, 1.2);
    let dsEnv = 0, vEnv = 0;
    const dsA = Math.exp(-1 / (rate * 0.001)), dsR = Math.exp(-1 / (rate * 0.06)), dsAmt = c.ds.amt;
    let cEnv = -120; const cA = Math.exp(-1 / (rate * c.comp.att / 1000)), cR = Math.exp(-1 / (rate * c.comp.rel / 1000)), knee = 6, mk = dbToG(c.comp.mk);
    const LA = Math.round(rate * 0.0015), ring = new Float32Array(LA + 1); let rp = 0, lg = 1;
    const ceil = dbToG(c.lim.ceil), lR = Math.exp(-1 / (rate * 0.08));
    this.process = x => {
      for (let i = 0; i < x.length; i++) {
        let v = x[i];
        for (const k of hp) v = bq(k, v);
        for (const k of eq) v = bq(k, v);
        if (c.ds.on && dsAmt > 0) {                     // de-esser: when the "s" band jumps above the voice, turn the top end down
          const lo = bq(dsLp, v), hi = v - lo, det = Math.abs(bq(dsDet, v)), av = Math.abs(v);
          dsEnv = det > dsEnv ? dsA * dsEnv + (1 - dsA) * det : dsR * dsEnv + (1 - dsR) * det;
          vEnv = av > vEnv ? dsA * vEnv + (1 - dsA) * av : dsR * vEnv + (1 - dsR) * av;
          const ratio = dsEnv / (vEnv + 1e-6), over = Math.max(0, ratio - 0.35);
          const g = 1 / (1 + over * 6 * dsAmt);
          v = lo + hi * g;
        }
        if (c.comp.on) {                                // compressor: soft knee, feed-forward
          const lvl = 20 * Math.log10(Math.abs(v) + 1e-9);
          cEnv = lvl > cEnv ? cA * cEnv + (1 - cA) * lvl : cR * cEnv + (1 - cR) * lvl;
          const o = cEnv - c.comp.thr; let red = 0;
          if (o > knee / 2) red = o * (1 - 1 / c.comp.ratio); else if (o > -knee / 2) red = (1 - 1 / c.comp.ratio) * (o + knee / 2) * (o + knee / 2) / (2 * knee);
          v *= dbToG(-red) * mk;
        }
        if (c.lim.on) {                                 // look-ahead peak limiter (1.5 ms)
          ring[rp] = v; rp = (rp + 1) % ring.length;
          let pk = 0; for (let k = 0; k < ring.length; k++) { const a = Math.abs(ring[k]); if (a > pk) pk = a; }
          const want = pk > ceil ? ceil / pk : 1;
          lg = want < lg ? want : lR * lg + (1 - lR) * want;
          v = ring[rp] * lg;                              // the oldest sample, delayed by the look-ahead
        }
        x[i] = v;
      }
      return x;
    };
  }

  // ---------------- creative effects ----------------
  const interp = (a, p) => { const i = Math.floor(p), f = p - i, g = k => (k >= 0 && k < a.length ? a[k] : 0), y0 = g(i - 1), y1 = g(i), y2 = g(i + 1), y3 = g(i + 2);
    return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0))); };

  // pitch without changing speed: stretch time by the pitch ratio with overlap-add (each grain lined up with the previous one
  // by cross-correlation so the voice doesn't warble), then resample back to the original length.
  async function pitch(x, rate, semis, prog) {
    const r = Math.pow(2, semis / 12); if (Math.abs(semis) < 0.01) return x.slice();
    const n = x.length, G = Math.round(rate * 0.03) & ~1, hop = G / 2, search = Math.round(G / 3), win = new Float32Array(G);
    for (let i = 0; i < G; i++) win[i] = Math.sin(Math.PI * i / G) ** 2;
    const outN = Math.ceil(n * r) + G * 2, out = new Float32Array(outN), norm = new Float32Array(outN);
    let src = 0, k = 0;
    for (let o = 0; o < outN - G; o += hop, k++) {
      let s = Math.round(o / r);
      if (k > 0) {                                     // find the grain that best continues the last one
        const want = src + hop, lo = Math.max(0, s - search), hi = Math.min(n - G - 1, s + search);
        if (hi > lo && want + hop < n) {
          let best = -Infinity, at = s;
          for (let c = lo; c <= hi; c += 2) { let acc = 0; for (let j = 0; j < hop; j += 3) acc += x[c + j] * x[want + j]; if (acc > best) { best = acc; at = c; } }
          s = at;
        }
      }
      s = Math.max(0, Math.min(s, Math.max(0, n - G))); src = s;
      for (let i = 0; i < G; i++) { const v = s + i < n ? x[s + i] : 0; out[o + i] += v * win[i]; norm[o + i] += win[i]; }
      if ((k & 511) === 511) { prog && prog(o / outN); await pause(); }
    }
    for (let i = 0; i < outN; i++) if (norm[i] > 1e-3) out[i] /= norm[i];
    const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = interp(out, i * r);
    return y;
  }
  async function doubler(x, rate, p, prog) {
    const n = x.length, tail = Math.ceil(rate * 0.1), mix = p.mix / 100;
    const layer = Math.abs(p.layer) > 0.01 ? await pitch(x, rate, p.layer, q => prog && prog(q * 0.6)) : x;
    const y = new Float32Array(n + tail), depth = rate * 0.001 * (0.3 + 2.5 * p.spread / 100);
    for (let i = 0; i < n; i++) y[i] = x[i] * (1 - 0.25 * mix);
    const voices = [[p.delay, 0.31, 0.7, 1], [p.delay * 1.6, 0.19, 3.3, 0.8]];
    for (const [d, hz, ph, g] of voices) {
      const d0 = d * rate / 1000, w = 2 * Math.PI * hz / rate, gg = mix * 0.5 * g;
      for (let i = 0; i < n + tail; i++) { const pos = i - d0 - depth * (0.7 * Math.sin(w * i + ph) + 0.3 * Math.sin(2.7 * w * i + ph * 1.7)); if (pos > -2 && pos < n) y[i] += gg * interp(layer, pos); }
      await pause();
    }
    return y;
  }
  function impulse(rate, decay, damp, preMs) {
    const pre = Math.round(rate * preMs / 1000), len = Math.max(128, Math.round(rate * decay * 1.1)), ir = new Float32Array(pre + len);
    let seed = 0x9e3779b9, lp = 0; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1, a = 1 - 0.9 * damp;
    for (let i = 0; i < len; i++) { const t = i / rate; lp += (rnd() - lp) * Math.max(0.05, a * Math.exp(-t * damp * 3)); ir[pre + i] = lp * Math.exp(-6.9 * t / decay) * Math.min(1, t / 0.02 + 0.2); }
    [5, 11, 17, 23, 31, 43, 59].forEach((ms, j) => { const k = pre + Math.round(rate * ms / 1000); if (k < ir.length) ir[k] += (j % 2 ? -0.4 : 0.5) * (1 - j * 0.08); });
    let e = 0; for (const v of ir) e += v * v; const s = 1 / Math.sqrt(e || 1); for (let i = 0; i < ir.length; i++) ir[i] *= s;
    return ir;
  }
  async function reverb(x, rate, p, prog) {
    const ir = impulse(rate, p.decay, p.damp / 100, p.pre), n = x.length, tail = Math.min(ir.length, rate * 6), wet = new Float32Array(n + tail), mix = p.mix / 100, B = rate * 20;
    const irb = new AudioBuffer({ length: ir.length, sampleRate: rate, numberOfChannels: 1 }); irb.copyToChannel(ir, 0);
    for (let o = 0; o < n; o += B) {
      const m = Math.min(B, n - o), ctx = new OfflineAudioContext(1, m + ir.length, rate), sb = new AudioBuffer({ length: m, sampleRate: rate, numberOfChannels: 1 });
      sb.copyToChannel(x.subarray(o, o + m), 0);
      const s = ctx.createBufferSource(), cv = ctx.createConvolver(); cv.normalize = false; cv.buffer = irb; s.buffer = sb; s.connect(cv); cv.connect(ctx.destination); s.start();
      const r = (await ctx.startRendering()).getChannelData(0), lim = Math.min(r.length, wet.length - o); for (let i = 0; i < lim; i++) wet[o + i] += r[i];
      prog && prog((o + m) / n);
    }
    const y = new Float32Array(n + tail); for (let i = 0; i < y.length; i++) y[i] = (i < n ? x[i] * (1 - 0.5 * mix) : 0) + wet[i] * mix * 0.6;
    return y;
  }
  async function echo(x, rate, p) {
    const n = x.length, D = Math.max(1, Math.round(rate * p.time / 1000)), fb = Math.min(0.85, p.fb / 100), mix = p.mix / 100;
    const reps = Math.min(14, Math.ceil(Math.log(0.002) / Math.log(Math.max(0.05, fb)))), tail = Math.min(D * reps, rate * 6), y = new Float32Array(n + tail), e = new Float32Array(n + tail);
    const damp = coef("lp", 4500, rate, 0.7);
    for (let i = 0; i < n; i++) y[i] = x[i];
    for (let i = D; i < n + tail; i++) { e[i] = bq(damp, (i - D < n ? x[i - D] : 0) + fb * e[i - D]); y[i] += mix * e[i]; }
    await pause(); return y;
  }
  async function chorus(x, rate, p) {
    const n = x.length, tail = Math.ceil(rate * 0.05), mix = p.mix / 100, depth = rate * 0.001 * (0.8 + 5 * p.depth / 100), y = new Float32Array(n + tail);
    for (let i = 0; i < n; i++) y[i] = x[i] * (1 - 0.3 * mix);
    for (const [d, hz, ph] of [[16, 0.45, 0], [23, 0.62, 2.2], [30, 0.83, 4.4]]) {
      const d0 = d * rate / 1000, w = 2 * Math.PI * hz * p.speed / rate;
      for (let i = 0; i < n + tail; i++) { const pos = i - d0 - depth * Math.sin(w * i + ph); if (pos > -2 && pos < n) y[i] += mix * 0.5 * interp(x, pos); }
      await pause();
    }
    return y;
  }
  async function robot(x, rate, p) {
    const n = x.length, mix = p.mix / 100, w = 2 * Math.PI * p.freq / rate, y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] * (1 - mix) + mix * 1.5 * x[i] * Math.sin(w * i);
    return y;
  }
  const PLACES = { phone: ["Telephone", 320, 3300, 1.4], walkie: ["Walkie-talkie", 500, 2700, 3.5], megaphone: ["Megaphone", 650, 4000, 4.5], radio: ["Old radio", 280, 4200, 1.8],
    intercom: ["Intercom", 420, 3100, 2.2], wall: ["Muffled / through a wall", 0, 600, 0], tiny: ["Tiny speaker", 650, 6500, 1.5] };
  async function place(x, rate, p) {
    const f = PLACES[p.type] || PLACES.phone, n = x.length, mix = p.mix / 100; let y = x;
    if (f[1]) { y = filterAll(y, coef("hp", f[1], rate, 0.7071)); y = filterAll(y, coef("hp", f[1], rate, 0.7071)); }
    y = filterAll(y, coef("lp", f[2], rate, 0.7071)); y = filterAll(y, coef("lp", f[2], rate, 0.7071));
    if (f[3]) { const t = Math.tanh(f[3]); for (let i = 0; i < n; i++) y[i] = Math.tanh(y[i] * f[3]) / t; }
    let ei = 0, eo = 0; for (let i = 0; i < n; i++) { ei += x[i] * x[i]; eo += y[i] * y[i]; }
    const g = Math.min(4, Math.sqrt((ei + 1e-12) / (eo + 1e-12))), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = x[i] * (1 - mix) + y[i] * g * mix;
    return out;
  }

  // settings, presets and the order they're shown in
  const KINDS = {
    pitch: { name: "Pitch shift", note: "Deeper or higher, same speed", def: { semis: -3, cents: 0 },
      ctl: [["semis", "Semitones", -12, 12, 1, " st"], ["cents", "Fine tune", -50, 50, 1, " ¢"]],
      presets: { Deeper: { semis: -2, cents: 0 }, "Much deeper": { semis: -5, cents: 0 }, Demon: { semis: -8, cents: 0 }, Higher: { semis: 2, cents: 0 }, Child: { semis: 6, cents: 0 } },
      run: (x, r, p, pr) => pitch(x, r, p.semis + p.cents / 100, pr), sum: p => (p.semis > 0 ? "+" : "") + p.semis + " st" + (p.cents ? " " + p.cents + "¢" : "") },
    double: { name: "Voice doubler", note: "Thicken or layer the voice", def: { mix: 55, spread: 50, delay: 26, layer: 0 },
      ctl: [["mix", "Mix", 0, 100, 1, "%"], ["spread", "Spread", 0, 100, 1, "%"], ["delay", "Delay", 8, 60, 1, " ms"], ["layer", "Layer pitch", -12, 12, 1, " st"]],
      presets: { "Natural double": { mix: 45, spread: 40, delay: 22, layer: 0 }, "Monster layer": { mix: 70, spread: 55, delay: 18, layer: -12 }, Ghostly: { mix: 65, spread: 90, delay: 45, layer: 5 } },
      run: doubler, sum: p => p.mix + "%" + (p.layer ? " · layer " + p.layer + " st" : "") },
    reverb: { name: "Reverb", note: "Room, hall or cathedral space", def: { decay: 0.9, damp: 55, pre: 12, mix: 25 },
      ctl: [["decay", "Decay", 0.2, 6, 0.1, " s"], ["damp", "Damping", 0, 100, 1, "%"], ["pre", "Pre-delay", 0, 80, 1, " ms"], ["mix", "Mix", 0, 100, 1, "%"]],
      presets: { Closet: { decay: 0.3, damp: 75, pre: 4, mix: 20 }, Room: { decay: 0.8, damp: 55, pre: 10, mix: 24 }, Booth: { decay: 0.45, damp: 80, pre: 3, mix: 14 }, Hall: { decay: 2.3, damp: 40, pre: 24, mix: 30 },
        Cathedral: { decay: 4.6, damp: 30, pre: 38, mix: 36 }, Cave: { decay: 3.3, damp: 18, pre: 30, mix: 42 } },
      run: reverb, sum: p => p.decay + " s · " + p.mix + "%" },
    echo: { name: "Echo", note: "Repeats that fade away", def: { time: 340, fb: 35, mix: 30 },
      ctl: [["time", "Time", 60, 1000, 10, " ms"], ["fb", "Repeats", 0, 80, 1, "%"], ["mix", "Mix", 0, 100, 1, "%"]],
      presets: { Slapback: { time: 110, fb: 10, mix: 28 }, Canyon: { time: 620, fb: 45, mix: 34 }, "Inner voice": { time: 190, fb: 30, mix: 40 } },
      run: echo, sum: p => p.time + " ms · " + p.mix + "%" },
    chorus: { name: "Chorus", note: "Thicken with gentle movement", def: { depth: 45, speed: 1, mix: 50 },
      ctl: [["depth", "Depth", 0, 100, 1, "%"], ["speed", "Speed", 0.3, 3, 0.1, "×"], ["mix", "Mix", 0, 100, 1, "%"]],
      presets: { Shimmer: { depth: 30, speed: 1.6, mix: 45 }, Hive: { depth: 80, speed: 2.4, mix: 65 } },
      run: chorus, sum: p => p.depth + "% · " + p.mix + "%" },
    robot: { name: "Robot voice", note: "Metallic buzz", def: { freq: 50, mix: 70 },
      ctl: [["freq", "Buzz pitch", 20, 300, 5, " Hz"], ["mix", "Mix", 0, 100, 1, "%"]],
      presets: { Android: { freq: 40, mix: 60 }, Dalek: { freq: 30, mix: 100 }, Glitch: { freq: 180, mix: 55 } },
      run: robot, sum: p => p.freq + " Hz · " + p.mix + "%" },
    place: { name: "Phone / radio / muffled", note: "Make it sound like another place", def: { type: "phone", mix: 100 },
      ctl: [["type", "Type", PLACES], ["mix", "Mix", 0, 100, 1, "%"]],
      presets: {}, run: place, sum: p => (PLACES[p.type] || PLACES.phone)[0] }
  };
  // run one effect, or an armed list of them in order
  async function run(kind, x, rate, p, prog) { const K = KINDS[kind]; return K ? K.run(x, rate, Object.assign({}, K.def, p), prog) : x; }
  async function runList(list, x, rate, prog) {
    let y = x;
    for (let i = 0; i < list.length; i++) y = await run(list[i].k, y, rate, list[i].p, q => prog && prog((i + q) / list.length));
    return y;
  }
  // how far past the end a passage can ring on (reverb and echo tails)
  const tailOf = list => list.reduce((m, e) => Math.max(m, e.k === "reverb" ? Math.min(6, (e.p.decay || 1) * 1.1 + (e.p.pre || 0) / 1000) : e.k === "echo" ? 4 : e.k === "double" || e.k === "chorus" ? 0.1 : 0), 0);

  window.LRFx = { KINDS, PLACES, run, runList, tailOf, Chain, chainOf, chainActive, CHAIN_DEFAULT, CHAIN_VOICE, coef, bq };
})();
