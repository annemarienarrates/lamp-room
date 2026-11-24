/* The Lamp Room — a small FLAC encoder (mono, 16 or 24 bit), so chapters go to Auphonic at about half the size of a
   WAV with nothing lost. Each block of 4096 samples is tried with FLAC's fixed predictors (orders 0–4) and the
   smallest is kept, its leftovers written with partitioned Rice codes; a block that won't shrink goes in verbatim.
   LRFlac.Encoder(rate, bits): push(Float32Array) → Uint8Array pieces; finish() → the last piece and a corrected
   STREAMINFO header (write it at the start of the file). */
(function () {
  "use strict";
  const BLOCK = 4096;
  // CRC-8 (poly 0x07) and CRC-16 (poly 0x8005), as FLAC frames use them
  const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; CRC8[i] = c;
    let d = i << 8; for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff; CRC16[i] = d; }
  const crc8 = (b, n) => { let c = 0; for (let i = 0; i < n; i++) c = CRC8[c ^ b[i]]; return c; };
  const crc16 = (b, n) => { let c = 0; for (let i = 0; i < n; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

  function BitWriter(cap) {
    let buf = new Uint8Array(cap), pos = 0, acc = 0, nb = 0;
    const grow = () => { const n = new Uint8Array(buf.length * 2); n.set(buf); buf = n; };
    this.put = (v, n) => {                 // n ≤ 32, v ≥ 0
      while (n > 0) { const take = Math.min(n, 8 - nb); const sh = n - take; acc = (acc << take) | ((v / 2 ** sh) & ((1 << take) - 1)); nb += take; n -= take; v = v % 2 ** sh;
        if (nb === 8) { if (pos >= buf.length) grow(); buf[pos++] = acc; acc = 0; nb = 0; } }
    };
    this.unary = q => { while (q >= 32) { this.put(0, 32); q -= 32; } this.put(1, q + 1); };
    this.align = () => { if (nb) this.put(0, 8 - nb); };
    this.bytes = () => buf.subarray(0, pos);
    this.len = () => pos;
  }
  const utf8num = n => { // FLAC's UTF-8-like frame number
    if (n < 0x80) return [n]; const out = []; let len = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : 6;
    for (let i = len - 1; i > 0; i--) { out.unshift(0x80 | (n & 0x3f)); n = Math.floor(n / 64); }
    out.unshift(((0xff00 >> len) & 0xff) | n); return out;
  };
  // residuals of fixed predictor `order` (samples as Int32Array, warm-up = first `order`)
  function residual(x, order, out) {
    const n = x.length;
    for (let i = order; i < n; i++) {
      out[i - order] = order === 0 ? x[i] : order === 1 ? x[i] - x[i - 1] : order === 2 ? x[i] - 2 * x[i - 1] + x[i - 2] : order === 3 ? x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3] : x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
    return n - order;
  }
  const zz = v => v >= 0 ? v * 2 : -v * 2 - 1;
  // best Rice parameter for a run of residuals, and its cost in bits
  function riceCost(r, a, b) { let sum = 0; for (let i = a; i < b; i++) sum += zz(r[i]); const n = b - a; if (!n) return { k: 0, bits: 0 };
    let k = 0; while (k < 30 && n * 2 ** (k + 1) < sum) k++;
    let best = Infinity, bk = 0; for (let kk = Math.max(0, k - 1); kk <= Math.min(30, k + 1); kk++) { let bits = 0; for (let i = a; i < b; i++) bits += Math.floor(zz(r[i]) / 2 ** kk) + 1 + kk; if (bits < best) { best = bits; bk = kk; } }
    return { k: bk, bits: best }; }

  function Encoder(rate, bits) {
    bits = bits === 16 ? 16 : 24;
    const scale = 2 ** (bits - 1) - 1, pend = []; let pendN = 0, frameNo = 0, total = 0, minF = Infinity, maxF = 0;
    const res = new Int32Array(BLOCK);
    function frame(x) {
      const n = x.length, w = new BitWriter(n * (bits / 8) + 64);
      // header
      w.put(0x3ffe, 14); w.put(0, 1); w.put(0, 1);            // sync, reserved, fixed blocksize
      const bsCode = n === 4096 ? 12 : 7; w.put(bsCode, 4);
      const rateCode = rate === 44100 ? 9 : rate === 48000 ? 10 : rate === 96000 ? 11 : 0; w.put(rateCode, 4);
      w.put(0, 4);                                              // mono
      w.put(bits === 16 ? 4 : 6, 3); w.put(0, 1);
      for (const b of utf8num(frameNo)) w.put(b, 8);
      if (bsCode === 7) w.put(n - 1, 16);
      { const h = w.bytes(); w.put(crc8(h, h.length), 8); }
      // subframe: pick the smallest fixed predictor (or verbatim)
      let best = { order: -1, bits: n * bits };
      for (let order = 0; order <= 4 && order < n; order++) {
        const m = residual(x, order, res); let ok = true;
        for (let i = 0; i < m; i++) if (res[i] > 1073741823 || res[i] < -1073741823) { ok = false; break; }
        if (!ok) continue;
        // partitions: try orders 0..4 that divide the block evenly
        let bestP = null;
        for (let po = 0; po <= 4; po++) { const parts = 1 << po; if (n % parts || (n >> po) <= order) continue; const ps = n >> po; let tot = 0; const ks = [];
          for (let p = 0; p < parts; p++) { const a = p === 0 ? 0 : p * ps - order, b = (p + 1) * ps - order; const c = riceCost(res, a, b); if (c.k > 14) { tot = Infinity; break; } tot += c.bits + 4; ks.push(c.k); }
          if (!bestP || tot < bestP.bits) bestP = { po, ks, bits: tot }; }
        if (!bestP) continue;
        const cost = order * bits + 2 + 4 + bestP.bits;
        if (cost < best.bits) best = { order, bits: cost, p: bestP };
      }
      w.put(0, 1);
      if (best.order < 0) { w.put(1, 6); w.put(0, 1); for (let i = 0; i < n; i++) w.put(x[i] < 0 ? x[i] + 2 ** bits : x[i], bits); }
      else {
        w.put(8 | best.order, 6); w.put(0, 1);
        for (let i = 0; i < best.order; i++) w.put(x[i] < 0 ? x[i] + 2 ** bits : x[i], bits);
        const m = residual(x, best.order, res), { po, ks } = best.p, ps = n >> po;
        w.put(0, 2); w.put(po, 4);
        for (let p = 0; p < (1 << po); p++) { const a = p === 0 ? 0 : p * ps - best.order, b = (p + 1) * ps - best.order, k = ks[p]; w.put(k, 4);
          for (let i = a; i < b; i++) { const u = zz(res[i]); w.unary(Math.floor(u / 2 ** k)); if (k) w.put(u % 2 ** k, k); } }
        void m;
      }
      w.align(); { const f = w.bytes(); w.put(crc16(f, f.length), 16); }
      const out = w.bytes().slice(); frameNo++; total += n; minF = Math.min(minF, out.length); maxF = Math.max(maxF, out.length); return out;
    }
    // 16-bit gets triangular dither (as the WAV export does), so quiet tails fade rather than crunch
    const dith = bits === 16 ? () => (Math.random() - Math.random()) : () => 0;
    const toInt = f => { const x = new Int32Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); x[i] = Math.max(-scale - 1, Math.min(scale, Math.round(v * scale + dith()))); } return x; };
    this.header = () => {                                          // "fLaC" + STREAMINFO (last metadata block)
      const w = new BitWriter(64); w.put(0x664c6143, 32); w.put(1, 1); w.put(0, 7); w.put(34, 24);
      w.put(BLOCK, 16); w.put(BLOCK, 16); w.put(minF === Infinity ? 0 : minF, 24); w.put(maxF, 24);
      w.put(rate, 20); w.put(0, 3); w.put(bits - 1, 5); w.put(Math.floor(total / 2 ** 32), 4); w.put(total % 2 ** 32, 32);
      for (let i = 0; i < 4; i++) w.put(0, 32);                    // no MD5
      return w.bytes().slice();
    };
    this.push = f32 => {
      pend.push(toInt(f32)); pendN += f32.length; const out = [];
      while (pendN >= BLOCK) { const x = new Int32Array(BLOCK); let o = 0; while (o < BLOCK) { const h = pend[0], take = Math.min(BLOCK - o, h.length); x.set(h.subarray(0, take), o); o += take; if (take === h.length) pend.shift(); else pend[0] = h.subarray(take); } pendN -= BLOCK; out.push(frame(x)); }
      return out;
    };
    this.finish = () => { const out = []; if (pendN) { const x = new Int32Array(pendN); let o = 0; for (const h of pend) { x.set(h, o); o += h.length; } pend.length = 0; pendN = 0; out.push(frame(x)); } return { frames: out, header: this.header() }; };
  }
  // Float32Array (mono) → a whole .flac file as a Blob
  function encode(f32, rate, bits) { const e = new Encoder(rate, bits), parts = []; for (let i = 0; i < f32.length; i += 65536) parts.push(...e.push(f32.subarray(i, i + 65536))); const fin = e.finish(); return new Blob([fin.header, ...parts, ...fin.frames], { type: "audio/flac" }); }
  window.LRFlac = { Encoder, encode };
})();
