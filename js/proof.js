/* The Lamp Room — proofing: listen back to what you read and flag the words that don't match the text.
   The listening happens in proof-worker.js; this side resamples the audio and lines up what was heard with the manuscript. */
(function () {
  "use strict";
  let worker = null, seq = 0, ready = {}, loading = {}, onProgress = null;
  const waits = {};
  function w() {
    if (worker) return worker;
    worker = new Worker("js/proof-worker.js?v=202611231423", { type: "module" });
    worker.onmessage = e => {
      const m = e.data || {};
      if (m.type === "progress") { onProgress && onProgress(m); return; }
      if (m.type === "ready") { ready[m.kind] = m; onProgress && onProgress({ done: true, kind: m.kind }); return; }
      const f = waits[m.id]; if (!f) return; delete waits[m.id];
      m.ok ? f.res(m) : f.rej(new Error(m.err || "The proofer stopped"));
    };
    worker.onerror = e => { for (const k in waits) { waits[k].rej(new Error(e.message || "The proofer couldn't start")); delete waits[k]; } worker = null; };
    return worker;
  }
  function call(msg, transfer) { return new Promise((res, rej) => { const id = ++seq; waits[id] = { res, rej }; w().postMessage(Object.assign({ id }, msg), transfer || []); }); }

  // 48 kHz (or any rate) → 16 kHz mono, which is what the model hears
  async function to16k(x, rate) {
    rate = rate || 48000; if (!x.length) return new Float32Array(0);
    const n = Math.ceil(x.length * 16000 / rate), ctx = new OfflineAudioContext(1, n, 16000);
    const b = ctx.createBuffer(1, x.length, rate); b.copyToChannel(x, 0);
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start();
    return (await ctx.startRendering()).getChannelData(0);
  }
  async function hear(x48, kind) {
    if (LRProof._mock) return LRProof._mock(x48, kind);
    const a = await to16k(x48, 48000);
    const r = await call({ cmd: "asr", kind: kind || "fast", audio: a }, [a.buffer]);
    return r.text;
  }
  // with timing: [{text, t:[from,to]}] in seconds from the start of x (16 kHz audio passed straight through when rate is 16000)
  async function hearTimed(x, rate, kind) {
    if (LRProof._mockTimed) return LRProof._mockTimed(x, rate);
    const a = rate === 16000 ? x.slice() : await to16k(x, rate || 48000);
    const r = await call({ cmd: "asr", kind: kind || "careful", audio: a, stamps: true }, [a.buffer]);
    return r.chunks && r.chunks.length ? r.chunks : [{ text: r.text, t: [0, a.length / 16000] }];
  }
  const load = kind => loading[kind] = loading[kind] || call({ cmd: "load", kind: kind || "fast" });

  // ---------------- lining up what was heard with the text ----------------
  const FILL = new Set(["um", "uh", "erm", "er", "hmm", "mm", "ah", "uhm"]);
  const FUNC = new Set(["a", "an", "the", "and", "of", "to", "in", "on", "at", "it", "is", "was", "that", "as", "for", "but", "or", "so", "i", "he", "she", "they", "we", "you", "his", "her", "its", "be", "by", "with", "from", "had", "have", "has"]);
  const NUMW = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "first", "second", "third", "fourth", "fifth", "half"]);
  function norm(s) { return String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9'%]+/g, "").replace(/^'+|'+$/g, ""); }
  const split = s => String(s).split(/[\s—–\-/]+|\.{3}|…/).map(norm).filter(Boolean);
  const bare = s => s.replace(/'/g, "");
  const isNum = s => /^\d/.test(s);
  function same(a, b) {
    if (a === b || bare(a) === bare(b)) return true;
    if ((isNum(a) && NUMW.has(b)) || (isNum(b) && NUMW.has(a))) return true;
    if (a.length > 4 && b.length > 4 && (a.replace(/our/g, "or") === b.replace(/our/g, "or") || a.replace(/ise/g, "ize") === b.replace(/ise/g, "ize"))) return true;   // colour/color, realise/realize
    return false;
  }
  // text: [{w, i}] (manuscript words with their token index). Text the take didn't reach costs nothing at either end.
  function align(text, heardText, ignore) {
    const T = []; for (const t of text) for (const p of split(t.w)) T.push({ w: p, i: t.i });
    const H = split(heardText).filter(h => !FILL.has(h));
    const n = T.length, m = H.length; if (!n || !m) return [];
    const D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let j = 1; j <= m; j++) D[0][j] = j;
    for (let i = 1; i <= n; i++) { D[i][0] = 0; for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + (same(T[i - 1].w, H[j - 1]) ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1); }
    let bi = 0; for (let i = 1; i <= n; i++) if (D[i][m] <= D[bi][m]) bi = i;
    // walk back
    const ops = []; let i = bi, j = m;
    while (j > 0) {
      if (i > 0 && D[i][j] === D[i - 1][j - 1] + (same(T[i - 1].w, H[j - 1]) ? 0 : 1)) { ops.push({ k: same(T[i - 1].w, H[j - 1]) ? "=" : "~", t: i - 1, h: j - 1 }); i--; j--; }
      else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push({ k: "-", t: i - 1 }); i--; }
      else { ops.push({ k: "+", h: j - 1, t: i - 1 }); j--; }
    }
    ops.reverse();
    // runs of mismatches become issues
    const out = []; let cur = null;
    const flush = () => {
      if (!cur) return; const c = cur; cur = null;
      const tw = c.t.map(k => T[k].w), hw = c.h.map(k => H[k]);
      if (tw.join("") === hw.join("")) return;                                   // "every one" / "everyone"
      if (tw.every(x => FUNC.has(x)) && hw.every(x => FUNC.has(x)) && tw.length + hw.length <= 2) return;   // a dropped or swapped "the"
      const ig = ignore || new Set(); if (tw.length && tw.every(x => ig.has(x) || ig.has(bare(x)))) return;
      const ti = c.t.length ? c.t.map(k => T[k].i) : [T[Math.max(0, Math.min(n - 1, c.near))].i];
      out.push({ kind: !hw.length ? "missed" : !tw.length ? "extra" : "misread", from: Math.min(...ti), to: Math.max(...ti), text: c.t.map(k => T[k].w).join(" "), heard: hw.join(" ") });
    };
    for (const o of ops) {
      if (o.k === "=") { flush(); continue; }
      cur = cur || { t: [], h: [], near: o.t };
      if (o.k === "~") { cur.t.push(o.t); cur.h.push(o.h); } else if (o.k === "-") cur.t.push(o.t); else cur.h.push(o.h);
    }
    flush();
    // leading/trailing text skips are free; anything flagged as "missed" right at the edges is just where the window cut
    const first = ops.findIndex(o => o.k === "="), last = ops.length - 1 - [...ops].reverse().findIndex(o => o.k === "=");
    const edgeT = new Set(); ops.forEach((o, k) => { if (o.t != null && (k < first || k > last)) edgeT.add(T[Math.max(0, o.t)] && T[Math.max(0, o.t)].i); });
    return out.filter(x => !(x.kind === "missed" && edgeT.has(x.from) && edgeT.has(x.to)));
  }

  // which text word each heard word lines up with: [{h, i}] (h: index into heard words, i: token index)
  function matches(text, heardWords) {
    const T = []; for (const t of text) for (const p of split(t.w)) T.push({ w: p, i: t.i });
    const H = heardWords; const n = T.length, m = H.length; if (!n || !m) return [];
    const D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let j = 1; j <= m; j++) D[0][j] = j;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + (same(T[i - 1].w, H[j - 1]) ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1);
    let bi = 0; for (let i = 1; i <= n; i++) if (D[i][m] <= D[bi][m]) bi = i;
    const out = []; let i = bi, j = m;
    while (j > 0 && i > 0) {
      const eq = same(T[i - 1].w, H[j - 1]);
      if (D[i][j] === D[i - 1][j - 1] + (eq ? 0 : 1)) { if (eq) out.push({ h: j - 1, i: T[i - 1].i }); i--; j--; }
      else if (D[i][j] === D[i - 1][j] + 1) i--; else j--;
    }
    return out.reverse();
  }
  window.LRProof = {
    hearTimed, matches, split: s => split(s).filter(h => !FILL.has(h)),
    hear, load, align, to16k, norm,
    set onProgress(f) { onProgress = f; },
    ready: kind => !!ready[kind || "fast"],
    _mock: null
  };
})();
