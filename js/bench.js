/* The Lamp Room — the Effects bench (Tools ▸ 🎛 Effects bench).
   Drop in loose clips (say, the announcer lines an editor cut out of a finished chapter), pick one of your voices — a saved
   voice preset, or the effects on one of your tracks in a book — hear it, and get the clips back as <name>-fx.wav at their
   own sample rate and bit depth, ready to drop back into someone else's session. Reverb and echo tails are kept. */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = { clips: [], fx: null, book: null, busy: false, out: null, playing: null };
  let el = null, ctx = null;

  // ---------- the voices on offer: my saved presets, and my tracks' effects in the chosen book ----------
  function voices(bookId) {
    const out = [];
    for (const [name, pr] of Object.entries(Store.settings.fxPresets || {})) out.push({ id: "p:" + name, label: "Preset · " + name, fx: { armed: pr.armed || [], chain: LRFx.chainOf(pr) } });
    const b = bookId && Store.books.find(x => x.id === bookId), me = Store.me();
    const ts = b && b.trackSet && (b.trackSet[me] || Object.entries(b.trackSet).find(([k]) => Store.samePerson(k, me))?.[1]);
    (ts || []).forEach((st, i) => { const fx = { armed: st.armed || [], chain: LRFx.chainOf(st) };
      if (fx.armed.length || LRFx.chainActive(fx.chain)) out.push({ id: "t" + i, label: (st.name || "Track " + (i + 1)) + (fx.armed.length ? " · " + fx.armed.map(e => LRFx.KINDS[e.k].name).join(", ") : " · track sound"), fx }); });
    return out;
  }
  const current = () => voices(S.book).find(v => v.id === S.fx) || null;

  // ---------- reading a clip: every channel, at its own rate ----------
  async function read(file) {
    if (/\.wav$/i.test(file.name) || file.type === "audio/wav" || file.type === "audio/x-wav") {
      const h = await LRAudio.wavInfo(file), bps = h.bits / 8, frame = bps * h.ch, n = Math.floor(h.dataLen / frame);
      const dv = new DataView(await file.slice(h.dataOff, h.dataOff + n * frame).arrayBuffer()), ch = [];
      for (let c = 0; c < h.ch; c++) ch.push(new Float32Array(n));
      for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < h.ch; c++, o += bps) {
        let v;
        if (h.bits === 24) v = (dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16)) / 8388608;
        else if (h.bits === 16) v = dv.getInt16(o, true) / 32768;
        else if (h.bits === 32 && h.fmt === 3) v = dv.getFloat32(o, true);
        else if (h.bits === 32) v = dv.getInt32(o, true) / 2147483648;
        else v = (dv.getUint8(o) - 128) / 128;
        ch[c][i] = v;
      }
      return { ch, rate: h.rate, bits: h.bits === 16 ? 16 : 24 };
    }
    // MP3, M4A, AIFF, FLAC…: decoded by the browser; they come back as 24-bit WAV
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 48000);
    const buf = await ac.decodeAudioData(await file.arrayBuffer()), ch = [];
    for (let c = 0; c < buf.numberOfChannels; c++) ch.push(Float32Array.from(buf.getChannelData(c)));
    return { ch, rate: buf.sampleRate, bits: 24 };
  }

  // ---------- the effect, with room for its tail ----------
  async function voice(x, rate, fx) {
    const tail = LRFx.tailOf(fx.armed || []), y0 = new Float32Array(x.length + Math.round(tail * rate)); y0.set(x);
    let y = fx.armed && fx.armed.length ? await LRFx.runList(fx.armed, y0, rate) : y0;
    if (LRFx.chainActive(fx.chain)) { y = Float32Array.from(y); new LRFx.Chain(fx.chain, rate).process(y); }
    return y;
  }
  async function processClip(c, fx) {
    const a = c.audio || (c.audio = await read(c.file));
    const ch = []; for (const x of a.ch) ch.push(await voice(x, a.rate, fx));
    // keep the tail only as long as it's audible (above −60 dB), never shorter than the dry clip
    let n = Math.max(...ch.map(x => x.length)), last = 0; const dry = a.ch[0].length;
    for (const x of ch) for (let i = x.length - 1; i > last; i--) if (Math.abs(x[i]) > 0.001) { last = i; break; }
    n = Math.min(n, Math.max(dry, last + Math.round(a.rate * 0.05)));
    for (const x of ch) { const f = Math.round(a.rate * 0.02); for (let i = Math.max(dry, n - f); i < Math.min(n, x.length); i++) x[i] *= (n - i) / f; }
    return { ch: ch.map(x => { if (x.length === n) return x; const y = new Float32Array(n); y.set(x.subarray(0, n)); return y; }), rate: a.rate, bits: a.bits };
  }

  // ---------- writing a WAV: same channels, rate and depth (16-bit gets a touch of dither) ----------
  function wav({ ch, rate, bits }) {
    const n = ch[0].length, nc = ch.length, bps = bits / 8, data = n * nc * bps, b = new ArrayBuffer(44 + data), v = new DataView(b);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + data, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true); str(36, "data"); v.setUint32(40, data, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, o += bps) {
      const s = Math.max(-1, Math.min(1, ch[c][i]));
      if (bits === 16) { const d = (Math.random() - Math.random()) / 32768; v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round((s + d) * 32767))), true); }
      else { const q = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388607))); v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); }
    }
    return new Blob([b], { type: "audio/wav" });
  }
  const outName = name => name.replace(/\.[^.]+$/, "") + "-fx.wav";
  const dur = s => { s = Math.round(s * 10) / 10; return s < 60 ? s.toFixed(1) + " s" : Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0"); };

  // ---------- listening ----------
  function stopPlay() { if (S.playing) { try { S.playing.src.stop(); } catch (e) {} S.playing = null; } }
  async function play(i, dry) {
    const was = S.playing && S.playing.i === i && S.playing.dry === dry; stopPlay(); render(); if (was) return;
    const c = S.clips[i], fx = current(); if (!c) return;
    try {
      const a = dry || !fx ? (c.audio || (c.audio = await read(c.file))) : await processClip(c, fx.fx);
      ctx = ctx || new AudioContext(); if (ctx.state === "suspended") await ctx.resume();
      const buf = ctx.createBuffer(a.ch.length, a.ch[0].length, a.rate); a.ch.forEach((x, k) => buf.copyToChannel(x, k));
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.onended = () => { if (S.playing && S.playing.src === src) { S.playing = null; render(); } };
      src.start(); S.playing = { i, dry, src }; render();
    } catch (e) { say("Couldn't play " + c.file.name + ": " + (e.message || e)); }
  }

  // ---------- doing the lot ----------
  async function processAll(toFolder) {
    const fx = current(); if (!fx || !S.clips.length || S.busy) return [];
    let dir = null;
    if (toFolder) { try { dir = await window.showDirectoryPicker({ id: "lr-bench", mode: "readwrite" }); } catch (e) { return []; } }
    S.busy = true; stopPlay(); const done = [];
    try {
      for (let i = 0; i < S.clips.length; i++) {
        const c = S.clips[i]; c.state = "working"; render();
        try {
          const blob = wav(await processClip(c, fx.fx)), name = outName(c.file.name);
          if (dir) { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(blob); await w.close(); }
          done.push({ name, blob }); c.state = "done"; c.audio = null;      // let the decoded copy go
        } catch (e) { c.state = "error"; c.err = e.message || String(e); }
      }
      if (!dir && done.length) {
        if (done.length === 1) save(done[0].blob, done[0].name);
        else { const z = new JSZip(); done.forEach(d => z.file(d.name, d.blob)); save(await z.generateAsync({ type: "blob" }), "clips-fx.zip"); }
      }
      S.out = done; say(done.length + " clip" + (done.length === 1 ? "" : "s") + " with " + fx.label.replace(/^Preset · /, "") + (dir ? " saved to " + dir.name + "." : ", downloaded."));
    } finally { S.busy = false; render(); }
    return done;
  }
  function save(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function say(m) { if (window.toast) window.toast(m, true); else console.log(m); }

  function add(files) {
    const ok = [...files].filter(f => /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg)$/i.test(f.name));
    if (ok.length < files.length) say("Skipped " + (files.length - ok.length) + " file" + (files.length - ok.length === 1 ? "" : "s") + " that aren't audio.");
    for (const f of ok) if (!S.clips.some(c => c.file.name === f.name && c.file.size === f.size)) S.clips.push({ file: f, state: "" });
    S.out = null; render();
    ok.forEach(async f => { const c = S.clips.find(x => x.file === f); if (!c) return; try { const a = c.audio = await read(f); c.len = a.ch[0].length / a.rate; c.info = a.rate / 1000 + " kHz · " + (a.bits === 16 ? "16" : "24") + "-bit" + (a.ch.length > 1 ? " · stereo" : ""); } catch (e) { c.state = "error"; c.err = "can't read it"; } render(); });
  }

  // ---------- the panel ----------
  function render() {
    if (!el || !el.isConnected) return;
    const vs = voices(S.book), books = Store.books.filter(b => !b.archived), dis = S.busy ? "disabled" : "";
    if (S.fx && !vs.some(v => v.id === S.fx)) S.fx = null;
    if (!S.fx && vs.length) S.fx = vs[0].id;
    const fx = current();
    el.innerHTML = `<div class="card bench">
      <div class="row" style="align-items:flex-end">
        <label>Effect<select id="bn-fx" ${dis}>${vs.length ? vs.map(v => `<option value="${esc(v.id)}" ${v.id === S.fx ? "selected" : ""}>${esc(v.label)}</option>`).join("") : `<option value="">No voices yet</option>`}</select></label>
        <label>Tracks from<select id="bn-book" ${dis}><option value="">— presets only —</option>${books.map(b => `<option value="${esc(b.id)}" ${b.id === S.book ? "selected" : ""}>${esc(b.title)}</option>`).join("")}</select></label>
        <div class="spacer"></div>
        ${fx ? `<span class="small muted">${fx.fx.armed.length ? fx.fx.armed.map(e => esc(LRFx.KINDS[e.k].name) + " <i>" + esc(LRFx.KINDS[e.k].sum(e.p)) + "</i>").join(" → ") : ""}${LRFx.chainActive(fx.fx.chain) ? (fx.fx.armed.length ? " · " : "") + "track sound" : ""}</span>` : ""}
      </div>
      ${vs.length ? "" : `<p class="small muted">Save a voice in the Booth first (Tools ▸ 🎛 Effects ▸ Voice presets), or choose a book whose tracks have effects armed.</p>`}
      <div class="bn-drop" id="bn-drop" tabindex="0">Drop clips here, or <button class="btn small" id="bn-pick" ${dis}>choose files…</button> <span class="small muted">WAV (kept at its own rate and depth), or MP3, M4A, AIFF, FLAC</span></div>
      ${S.clips.length ? `<div class="bn-list">${S.clips.map((c, i) => `<div class="bn-row ${c.state}">
          <span class="bn-n">${c.state === "done" ? "✓" : c.state === "working" ? "…" : c.state === "error" ? "⚠" : i + 1}</span>
          <span class="bn-name"><b>${esc(c.file.name)}</b><br><i class="small muted">${c.len != null ? dur(c.len) + " · " + esc(c.info) : c.state === "error" ? esc(c.err) : "reading…"}${c.state === "done" ? " → " + esc(outName(c.file.name)) : ""}</i></span>
          <button class="btn small quiet" data-bn="dry:${i}" title="Hear it as it is">${S.playing && S.playing.i === i && S.playing.dry ? "■" : "▶ Dry"}</button>
          <button class="btn small" data-bn="wet:${i}" ${fx ? "" : "disabled"} title="Hear it with the effect">${S.playing && S.playing.i === i && !S.playing.dry ? "■" : "▶ With effect"}</button>
          <button class="btn small quiet" data-bn="rm:${i}" ${dis} title="Take it off the list">✕</button></div>`).join("")}</div>
        <div class="row" style="margin-top:10px"><button class="btn quiet small" id="bn-clear" ${dis}>Clear the list</button><div class="spacer"></div>
          ${window.showDirectoryPicker ? `<button class="btn" id="bn-folder" ${fx ? "" : "disabled"} ${dis}>Process all into a folder…</button>` : ""}
          <button class="btn primary" id="bn-go" ${fx ? "" : "disabled"} ${dis}>${S.busy ? "Working…" : "Process all and download"}</button></div>
        <p class="small muted" style="margin:8px 0 0">Each comes back as <b>name-fx.wav</b>. Reverb and echo ring on, so a clip can come back a little longer: line it up by its start.</p>` : ""}
    </div>`;
    const $ = s => el.querySelector(s);
    $("#bn-fx").onchange = e => { S.fx = e.target.value; Store.lsSet && Store.lsSet("lr-bench-fx", S.fx); stopPlay(); render(); };
    $("#bn-book").onchange = e => { S.book = e.target.value || null; Store.lsSet && Store.lsSet("lr-bench-book", S.book || ""); S.fx = null; stopPlay(); render(); };
    const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "audio/*,.wav,.aif,.aiff,.flac,.m4a"; inp.onchange = () => add(inp.files);
    $("#bn-pick").onclick = e => { e.stopPropagation(); inp.click(); };
    const d = $("#bn-drop"); d.ondragover = e => { e.preventDefault(); d.classList.add("over"); }; d.ondragleave = () => d.classList.remove("over");
    d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); if (e.dataTransfer.files.length) add(e.dataTransfer.files); };
    el.querySelectorAll("[data-bn]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.bn.split(":");
      if (k === "rm") { stopPlay(); S.clips.splice(+i, 1); render(); } else play(+i, k === "dry"); });
    if ($("#bn-clear")) $("#bn-clear").onclick = () => { stopPlay(); S.clips = []; S.out = null; render(); };
    if ($("#bn-go")) $("#bn-go").onclick = () => processAll(false);
    if ($("#bn-folder")) $("#bn-folder").onclick = () => processAll(true);
  }

  // mount on the Tools page; `opts` can pick the book and effect (the Booth's "Process clips…" does)
  function mount(target, opts) {
    el = target; opts = opts || {};
    const get = k => (Store.lsGet && Store.lsGet(k)) || null;
    S.book = opts.book != null ? opts.book : (S.book || get("lr-bench-book") || null);
    if (S.book && !Store.books.some(b => b.id === S.book)) S.book = null;
    S.fx = opts.fx || S.fx || get("lr-bench-fx") || null;
    render();
  }
  window.LRBench = { mount, voices, processAll, add, wav, read, get state() { return S; }, outName };
})();
