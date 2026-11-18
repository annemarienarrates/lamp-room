/* The Lamp Room — mixing and export.
   Raw WAV 48 kHz/24-bit (for Auphonic), WAV 44.1 kHz/16-bit (ACX), MP3 192k (ACX).
   Named markers go into WAV files as cue points with labels. */
(function (root) {
  "use strict";
  const IN = 48000, OUT = 44100;

  // ---------- 48 kHz → 44.1 kHz resampler (windowed sinc, 147 polyphase filters, streaming) ----------
  // output sample n sits at input position n·160/147; each fractional position k/147 has its own filter
  class Resampler {
    constructor() {
      this.L = 147; this.M = 160; this.T = 32;                 // 64 taps per phase
      const fc = 0.45, beta = 8.6, I0 = x => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
      this.h = [];
      for (let p = 0; p < this.L; p++) {
        const frac = p / this.L, row = new Float32Array(2 * this.T); let sum = 0;
        for (let k = 0; k < 2 * this.T; k++) {
          const t = (k - this.T + 1) - frac;                     // distance from the output point, in input samples
          const sinc = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * 2 * fc * t) / (Math.PI * 2 * fc * t);
          const r = t / this.T, w = Math.abs(r) >= 1 ? 0 : I0(beta * Math.sqrt(1 - r * r)) / I0(beta);
          row[k] = sinc * w; sum += row[k];
        }
        for (let k = 0; k < row.length; k++) row[k] /= sum;
        this.h.push(row);
      }
      this.buf = new Float32Array(0); this.base = -(this.T - 1);  // input index of buf[0] (starts with T-1 samples of silence before 0)
      this.buf = new Float32Array(this.T - 1); this.n = 0;
    }
    push(x) {
      const nb = new Float32Array(this.buf.length + x.length); nb.set(this.buf); nb.set(x, this.buf.length); this.buf = nb;
      const out = [];
      while (true) {
        const num = this.n * this.M, i = Math.floor(num / this.L), p = num - i * this.L;   // input index i, phase p
        const first = i - this.T + 1 - this.base, last = first + 2 * this.T - 1;
        if (last >= this.buf.length) break;
        const h = this.h[p]; let s = 0;
        for (let k = 0; k < 2 * this.T; k++) s += h[k] * this.buf[first + k];
        out.push(s); this.n++;
      }
      // drop input no longer needed
      const need = Math.floor(this.n * this.M / this.L) - this.T + 1 - this.base;
      if (need > 0) { this.buf = this.buf.slice(need); this.base += need; }
      return Float32Array.from(out);
    }
    flush() { return this.push(new Float32Array(2 * this.T)); }
  }

  // ---------- encoders ----------
  const u32 = (v, n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (v >>> (8 * i)) & 255; return b; };
  const str = s => Uint8Array.from(s, c => c.charCodeAt(0));
  const cat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  function pcmBytes(f32, bits, dither) {
    if (bits === 24) {
      const out = new Uint8Array(f32.length * 3);
      for (let i = 0, o = 0; i < f32.length; i++, o += 3) { let s = Math.max(-1, Math.min(1, f32[i])); let v = Math.round(s * 8388607); if (v < 0) v += 16777216; out[o] = v & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = (v >> 16) & 255; }
      return out;
    }
    const out = new Uint8Array(f32.length * 2), dv = new DataView(out.buffer);
    for (let i = 0; i < f32.length; i++) { const d = dither ? (Math.random() - Math.random()) / 32768 : 0; const s = Math.max(-1, Math.min(1, f32[i] + d)); dv.setInt16(i * 2, Math.round(s * 32767), true); }
    return out;
  }
  // cue + label chunks for named markers (sample positions at the file's rate)
  function cueChunks(markers, rate) {
    const ms = markers.filter(m => m.note || m.label); if (!ms.length) return new Uint8Array(0);
    const cue = [str("cue "), u32(4 + ms.length * 24, 4), u32(ms.length, 4)];
    ms.forEach((m, i) => cue.push(u32(i + 1, 4), u32(Math.round(m.t * rate), 4), str("data"), u32(0, 4), u32(0, 4), u32(Math.round(m.t * rate), 4)));
    const labs = ms.map((m, i) => { let t = str((m.note || m.label) + "\0"); if (t.length & 1) t = cat([t, new Uint8Array(1)]); return cat([str("labl"), u32(4 + t.length, 4), u32(i + 1, 4), t]); });
    const listBody = cat([str("adtl"), ...labs]);
    return cat([...cue, str("LIST"), u32(listBody.length, 4), listBody]);
  }
  function wavHeader(dataBytes, rate, bits, extraBytes) {
    const ba = bits / 8;
    return cat([str("RIFF"), u32(36 + dataBytes + (dataBytes & 1) + extraBytes, 4), str("WAVE"), str("fmt "), u32(16, 4), u32(1, 2), u32(1, 2), u32(rate, 4), u32(rate * ba, 4), u32(ba, 2), u32(bits, 2), str("data"), u32(dataBytes, 4)]);
  }

  // Export one chapter. render(from, dur) returns mono float32 at 48 kHz of the mixed chapter.
  // fmt: "raw" (48k/24 WAV), "wav" (44.1k/16 WAV), "mp3" (44.1k 192k). Writes to a FileSystemFileHandle.
  async function exportChapter(render, length, fmt, fileHandle, markers, onProgress) {
    const ws = await fileHandle.createWritable();
    const CH = 10;                                         // seconds per chunk
    let dataBytes = 0, mp3, rs, tail = new Int16Array(0);
    const outRate = fmt === "raw" ? IN : OUT, bits = fmt === "raw" ? 24 : 16;
    if (fmt !== "mp3") await ws.write(wavHeader(0, outRate, bits, 0));
    if (fmt !== "raw") rs = new Resampler();
    if (fmt === "mp3") mp3 = new lamejs.Mp3Encoder(1, OUT, 192);
    const writeOut = async f32 => {
      if (fmt === "mp3") {
        const pcm = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) { const d = (Math.random() - Math.random()) / 32768; pcm[i] = Math.round(Math.max(-1, Math.min(1, f32[i] + d)) * 32767); }
        const all = new Int16Array(tail.length + pcm.length); all.set(tail); all.set(pcm, tail.length);
        const n = Math.floor(all.length / 1152) * 1152; tail = all.slice(n);
        for (let i = 0; i < n; i += 1152) { const b = mp3.encodeBuffer(all.subarray(i, i + 1152)); if (b.length) await ws.write(new Uint8Array(b)); }
      } else { const b = pcmBytes(f32, bits, fmt === "wav"); dataBytes += b.length; await ws.write(b); }
    };
    for (let t = 0; t < length; t += CH) {
      const d = Math.min(CH, length - t), x = await render(t, d);
      await writeOut(rs ? rs.push(x) : x);
      if (onProgress) onProgress(Math.min(1, (t + d) / length));
    }
    if (rs) { const target = Math.round(length * OUT), before = rs.n - 0, rest = rs.flush(), have = before; const keep = Math.max(0, Math.min(rest.length, target - (rs.n - rest.length))); await writeOut(rest.subarray(0, keep)); }
    if (fmt === "mp3") {
      if (tail.length) { const b = mp3.encodeBuffer(tail); if (b.length) await ws.write(new Uint8Array(b)); }
      const e = mp3.flush(); if (e.length) await ws.write(new Uint8Array(e));
    } else {
      if (dataBytes & 1) await ws.write(new Uint8Array(1));
      const extra = cueChunks(markers || [], outRate);
      if (extra.length) await ws.write(extra);
      await ws.write({ type: "write", position: 0, data: wavHeader(dataBytes, outRate, bits, extra.length) });
    }
    await ws.close();
  }

  // file name from the pattern: {book} {chapter} {title} {n} {nn} {nnn}
  function fileName(pattern, book, chapter, index) {
    const n = index + 1, title = chapter.title || "Chapter " + n, seq = window.LRCredits ? LRCredits.seqOf(book, chapter) : n;
    const map = { book: book.title, chapter: /^chapter\s*\d+/i.test(title) ? title.replace(/:.*$/, "") : title, title, n: String(n), nn: String(n).padStart(2, "0"), nnn: String(n).padStart(3, "0"),
      seq: String(seq).padStart(3, "0"), name: window.LRCredits ? LRCredits.cleanName(title) : title };
    const out = String(pattern || "{book} - {nn} - {chapter}").replace(/\{(\w+)\}/g, (m, k) => (k.toLowerCase() in map ? map[k.toLowerCase()] : m))
      .replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
    return out || "Untitled";
  }

  const API = { Resampler, exportChapter, fileName, cueChunks };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.LRExport = API;
})(typeof window !== "undefined" ? window : globalThis);
