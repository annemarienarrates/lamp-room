/* booth/06-edit.js — Playhead & playback, editing, and effects.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= playhead & playback =======================
  function clickWord(i) {
    if (B.rec) return;
    const t = T().timeOfWord(B.audio, i);
    B.f.set(i); prog().pos = B.f.pos; markPos(false);
    if (t != null) B.playhead = t;
    Store.saveBook(B.book);
    renderTransport();
  }
  function seek(t) {
    if (B.rec) return;
    B.playhead = Math.max(0, Math.min(len(), t));
    const w = T().wordAt(B.audio, B.playhead); if (w != null) { B.f.set(w); markPos(true); }
    if (B.player.playing) togglePlay(true);
    renderTransport();
  }
  async function togglePlay(restart) {
    if (B.rec) return;
    if (B.player.playing && !restart) { B.player.stop(); renderTransport(); return; }
    const L = len(); if (!L) return;
    let from = B.sel ? B.sel.a : B.playhead != null ? B.playhead : Math.max(0, L - 10);
    if (from >= L - 0.1) from = Math.max(0, L - 10);
    const to = B.sel ? B.sel.b : L;
    B.player.play(await mix(), from, to, { onEnd: () => B && renderTransport() });
    renderTransport(); setTimeout(startAnim, 150);
  }

  // ======================= editing =======================
  const snap = () => JSON.stringify({ a: B.audio, pos: B.f.pos, ts: trackSet() });
  function pushUndo() { B.undo.push(snap()); if (B.undo.length > 80) B.undo.shift(); B.redo = []; }
  function restore(json) {
    const x = JSON.parse(json);
    B.chap.audio[B.readingAs] = B.audio = T().normalize(x.a);
    if (x.ts) B.book.trackSet[B.readingAs] = x.ts;
    B.f.set(x.pos); prog().pos = B.f.pos; B.sel = null; B.selTake = null; B.track = Math.min(B.track, B.audio.tracks.length - 1);
    Store.saveBook(B.book); markPos(true); loadPeaks(); renderEditBar(); renderTransport();
  }
  async function undo() { if (B.rec) await stopRecording(); B.player.stop(); if (!B.undo.length) { toast("Nothing to undo."); return; } B.redo.push(snap()); restore(B.undo.pop()); }
  async function redo() { if (B.rec) return; if (!B.redo.length) { toast("Nothing to redo."); return; } B.undo.push(snap()); restore(B.redo.pop()); }
  function edited() { B.selTake = null; Store.saveBook(B.book); renderEditBar(); renderTransport(); if (B.side === "tools") renderSide(); }
  // the clipboard holds every track's audio in the selected range, so duet lines stay with their narration
  function copy() { if (!B.sel || B.rec) return false; B.clip = B.audio.tracks.map((_, ti) => T().extract(B.audio, ti, B.sel.a, B.sel.b)); B.clipLen = B.sel.b - B.sel.a; notice("Copied " + clock(B.clipLen) + "."); renderEditBar(); return true; }
  function cut() { if (!copy()) return; pushUndo(); T().deleteRange(B.audio, B.sel.a, B.sel.b); B.playhead = B.sel.a; B.sel = null; edited(); }
  function deleteSel() { if (!B.sel || B.rec) return; pushUndo(); T().deleteRange(B.audio, B.sel.a, B.sel.b); B.playhead = B.sel.a; B.sel = null; edited(); }
  function paste(over) {
    if (!B.clip || B.rec) return;
    const at = B.playhead != null ? B.playhead : len();
    pushUndo();
    while (B.audio.tracks.length < B.clip.length) B.audio.tracks.push({ clips: [] });
    if (over) B.clip.forEach((cl, ti) => { if (cl.length) T().overwrite(B.audio, ti, cl, at); });
    else { T().insertGap(B.audio, at, B.clipLen); B.clip.forEach((cl, ti) => { for (const c of cl) B.audio.tracks[ti].clips.push(Object.assign({}, c, { at: c.at + at })); B.audio.tracks[ti].clips.sort((x, y) => x.at - y.at); }); }
    B.playhead = at + B.clipLen; edited();
  }
  function splitHere() { if (B.rec) return; const t = B.playhead; if (t == null) { toast("Click the waveform to place the playhead first."); return; } pushUndo(); T().splitAt(B.audio, B.track, t); edited(); }
  function selectAll() { if (B.rec || !len()) return; B.sel = { a: 0, b: len() }; renderEditBar(); renderTransport(); }
  function nextTrack() { if (B.rec) return; B.track = (B.track + 1) % B.audio.tracks.length; renderEditBar(); renderTransport(); }
  // tracks belong to the book: adding one adds it to every chapter
  function addTrack(quiet) {
    const ts = trackSet(); if (ts.length >= MAX_TRACKS) { if (!quiet) toast("Six tracks is the limit."); return false; }
    if (!quiet) pushUndo();
    ts.push({ name: "Track " + (ts.length + 1), vol: 0, mute: false, solo: false });
    B.book.chapters.forEach(c => { if (c.audio && c.audio[B.readingAs]) { const a = T().normalize(c.audio[B.readingAs]); while (a.tracks.length < ts.length) a.tracks.push({ clips: [] }); } });
    while (B.audio.tracks.length < ts.length) B.audio.tracks.push({ clips: [] });
    if (!quiet) { B.track = ts.length - 1; edited(); }
    return true;
  }
  function removeTrack(ti) {
    const ts = trackSet(); if (ts.length <= 1) return;
    const used = B.book.chapters.some(c => c.audio && c.audio[B.readingAs] && (T().normalize(c.audio[B.readingAs]).tracks[ti] || { clips: [] }).clips.length);
    if (!confirm(`Remove track ${ti + 1} (“${ts[ti].name}”) from every chapter?${used ? " Its audio goes with it (Undo brings it back in this chapter)." : ""}`)) return;
    pushUndo();
    ts.splice(ti, 1);
    B.book.chapters.forEach(c => { if (c.audio && c.audio[B.readingAs]) T().normalize(c.audio[B.readingAs]).tracks.splice(ti, 1); });
    B.track = Math.min(B.track, ts.length - 1); edited();
  }

  // ======================= effects: apply, preview, arm, repeat =======================
  const RATE = () => LRAudio.RATE;
  function fxTarget(ti) {
    if (B.sel) return { ti, a: B.sel.a, b: B.sel.b };
    if (B.selTake) { const c = B.audio.tracks[B.selTake.ti].clips[B.selTake.ci]; if (c) return { ti: B.selTake.ti, a: c.at, b: c.at + c.dur }; }
    const L = T().trackLen(B.audio.tracks[ti]); return L ? { ti, a: 0, b: L } : null;
  }
  const fxTi = () => Math.min(B.fxTrack != null ? B.fxTrack : B.track, B.audio.tracks.length - 1);
  // progress lines ("Splicing…", "Checking…") — hidden while recording, and if you've switched them off
  function busyNote(txt) { B.busyTxt = txt; const n = $("#bd-busy"); if (n) n.textContent = txt && Store.settings.progressNotes !== false && !B.rec ? txt : ""; }
  // process [a, b) of one track and lay the result over it as a new file; tails ring on into silence, never over the next take
  async function processRegion(list, tgt) {
    const d = await dir(), tr = B.audio.tracks[tgt.ti], dur = tgt.b - tgt.a, R = RATE();
    const dry = await LRAudio.renderRange(d, tr.clips, tgt.a, dur);
    const y = await LRFx.runList(list, dry, R, q => busyNote(LRFx.KINDS[list[0].k].name + "… " + Math.round(q * 100) + "%"));
    // the tail may only ring into silence: stop at the next audio on this track after the passage (including a take that runs past it)
    const next = tr.clips.filter(c => c.at + c.dur > tgt.b + 1e-3).reduce((m, c) => Math.min(m, Math.max(c.at, tgt.b)), Infinity);
    const room = Math.max(0, Math.min(LRFx.tailOf(list), next - tgt.b)), n = Math.min(y.length, Math.round((dur + room) * R));
    const fade = Math.min(n, Math.round(R * 0.03)); for (let i = 0; i < fade; i++) y[n - 1 - i] *= i / fade;   // no click where a tail is cut
    const name = "fx-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + Math.random().toString(36).slice(2, 5) + ".wav";
    const w = await LRAudio.WavWriter.create(d, name, R);
    for (let o = 0; o < n; o += R * 2) w.push(y.slice(o, Math.min(n, o + R * 2)));
    await w.close(); B.peaks[name] = { mm: w.mm };
    return { file: name, off: 0, dur: n / R, at: 0, fx: list.map(e => e.k) };
  }
  async function applyFx(list, tgt) {
    if (B.rec || B.busy) return;
    tgt = tgt || fxTarget(fxTi());
    if (!tgt || !T().extract(B.audio, tgt.ti, tgt.a, tgt.b).length) { toast("There's no audio there on track " + ((tgt ? tgt.ti : fxTi()) + 1) + " to change."); return; }
    stopPreview(); B.player.stop(); B.busy = "fx"; renderSide();
    try {
      const clip = await processRegion(list, tgt);
      pushUndo(); T().overwrite(B.audio, tgt.ti, [clip], tgt.a);
      B.lastFx = list.map(e => ({ k: e.k, p: Object.assign({}, e.p) })); B.sel = { a: tgt.a, b: tgt.a + clip.dur }; B.track = tgt.ti;
      notice("🎛 " + list.map(e => LRFx.KINDS[e.k].name).join(" + ") + " applied. Undo brings the original back.");
    } catch (e) { console.error(e); toast("That effect failed: " + e.message); }
    B.busy = null; busyNote(""); edited(); renderSide();
  }
  function fxLast() {
    if (!B.lastFx) { toast("Apply an effect from Tools → Effects first; then " + kl("fxLast") + " repeats it."); return; }
    let tgt = null; const ti = B.track;
    if (B.sel || B.selTake) tgt = fxTarget(ti);
    else { const ci = T().clipAt(B.audio, ti, B.playhead != null ? B.playhead : -1); if (ci >= 0) { const c = B.audio.tracks[ti].clips[ci]; tgt = { ti, a: c.at, b: c.at + c.dur }; } }
    if (!tgt) { toast("Select a passage, or put the playhead on a take, then press " + kl("fxLast") + "."); return; }
    applyFx(B.lastFx, tgt);
  }
  function armFx(kind, on) {
    const st = trackSet()[fxTi()]; st.armed = (st.armed || []).filter(e => e.k !== kind);
    if (on) { st.armed.push({ k: kind, p: Object.assign({}, B.fxp[kind]) }); notice("⏻ " + LRFx.KINDS[kind].name + " armed on " + (st.name || "track " + (fxTi() + 1)) + ": new takes there get it when you press Stop."); }
    Store.saveBook(B.book); renderSide(); renderHeads();
  }
  async function previewFx(kind) {
    if (B.preview) { const was = B.preview.k; stopPreview(); renderSide(); if (was === kind) return; }
    const tgt = fxTarget(fxTi()); if (!tgt) { toast("There's no audio on track " + (fxTi() + 1) + " to preview."); return; }
    B.player.stop(); B.busy = "preview"; renderSide();
    try {
      const a = tgt.a, b = Math.min(tgt.b, tgt.a + 20), list = [{ k: kind, p: Object.assign({}, B.fxp[kind]) }];
      const dry = await LRAudio.renderRange(await dir(), B.audio.tracks[tgt.ti].clips, a, b - a);
      const y = await LRFx.runList(list, dry, RATE(), q => busyNote("Preparing preview… " + Math.round(q * 100) + "%"));
      const ctx = new AudioContext({ sampleRate: RATE() }), buf = ctx.createBuffer(1, y.length, RATE()); buf.copyToChannel(y, 0);
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
      B.preview = { k: kind, ctx }; src.onended = () => { if (B && B.preview && B.preview.ctx === ctx) { stopPreview(); renderSide(); } };
    } catch (e) { toast("Preview failed: " + e.message); }
    B.busy = null; busyNote(""); renderSide();
  }
  function stopPreview() { if (B && B.preview) { B.preview.ctx.close().catch(() => {}); B.preview = null; } }
  // armed effects run on each new take when you press Stop
  async function processArmed(file) {
    const ts = trackSet(); let done = 0;
    for (let ti = 0; ti < B.audio.tracks.length; ti++) {
      const list = (ts[ti] || {}).armed || []; if (!list.length) continue;
      const tr = B.audio.tracks[ti];
      for (const c of tr.clips.filter(c => c.file === file)) {
        B.fxBusy = ti; drawWave();     // a small "🎛 …" on the take's label while it works, nothing else
        const nc = await processRegion(list, { ti, a: c.at, b: c.at + c.dur });
        Object.assign(c, { file: nc.file, off: 0, dur: nc.dur, fx: nc.fx, src: { file: file, off: c.off, dur: c.dur } });
        done++;
      }
    }
    B.fxBusy = null; busyNote(""); if (B) drawWave();
    return done;
  }
  function chainChanged() { if (B.player.playing) { B.playhead = B.player.time; togglePlay(true); } }
  function savePreset() {
    const st = trackSet()[fxTi()], name = (prompt("Name this voice preset (it saves the track's armed effects and track sound):", st.name || "") || "").trim(); if (!name) return;
    const ps = Store.settings.fxPresets = Store.settings.fxPresets || {};
    ps[name] = { armed: JSON.parse(JSON.stringify(st.armed || [])), chain: JSON.parse(JSON.stringify(LRFx.chainOf(st))) };
    Store.saveSettings(); renderSide(); notice("Saved the voice preset “" + name + "”.");
  }
  function loadPreset(name) {
    const pr = (Store.settings.fxPresets || {})[name]; if (!pr) return;
    const st = trackSet()[fxTi()]; st.armed = JSON.parse(JSON.stringify(pr.armed || [])); st.chain = JSON.parse(JSON.stringify(pr.chain || LRFx.CHAIN_DEFAULT()));
    Store.saveBook(B.book); chainChanged(); renderSide(); renderHeads(); notice("“" + name + "” is on " + (st.name || "track " + (fxTi() + 1)) + ".");
  }

