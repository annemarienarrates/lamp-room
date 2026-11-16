/* The Lamp Room — audio engine.
   Recording: 48 kHz mono, written as 24-bit WAV into the Studio folder while you record (saved every few seconds).
   A chapter's audio is a list of clips on a timeline: { file, off, dur, at } — off/dur within the file, at on the timeline.
   Punching in never edits a file: it trims the timeline at the punch point and records a new clip from there. */
(function () {
  "use strict";
  const RATE = 48000, PEAKS_PER_SEC = 100;

  // ---------------- WAV writing ----------------
  function wavHeader(dataBytes, rate, bits) {
    const b = new ArrayBuffer(44), v = new DataView(b), ch = 1, ba = ch * bits / 8;
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * ba, true); v.setUint16(32, ba, true); v.setUint16(34, bits, true); str(36, "data"); v.setUint32(40, dataBytes, true);
    return new Uint8Array(b);
  }
  function toInt24(f32) {
    const out = new Uint8Array(f32.length * 3);
    for (let i = 0, o = 0; i < f32.length; i++, o += 3) {
      let s = f32[i]; s = s > 1 ? 1 : s < -1 ? -1 : s;
      let v = Math.round(s * 8388607); if (v < 0) v += 16777216;
      out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255;
    }
    return out;
  }

  class WavWriter {
    static async create(dir, name, rate) {
      const w = new WavWriter(); w.dir = dir; w.name = name; w.rate = rate || RATE;
      w.fh = await dir.getFileHandle(name, { create: true });
      w.ws = await w.fh.createWritable();
      await w.ws.write(wavHeader(0, w.rate, 24));
      w.bytes = 0; w.samples = 0; w.chain = Promise.resolve(); w.pending = []; w.lastCheckpoint = Date.now();
      w.mm = []; w._mn = 0; w._mx = 0; w._pkN = 0; w.spp = Math.round(w.rate / PEAKS_PER_SEC);
      return w;
    }
    push(f32) {
      // peaks for the waveform (one byte per 10 ms)
      // min/max per 10 ms, for a true up-and-down waveform
      for (let i = 0; i < f32.length; i++) { const v = f32[i]; if (v < this._mn) this._mn = v; if (v > this._mx) this._mx = v;
        if (++this._pkN >= this.spp) { this.mm.push(Math.max(-127, Math.round(this._mn * 127)), Math.min(127, Math.round(this._mx * 127))); this._mn = 0; this._mx = 0; this._pkN = 0; } }
      this.samples += f32.length;
      this.pending.push(toInt24(f32));
      if (this.pending.reduce((a, b) => a + b.length, 0) > 3 * this.rate) this.flush();   // ~1 s of audio per write
    }
    flush() {
      if (!this.pending.length) return this.chain;
      const parts = this.pending; this.pending = [];
      const n = parts.reduce((a, b) => a + b.length, 0), buf = new Uint8Array(n); let o = 0;
      for (const p of parts) { buf.set(p, o); o += p.length; }
      this.chain = this.chain.then(async () => {
        await this.ws.write(buf); this.bytes += n;
        // checkpoint: closing commits what's written so far, so a crash or a closed tab keeps it
        if (Date.now() - this.lastCheckpoint > 30000) {
          await this.ws.write({ type: "write", position: 0, data: wavHeader(this.bytes, this.rate, 24) });
          await this.ws.close(); this.ws = await this.fh.createWritable({ keepExistingData: true }); await this.ws.seek(44 + this.bytes);
          this.lastCheckpoint = Date.now();
        }
      });
      return this.chain;
    }
    get duration() { return this.samples / this.rate; }
    async close() {
      await this.flush(); await this.chain;
      await this.ws.write({ type: "write", position: 0, data: wavHeader(this.bytes, this.rate, 24) });
      await this.ws.close();
      const pf = await this.dir.getFileHandle(this.name.replace(/\.wav$/, ".peaks2"), { create: true });
      const pw = await pf.createWritable(); await pw.write(new Int8Array(this.mm)); await pw.close();
    }
  }

  // ---------------- WAV reading ----------------
  const headCache = new Map();
  async function wavInfo(file) {
    const key = file.name + "|" + file.size + "|" + file.lastModified;
    if (headCache.has(key)) return headCache.get(key);
    const head = new DataView(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
    let off = 12, info = { rate: RATE, bits: 24, ch: 1, fmt: 1, dataOff: 44, dataLen: Math.max(0, file.size - 44) };
    while (off + 8 <= head.byteLength) {
      const id = String.fromCharCode(head.getUint8(off), head.getUint8(off + 1), head.getUint8(off + 2), head.getUint8(off + 3)), len = head.getUint32(off + 4, true);
      if (id === "fmt ") { info.fmt = head.getUint16(off + 8, true); info.ch = head.getUint16(off + 10, true); info.rate = head.getUint32(off + 12, true); info.bits = head.getUint16(off + 22, true); }
      if (id === "data") { info.dataOff = off + 8; info.dataLen = (len && off + 8 + len <= file.size) ? len : file.size - off - 8; break; }
      off += 8 + len + (len & 1);
    }
    headCache.set(key, info); return info;
  }
  // read `dur` seconds from `start` (seconds) of a WAV file, mono float32
  async function readPCM(file, start, dur) {
    const h = await wavInfo(file), bps = h.bits / 8, frame = bps * h.ch;
    const total = Math.floor(h.dataLen / frame);
    const s0 = Math.max(0, Math.floor(start * h.rate)), n = Math.max(0, Math.min(total - s0, Math.round(dur * h.rate)));
    const out = new Float32Array(Math.max(0, Math.round(dur * h.rate)));
    if (n <= 0) return out;
    const dv = new DataView(await file.slice(h.dataOff + s0 * frame, h.dataOff + (s0 + n) * frame).arrayBuffer());
    for (let i = 0, o = 0; i < n; i++, o += frame) {
      let v;
      if (h.bits === 24) { v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16); v /= 8388608; }
      else if (h.bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (h.bits === 32 && h.fmt === 3) v = dv.getFloat32(o, true);
      else v = dv.getInt32(o, true) / 2147483648;
      out[i] = v;
    }
    return out;
  }

  // ---------------- reading the timeline back ----------------
  // Fades: a clip's own fade-in / fade-out (fi, fo seconds, set with the dots or in Levels), and an 8 ms one at every
  // cut so an edit never clicks — except where a clip simply carries on from the one before it in the same recording.
  const AUTO_FADE = 0.008;
  const fadeCurve = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
  const joins = (p, c) => !!(p && c) && p.file === c.file && Math.abs(p.at + p.dur - c.at) < 0.002 && Math.abs(p.off + p.dur - c.off) < 0.002;
  async function renderRange(dir, clips, from, dur) {
    const out = new Float32Array(Math.round(dur * RATE)), sorted = clips.slice().sort((x, y) => x.at - y.at);
    for (let ci = 0; ci < sorted.length; ci++) {
      const c = sorted[ci];
      const a = Math.max(from, c.at), b = Math.min(from + dur, c.at + c.dur);
      if (b <= a) continue;
      const f = await (await dir.getFileHandle(c.file)).getFile();
      const pcm = await readPCM(f, c.off + (a - c.at), b - a);
      const g = c.g ? Math.pow(10, c.g / 20) : 1;
      let fi = Math.max(c.fi || 0, joins(sorted[ci - 1], c) ? 0 : AUTO_FADE), fo = Math.max(c.fo || 0, joins(c, sorted[ci + 1]) ? 0 : AUTO_FADE);
      if (fi + fo > c.dur) { const k = c.dur / (fi + fo); fi *= k; fo *= k; }
      const p0 = a - c.at, n = pcm.length;
      if (g !== 1 || (fi > 0 && p0 < fi) || (fo > 0 && c.dur - (p0 + n / RATE) < fo)) {
        for (let i = 0; i < n; i++) {
          const p = p0 + i / RATE; let m = g;
          if (fi > 0 && p < fi) m *= fadeCurve(p / fi);
          const q = c.dur - p; if (fo > 0 && q < fo) m *= fadeCurve(q / fo);
          pcm[i] *= m;
        }
      }
      const o = Math.round((a - from) * RATE);
      const src = pcm.subarray(0, Math.min(pcm.length, out.length - o));
      for (let i = 0; i < src.length; i++) out[o + i] += src[i];         // add: overlapping fades cross-fade
    }
    return out;
  }
  // Room tone: a short recording of the room, looped seamlessly, fills every stretch where no track has a clip
  // (between takes, added space, the chapter's tail), so a gap never drops to dead digital silence.
  function loopTone(x) {
    const X = Math.min(Math.round(RATE * 0.25), Math.floor(x.length / 3)), n = x.length - X, out = new Float32Array(n);
    out.set(x.subarray(0, n));
    for (let i = 0; i < X; i++) { const w = i / X; out[i] = x[n + i] * (1 - w) + x[i] * w; }   // the end flows into the start
    return out;
  }
  function fillTone(out, from, cover, tone, endT) {
    if (!tone || !tone.length) return;
    const n = out.length, R = RATE, XF = Math.round(R * 0.02), mask = new Uint8Array(n);
    for (const [a, b] of cover) { const i0 = Math.max(0, Math.round((a - from) * R)), i1 = Math.min(n, Math.round((b - from) * R)); for (let i = i0; i < i1; i++) mask[i] = 1; }
    const last = Math.min(n, Math.round((endT - from) * R)); if (last <= 0) return;
    // distance (in samples) to the nearest covered sample, both ways, capped at the crossfade length
    const dist = new Uint16Array(last); let d = XF;
    for (let i = 0; i < last; i++) { d = mask[i] ? 0 : Math.min(XF, d + 1); dist[i] = d; }
    d = XF; for (let i = last - 1; i >= 0; i--) { d = mask[i] ? 0 : Math.min(XF, d + 1); if (d < dist[i]) dist[i] = d; }
    const base = Math.round(from * R), L = tone.length;
    for (let i = 0; i < last; i++) { if (mask[i]) continue; const v = tone[(((base + i) % L) + L) % L]; out[i] += dist[i] >= XF ? v : v * dist[i] / XF; }
  }

  // quietest 20 ms point in [t - before, t + after] — where a punch should land so it doesn't clip a word
  // `render(from, dur)` → mono float32 of the (mixed) chapter
  async function quietPoint(render, t, before, after) {
    const from = Math.max(0, t - before), dur = before + after;
    const x = await render(from, dur), win = Math.round(RATE * 0.02);
    let best = t, bestE = Infinity;
    for (let i = 0; i + win <= x.length; i += win / 2) {
      let e = 0; for (let k = i; k < i + win; k++) e += x[k] * x[k];
      const tt = from + (i + win / 2) / RATE;
      const bias = 1 + Math.abs(tt - t) * 0.6;                 // prefer close to the target
      if (e * bias < bestE) { bestE = e * bias; best = tt; }
    }
    return best;
  }
  // most recent pause (≥ minGap s of quiet) that ends at least `lead` s before t — fallback for the flub key
  async function lastPause(render, t, lead, minGap) {
    const span = Math.min(t, 20), from = t - span;
    const x = await render(from, span), win = Math.round(RATE * 0.02), n = Math.floor(x.length / win);
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) { let e = 0; for (let k = i * win; k < (i + 1) * win; k++) e += x[k] * x[k]; rms[i] = Math.sqrt(e / win); }
    const sorted = Array.from(rms).sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.1)] || 0, thr = Math.max(floor * 3, 0.004);
    const need = Math.round(minGap / 0.02);
    let run = 0;
    for (let i = n - 1 - Math.round(lead / 0.02); i >= 0; i--) {
      if (rms[i] < thr) { run++; if (run >= need) return from + (i + run / 2) * 0.02; } else run = 0;
    }
    return Math.max(0, t - lead - 2);
  }

  // ---------------- playback ----------------
  class Player {
    constructor() { this.ctx = null; this.playing = false; }
    // render(from, dur) → mono float32 at 48 kHz
    async play(render, from, to, opts) {
      this.stop();
      const ctx = this.ctx = new AudioContext({ sampleRate: RATE });
      const me = this.token = {}; this.playing = true; this.from = from; this.to = to; this.t0 = null;
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      let pos = from, t0 = null; const CH = 3;
      while (pos < to && this.token === me) {
        const d = Math.min(CH, to - pos);
        const pcm = await render(pos, d);
        if (this.token !== me) return;
        // the clock starts once the first chunk is in hand; if a later chunk is late, slide the clock rather than
        // start it on top of the one still playing (that overlap is what sounds choppy)
        if (t0 == null) { t0 = this.t0 = ctx.currentTime + 0.15; }
        else if (t0 + (pos - from) < ctx.currentTime + 0.03) { t0 = this.t0 = ctx.currentTime + 0.08 - (pos - from); }
        const buf = ctx.createBuffer(1, pcm.length || 1, RATE); buf.copyToChannel(pcm, 0);
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
        src.start(t0 + (pos - from));
        pos += d;
        while (this.token === me && (t0 + (pos - from)) - ctx.currentTime > 6) await new Promise(r => setTimeout(r, 200));
      }
      while (this.token === me && t0 != null && ctx.currentTime < t0 + (to - from)) await new Promise(r => setTimeout(r, 50));
      if (this.token === me) { this.stop(); opts && opts.onEnd && opts.onEnd(); }
    }
    get time() { return this.playing && this.ctx && this.t0 != null ? Math.min(this.to, this.from + Math.max(0, this.ctx.currentTime - this.t0)) : null; }
    stop() { this.token = null; this.playing = false; if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; } }
  }

  // ---------------- microphone ----------------
  // Capture, the way Finished Hour settled on after the same trouble:
  //  1. "direct": read the microphone's own frames (MediaStreamTrackProcessor). No AudioContext, so no output-device
  //     clock to drift against, and nothing for Chrome's speech recognition (follow-along, which opens the mic too) to
  //     disturb. Lost frames are spotted from the timestamps, filled with silence so timing stays true, and reported.
  //  2. "worklet" fallback: an AudioContext with big, steady buffers ("playback" latency).
  // Either way the microphone runs raw: no echo cancelling, noise suppression or auto-gain.
  const WORKLET = `class LRCap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(4096);this.n=0;this.port.onmessage=()=>{if(this.n){this.port.postMessage(this.b.slice(0,this.n));this.n=0}}}process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===4096){this.port.postMessage(this.b.slice(0));this.n=0}}}return true}}registerProcessor('lr-cap',LRCap);`;
  // a stand-in for an AnalyserNode, fed from the captured frames (the Booth's glowing voice line reads it)
  class Scope {
    constructor(n) { this.fftSize = n; this.ring = new Float32Array(n); this.w = 0; }
    push(f) { const r = this.ring, n = r.length; for (let i = Math.max(0, f.length - n); i < f.length; i++) { r[this.w] = f[i]; this.w = (this.w + 1) % n; } }
    getFloatTimeDomainData(out) { const r = this.ring, n = r.length; for (let i = 0; i < out.length && i < n; i++) out[i] = r[(this.w + i) % n]; }
  }
  class Mic {
    constructor() { this.ctx = null; this.stream = null; this.onFrames = null; this.onDrop = null; this.level = -90; this.peakHold = -90; this.clip = false; this.mode = ""; this.devRate = 0; this.drops = 0; }
    static async devices() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); } catch (e) { return []; } }
    get isOpen() { return !!this.stream; }
    async open(deviceId) {
      if (this.stream && this.deviceId === deviceId && this.stream.getAudioTracks().some(t => t.readyState === "live")) return;
      this.close();
      this.deviceId = deviceId;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, sampleRate: { ideal: RATE },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false } });   // raw audio: no phone-call processing
      const track = this.stream.getAudioTracks()[0], set = (track.getSettings && track.getSettings()) || {};
      this.devRate = set.sampleRate || 0; this.drops = 0; this.lastDropMs = 0;
      this.analyser = new Scope(1024);
      const me = this.token = {};
      const handle = f32 => {
        if (this.token !== me || !this.analyser) return;               // frames still arriving after the mic was closed
        let pk = 0; for (let i = 0; i < f32.length; i++) { const a = f32[i] < 0 ? -f32[i] : f32[i]; if (a > pk) pk = a; }
        const db = pk > 0 ? 20 * Math.log10(pk) : -90;
        this.level = db; if (db > this.peakHold) this.peakHold = db; if (pk >= 0.999) this.clip = true;
        this.analyser.push(f32);
        if (this.onFrames) this.onFrames(f32);
      };
      track.addEventListener("mute", () => { if (this.token === me) this.dropped(0, "the browser or macOS paused the microphone"); });
      if (typeof window.MediaStreamTrackProcessor === "function" && (!this.devRate || this.devRate === RATE || window.LR_FORCE_DIRECT)) {
        this.mode = "direct";
        const reader = this.reader = new window.MediaStreamTrackProcessor({ track, maxBufferSize: 200 }).readable.getReader();
        (async () => {
          const buf = new Float32Array(8192); let pos = 0, lastEnd = null;
          try {
            for (;;) {
              const { value, done } = await reader.read(); if (done || this.token !== me) { if (value) value.close(); break; }
              try {
                const n = value.numberOfFrames, sr = value.sampleRate, f = new Float32Array(n);
                if (sr !== RATE && !this.warnedRate) { this.warnedRate = true; console.warn("mic frames at", sr); }
                value.copyTo(f, { planeIndex: 0, format: "f32-planar" });
                const ts = value.timestamp;                                 // microseconds
                if (lastEnd != null && ts - lastEnd > 80000) {             // frames went missing: keep time honest
                  const miss = Math.min(Math.round((ts - lastEnd) / 1e6 * RATE), RATE * 2);
                  if (pos) { handle(buf.slice(0, pos)); pos = 0; }
                  handle(new Float32Array(miss)); this.dropped(Math.round((ts - lastEnd) / 1000));
                }
                lastEnd = ts + n / sr * 1e6;
                if (pos + n > buf.length) { handle(buf.slice(0, pos)); pos = 0; }
                buf.set(f, pos); pos += n;
                if (pos >= 2048) { handle(buf.slice(0, pos)); pos = 0; }
              } finally { value.close(); }
            }
          } catch (e) { if (this.token === me) console.warn("mic reader", e); }
          if (pos && this.token === me) handle(buf.slice(0, pos));
        })();
      } else {
        this.mode = "worklet";
        const ctx = this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: "playback" });
        const src = ctx.createMediaStreamSource(this.stream);
        const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
        try {
          const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
          await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
          const node = this.node = new AudioWorkletNode(ctx, "lr-cap"); node.port.onmessage = e => handle(e.data);
          src.connect(node); node.connect(sink);
        } catch (e) {
          this.mode = "script";
          const sp = ctx.createScriptProcessor(16384, 1, 1); sp.onaudioprocess = ev => handle(new Float32Array(ev.inputBuffer.getChannelData(0)));
          src.connect(sp); sp.connect(sink);
        }
        if (ctx.state === "suspended") await ctx.resume();
      }
    }
    dropped(ms, why) { this.drops++; if (this.onDrop) this.onDrop(ms, why || (ms + " ms of microphone audio was lost")); }
    // hand over any frames still waiting in the capture buffer (call before stopping a take)
    async flush() { if (this.node && this.node.port) { this.node.port.postMessage("flush"); await new Promise(r => setTimeout(r, 120)); } else await new Promise(r => setTimeout(r, 60)); }
    get label() { const t = this.stream && this.stream.getAudioTracks()[0]; return t ? t.label : ""; }
    get info() { return { mode: this.mode, rate: this.devRate, drops: this.drops }; }
    close() { this.token = null; try { if (this.reader) this.reader.cancel().catch(() => {}); } catch (e) {} this.reader = null; if (this.stream) this.stream.getTracks().forEach(t => t.stop()); if (this.ctx) this.ctx.close().catch(() => {}); this.stream = null; this.ctx = null; this.node = null; this.onFrames = null; this.analyser = null; }
  }

  // { mm: Int8Array of min,max pairs } for new takes; older takes have { abs: Uint8Array }
  async function loadPeaks(dir, clip) {
    try { const f = await (await dir.getFileHandle(clip.file.replace(/\.wav$/, ".peaks2"))).getFile(); return { mm: new Int8Array(await f.arrayBuffer()) }; } catch (e) {}
    try { const f = await (await dir.getFileHandle(clip.file.replace(/\.wav$/, ".peaks"))).getFile(); return { abs: new Uint8Array(await f.arrayBuffer()) }; } catch (e) { return null; }
  }

  // mix(dir, audio, trackSet) → render(from, dur): audible tracks, each through its live chain, summed at their volumes.
  // Chains keep their state between calls that follow on from each other (playback, export); a jump starts them afresh
  // with a short run-in so the filters have settled by the first sample you hear.
  function mixer(dir, audio, trackSet, opts) {
    const chains = [], bypass = opts && opts.bypass, tone = opts && opts.tone; let lastEnd = null;
    const RUNIN = 0.25;
    return async (from, dur) => {
      const out = new Float32Array(Math.round(dur * RATE));
      const tracks = audio.tracks || [], set = trackSet || [], solo = set.some((t, i) => t && t.solo && tracks[i]);
      const fresh = lastEnd == null || Math.abs(from - lastEnd) > 1e-3; lastEnd = from + dur;
      for (let i = 0; i < tracks.length; i++) {
        const st = set[i] || {}; if (st.mute || (solo && !st.solo) || !tracks[i].clips.length) continue;
        const g = Math.pow(10, (st.vol || 0) / 20), cfg = !bypass && window.LRFx ? LRFx.chainOf(st) : null;
        let x;
        if (cfg && LRFx.chainActive(cfg)) {
          if (fresh || !chains[i]) {
            chains[i] = new LRFx.Chain(cfg, RATE);
            const ri = Math.min(RUNIN, from); if (ri > 0.01) chains[i].process(await renderRange(dir, tracks[i].clips, from - ri, ri));
          }
          x = chains[i].process(await renderRange(dir, tracks[i].clips, from, dur));
        } else x = await renderRange(dir, tracks[i].clips, from, dur);
        for (let k = 0; k < out.length && k < x.length; k++) out[k] += x[k] * g;
      }
      if (tone) {   // room tone under every stretch no audible track covers, up to the chapter's end (its tail included)
        const cover = []; tracks.forEach((tr, i) => { const st = set[i] || {}; if (st.mute || (solo && !st.solo)) return; for (const c of tr.clips) if (c.at < from + dur && c.at + c.dur > from) cover.push([c.at, c.at + c.dur]); });
        const endT = opts.end != null ? opts.end : tracks.reduce((m, tr) => tr.clips.reduce((mm, c) => Math.max(mm, c.at + c.dur), m), 0) + (audio.pad || 0);
        fillTone(out, from, cover, tone, endT);
      }
      return out;
    };
  }

  window.LRAudio = { mixer, loopTone, fadeCurve, AUTO_FADE, RATE, PEAKS_PER_SEC, WavWriter, readPCM, wavInfo, renderRange, quietPoint, lastPause, Player, Mic, loadPeaks };
})();
