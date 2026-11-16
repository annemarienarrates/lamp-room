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
        if (Date.now() - this.lastCheckpoint > 5000) {
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
  async function renderRange(dir, clips, from, dur) {
    const out = new Float32Array(Math.round(dur * RATE));
    for (const c of clips) {
      const a = Math.max(from, c.at), b = Math.min(from + dur, c.at + c.dur);
      if (b <= a) continue;
      const f = await (await dir.getFileHandle(c.file)).getFile();
      const pcm = await readPCM(f, c.off + (a - c.at), b - a);
      if (c.g) { const g = Math.pow(10, c.g / 20); for (let i = 0; i < pcm.length; i++) pcm[i] *= g; }      // clip gain (dB), from Levels
      out.set(pcm.subarray(0, Math.min(pcm.length, out.length - Math.round((a - from) * RATE))), Math.round((a - from) * RATE));
    }
    return out;
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
      const me = this.token = {}; this.playing = true; this.from = from; this.to = to;
      const t0 = ctx.currentTime + 0.12; this.t0 = t0;
      let pos = from; const CH = 3;
      while (pos < to && this.token === me) {
        const d = Math.min(CH, to - pos);
        const pcm = await render(pos, d);
        if (this.token !== me) return;
        const buf = ctx.createBuffer(1, pcm.length || 1, RATE); buf.copyToChannel(pcm, 0);
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
        src.start(t0 + (pos - from));
        pos += d;
        while (this.token === me && (t0 + (pos - from)) - ctx.currentTime > 6) await new Promise(r => setTimeout(r, 200));
      }
      while (this.token === me && ctx.currentTime < t0 + (to - from)) await new Promise(r => setTimeout(r, 50));
      if (this.token === me) { this.stop(); opts && opts.onEnd && opts.onEnd(); }
    }
    get time() { return this.playing && this.ctx ? Math.min(this.to, this.from + Math.max(0, this.ctx.currentTime - this.t0)) : null; }
    stop() { this.token = null; this.playing = false; if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; } }
  }

  // ---------------- microphone ----------------
  const WORKLET = `class LRCap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.n=0}process(i){const c=i[0]&&i[0][0];if(c){for(let k=0;k<c.length;k++){this.b[this.n++]=c[k];if(this.n===2048){this.port.postMessage(this.b.slice(0));this.n=0}}}return true}}registerProcessor('lr-cap',LRCap);`;
  class Mic {
    constructor() { this.ctx = null; this.stream = null; this.onFrames = null; this.level = -90; this.peakHold = -90; this.clip = false; }
    static async devices() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); } catch (e) { return []; } }
    async open(deviceId) {
      if (this.stream && this.deviceId === deviceId) return;
      this.close();
      this.deviceId = deviceId;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, sampleRate: RATE,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false } });   // raw audio: no phone-call processing
      const ctx = this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      const src = ctx.createMediaStreamSource(this.stream);
      const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; src.connect(this.analyser);
      const handle = f32 => {
        let pk = 0; for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); if (a > pk) pk = a; }
        const db = pk > 0 ? 20 * Math.log10(pk) : -90;
        this.level = db; if (db > this.peakHold) this.peakHold = db; if (pk >= 0.999) this.clip = true;
        if (this.onFrames) this.onFrames(f32);
      };
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, "lr-cap"); node.port.onmessage = e => handle(e.data);
        src.connect(node); node.connect(sink);
      } catch (e) {
        const sp = ctx.createScriptProcessor(2048, 1, 1); sp.onaudioprocess = ev => handle(new Float32Array(ev.inputBuffer.getChannelData(0)));
        src.connect(sp); sp.connect(sink);
      }
      if (ctx.state === "suspended") await ctx.resume();
    }
    get label() { const t = this.stream && this.stream.getAudioTracks()[0]; return t ? t.label : ""; }
    close() { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); if (this.ctx) this.ctx.close().catch(() => {}); this.stream = null; this.ctx = null; this.onFrames = null; this.analyser = null; }
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
    const chains = [], bypass = opts && opts.bypass; let lastEnd = null;
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
      return out;
    };
  }

  window.LRAudio = { mixer, RATE, PEAKS_PER_SEC, WavWriter, readPCM, wavInfo, renderRange, quietPoint, lastPause, Player, Mic, loadPeaks };
})();
