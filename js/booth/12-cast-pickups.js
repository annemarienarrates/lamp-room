/* booth/12-cast-pickups.js — Outside cast and pickups; the Booth's public face (window.Booth).
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= outside cast & pickups =======================
  // other readers' runs in any chapter (the same rule theirRuns uses for the open one)
  function runsIn(chap) {
    if (chap === B.chap) return allRuns();
    const toks = Prep.tokens(chap), out = []; let cur = null;
    toks.forEach((t, i) => { const r = isMine(t, chap) ? null : Prep.readerOf(t.part, chap, B.book);
      if (r && cur && cur.r === r && cur.to === i - 1) cur.to = i; else if (r) { cur = { r, from: i, to: i }; out.push(cur); } else cur = null; });
    out.forEach(x => { x.text = toks.slice(x.from, x.to + 1).map(t => t.w).join(" "); x.words = x.to - x.from + 1; });
    return out;
  }
  // any audio file Chrome can read (WAV, MP3, M4A, AIFF, FLAC…) → mono at the studio rate
  async function decodeFile(file) {
    const ab = await new OfflineAudioContext(1, 1, LRAudio.RATE).decodeAudioData(await file.arrayBuffer());
    const n = ab.length, ch = ab.numberOfChannels, x = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / ch; }
    return x;
  }
  // 10 ms loudness frames over a whole buffer
  function envOf(x) {
    const hop = Math.round(LRAudio.RATE * 0.01), n = Math.floor(x.length / hop), env = new Float32Array(n), pk = new Float32Array(n);
    for (let k = 0; k < n; k++) { let s = 0, p = 0; for (let j = k * hop, e = j + hop; j < e; j++) { const v = x[j]; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; } env[k] = Math.sqrt(s / hop); pk[k] = p; }
    const sorted = Array.from(env).filter(v => v > 1e-6).sort((a, b) => a - b), floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 1e-4;
    let top = 0; for (let k = 0; k < n; k++) if (env[k] > top) top = env[k];
    // very clean audio (digital silence between lines) puts the floor at the voice itself: cap the threshold under the loudest speech
    return { env, pk, n, thr: Math.max(Math.min(floor * 3.5, top * 0.3), 0.0035) };
  }
  // Cut a cast member's file into lines. A click or clap between lines is the cleanest marker; with none, the pauses decide
  // (and if there are more stretches of speech than lines, the shortest pauses are joined until the count fits).
  function cutTakes(x, want) {
    const E = envOf(x), { env, pk, n, thr } = E, q = k => k < 0 || k >= n || env[k] < thr;
    // clicks: a burst of at most 0.1 s, sharp, with at least 0.25 s of quiet either side
    const clicks = [];
    for (let k = 1; k < n; k++) {
      if (env[k] < thr || !q(k - 1) || pk[k] < Math.max(0.05, thr * 12)) continue;
      let e = k; while (e < n && env[e] >= thr) e++;
      if (e - k > 10) { k = e; continue; }
      let ok = true; for (let j = 1; j <= 25 && ok; j++) ok = q(k - j - 1) && q(e + j - 1);
      if (ok) clicks.push([k, e]); k = e;
    }
    const isClick = k => clicks.some(([a, b]) => k >= a && k < b);
    // stretches of speech (gaps under 0.35 s don't split)
    const st = []; let a = -1, lastLoud = -1;
    for (let k = 0; k < n; k++) {
      const loud = env[k] >= thr && !isClick(k);
      if (loud) { if (a < 0) a = k; else if (k - lastLoud > 35) { st.push([a, lastLoud + 1]); a = k; } lastLoud = k; }
    }
    if (a >= 0) st.push([a, lastLoud + 1]);
    const speech = st.filter(([s, e]) => e - s >= 15);                    // ignore anything under 0.15 s
    let groups, mode;
    if (clicks.length) {
      mode = "clicks"; groups = [];
      const bounds = clicks.map(c => c[0]).concat([n + 1]); let gi = 0, cur = [];
      for (const s of speech) { while (s[0] >= bounds[gi]) { if (cur.length) groups.push(cur); cur = []; gi++; } cur.push(s); }
      if (cur.length) groups.push(cur);
    } else {
      mode = "pauses";
      groups = []; for (const s of speech) { const g = groups[groups.length - 1]; if (g && s[0] - g[g.length - 1][1] < 70) g.push(s); else groups.push([s]); }
      while (want && groups.length > want) {           // join across the shortest pause
        let bi = 0, bg = Infinity; for (let i = 0; i < groups.length - 1; i++) { const gap = groups[i + 1][0][0] - groups[i][groups[i].length - 1][1]; if (gap < bg) { bg = gap; bi = i; } }
        groups.splice(bi, 2, groups[bi].concat(groups[bi + 1]));
      }
    }
    const segs = groups.map(g => {
      let parts = g, check = "";
      if (mode === "clicks") {                          // a re-read inside one click-section: keep the last read
        const reads = [[g[0]]]; for (let i = 1; i < g.length; i++) { if (g[i][0] - g[i - 1][1] >= 150) reads.push([]); reads[reads.length - 1].push(g[i]); }
        if (reads.length > 1) { parts = reads[reads.length - 1]; check = "kept the last of " + reads.length + " reads"; }
      }
      return { a: parts[0][0] * 0.01, b: parts[parts.length - 1][1] * 0.01, check };
    });
    const L = x.length / LRAudio.RATE;
    segs.forEach((s, i) => { const lo = i ? segs[i - 1].b : 0, hi = i < segs.length - 1 ? segs[i + 1].a : L;
      let a2 = Math.max(lo, s.a - 0.12), b2 = Math.min(hi, s.b + 0.25);
      for (const [c0, c1] of clicks) { const ct0 = c0 * 0.01, ct1 = c1 * 0.01 + 0.05; if (ct1 <= s.a && ct1 > a2) a2 = ct1; if (ct0 >= s.b && ct0 < b2) b2 = ct0; }
      s.a = a2; s.b = b2; });
    if (want && segs.length !== want) segs.forEach(s => { if (!s.check) s.check = "count off"; });
    return { segs, mode, clicks: clicks.length };
  }
  async function writeSeg(d, name, x, a, b) {
    const R = LRAudio.RATE, seg = x.slice(Math.round(a * R), Math.round(b * R)), fade = Math.min(seg.length >> 1, Math.round(R * 0.012));
    for (let k = 0; k < fade; k++) { seg[k] *= k / fade; seg[seg.length - 1 - k] *= k / fade; }
    const w = await LRAudio.WavWriter.create(d, name, R); w.push(seg); await w.close();
    return seg.length / R;
  }
  function pickAudioFile() {
    return new Promise(res => {
      let inp = document.getElementById("lr-audio-in"); if (inp) inp.remove();
      inp = document.createElement("input"); inp.type = "file"; inp.id = "lr-audio-in"; inp.accept = "audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac,.ogg"; inp.style.display = "none";
      inp.onchange = () => res(inp.files[0] || null); document.body.appendChild(inp); inp.click();
    });
  }
  const spillOn = () => (Store.settings.duet || {}).spill === true;
  // a recording from outside the Lamp Room → that reader's lines, in this chapter (and on into the next ones if it runs on)
  async function castDrop(r, file, spill) {
    if (B.rec || B.busy || !file) return;
    if (!(await ensureStudio())) return;
    if (spill == null) spill = spillOn();
    B.busy = "cast"; renderSide(); busyNote("Reading " + file.name + "…");
    try {
      const x = await decodeFile(file);
      const targets = [];
      for (let ci = B.ci; ci < B.book.chapters.length; ci++) { const c = B.book.chapters[ci]; if (!c.included) continue; if (ci !== B.ci && !spill) break; runsIn(c).filter(z => z.r === r).forEach(run => targets.push({ ci, c, run })); }
      if (!targets.length) { toast(r + " has no lines here."); return; }
      busyNote("Finding " + r + "'s lines…");
      const { segs, mode, clicks } = cutTakes(x, targets.length), stamp = Date.now().toString(36), made = new Date().toISOString(), per = {};
      // which stretch is which line: by the words in it (retakes and skipped lines sort themselves out), or in order if it can't listen
      let pairs = null, byWords = false;
      if (window.LRProof && Store.lsGet("lr-castwords") !== "0") {
        try { pairs = await matchByWords(x, segs, targets, r); byWords = true; }
        catch (e) { console.warn(e); toast("Couldn't listen to the file (" + e.message + "), so lines were matched in order."); }
      }
      if (!pairs) pairs = segs.slice(0, targets.length).map((s, i) => [i, i]);
      const missing = targets.filter((t, j) => !pairs.some(p => p[1] === j));
      for (const t of targets) { const a = t.c === B.chap ? B.audio : (t.c.audio = t.c.audio || {}, t.c.audio[B.readingAs] = T().normalize(t.c.audio[B.readingAs])); const du = a.duet = a.duet || {}, rec = du[r] = du[r] || { lines: [] }; rec.missing = (rec.missing || []).filter(f => f !== t.run.from); }
      for (const t of missing) { const a = t.c === B.chap ? B.audio : t.c.audio[B.readingAs]; a.duet[r].missing.push(t.run.from); }
      const n = pairs.length;
      for (let k = 0; k < n; k++) {
        const [si, ti0] = pairs[k], i = k;
        const { ci, c, run } = targets[ti0], s = segs[si], d = await Store.chapterAudioDir(B.book, c);
        const name = "co-" + r.replace(/[^\w-]+/g, "") + "-" + stamp + "-" + String(i + 1).padStart(3, "0") + ".wav";
        const L0 = x.length / LRAudio.RATE, hin = Math.min(0.5, s.a), hout = Math.min(0.5, L0 - s.b);
        await writeSeg(d, name, x, s.a - Math.max(0, hin), s.b + Math.max(0, hout)); const dur = s.b - s.a;
        c.audio = c.audio || {}; const a = c === B.chap ? B.audio : (c.audio[B.readingAs] = T().normalize(c.audio[B.readingAs]));
        const du = a.duet = a.duet || {}, rec = du[r] = du[r] || { lines: [] };
        rec.lines = rec.lines.filter(l => l.from !== run.from);
        rec.lines.push({ n: i + 1, file: name, from: run.from, to: run.to, text: run.text, dur, hin: Math.max(0, hin), hout: Math.max(0, hout), check: s.check || undefined, src: file.name });
        rec.made = made; rec.got = made; per[ci] = (per[ci] || 0) + 1;
        busyNote("Cutting " + r + "'s lines… " + (i + 1) + " / " + n);
      }
      const extra = segs.length - n;
      Store.saveBook(B.book); B.peaks = B.peaks || {}; loadPeaks();
      const checks = pairs.filter(p => segs[p[0]].check).length, chs = Object.keys(per).map(ci => B.book.chapters[ci].title.replace(/^Chapter\s+/i, "Ch ") + ": " + per[ci]).join(", ");
      notice(`🎧 ${r}: ${n} line${n === 1 ? "" : "s"} cut ${mode === "clicks" ? "at " + clicks + " click" + (clicks === 1 ? "" : "s") : "at the pauses"}${byWords ? " and matched by their words" : ""} (${chs}).` +
        (byWords ? (extra > 0 ? ` ${extra} extra take${extra === 1 ? "" : "s"} or stray bit${extra === 1 ? "" : "s"} left out (the last good take of each line is kept).` : "") : (segs.length > targets.length ? ` ${segs.length - targets.length} more stretch${segs.length - targets.length === 1 ? "" : "es"} than lines: listen to the last few.` : "")) +
        (missing.length ? ` <b>${missing.length} line${missing.length === 1 ? "" : "s"} missing</b> from the file: Collaborate lists them, with Mark as pickups.` : "") +
        (checks ? ` ${checks} marked “check”.` : "") + (B.audio.markers.some(m => m.slot) ? " Splice all fills your slots." : ""));
      return { n, mode, clicks, segs: segs.length, want: targets.length };
    } catch (e) { console.error(e); toast("Couldn't read that file: " + e.message); }
    finally { B.busy = null; busyNote(""); renderSide(); }
  }
  // listen to each stretch and line them up with the script: in order, skipping missed lines, keeping the last of several takes
  async function matchByWords(x, segs, targets, r) {
    const R = LRAudio.RATE, heard = [];
    for (let i = 0; i < segs.length; i++) { busyNote("Listening to " + nm(r) + "'s file… " + (i + 1) + " / " + segs.length); heard.push(LRProof.split(await LRProof.hear(x.slice(Math.round(segs[i].a * R), Math.round(segs[i].b * R)), "careful"))); }
    const words = targets.map(t => t.run.text.split(/\s+/).filter(Boolean).map((w, i) => ({ w, i })));
    const score = (i, j) => { const tw = words[j]; if (!tw.length || !heard[i].length) return 0; const m = LRProof.matches(tw, heard[i]).length; return Math.min(m / tw.length, m / heard[i].length * 1.5); };
    const S = segs.length, N = targets.length, F = Array.from({ length: S + 1 }, () => new Float64Array(N + 1)), sc = Array.from({ length: S }, (_, i) => targets.map((_, j) => score(i, j)));
    for (let i = 1; i <= S; i++) for (let j = 1; j <= N; j++) { const v = sc[i - 1][j - 1]; F[i][j] = Math.max(F[i - 1][j], F[i][j - 1], v >= 0.45 ? F[i - 1][j - 1] + v + i * 1e-4 : -1); }
    const pairs = []; let i = S, j = N;
    while (i > 0 && j > 0) { const v = sc[i - 1][j - 1]; if (v >= 0.45 && Math.abs(F[i][j] - (F[i - 1][j - 1] + v + i * 1e-4)) < 1e-9) { pairs.push([i - 1, j - 1]); i--; j--; } else if (F[i][j] === F[i - 1][j]) i--; else j--; }
    return pairs.reverse();
  }
  async function markMissing(r) {
    const runs = theirRuns().filter(x => x.r === r && ((duetData()[r] || {}).missing || []).includes(x.from) && !lineFor(x));
    if (!runs.length) return;
    const list = pkMine().map(q => Object.assign({}, q)); let n = 0;
    for (const run of runs) { if (list.some(q => q.chapterId === B.chap.id && q.r === run.r && q.w0 === run.from && q.status === "open")) continue;
      list.push({ id: Prep.uid(), to: run.r, r: run.r, chapterId: B.chap.id, chapter: B.chap.title, w0: run.from, w1: run.to, text: run.text, ctx: B.toks.slice(Math.max(0, run.from - 12), run.from).map(t => t.w).join(" "), note: "Missing from your file", made: new Date().toISOString(), status: "open" }); n++; }
    await saveMine(list);
    toast("🔁 " + n + " missing line" + (n === 1 ? "" : "s") + " added to " + r + "'s pickups." + (isNarrator(r) ? "" : " Pickups ▸ Copy the list to send them."));
    renderSide();
  }
  // markers saved inside a WAV (Audition: Include markers and other metadata), in seconds
  async function wavMarkers(file) {
    try {
      const v = new DataView(await file.arrayBuffer()); if (v.getUint32(0, false) !== 0x52494646 || v.getUint32(8, false) !== 0x57415645) return [];
      let sr = 0, out = [], i = 12;
      while (i + 8 <= v.byteLength) {
        const id = String.fromCharCode(v.getUint8(i), v.getUint8(i + 1), v.getUint8(i + 2), v.getUint8(i + 3)), sz = v.getUint32(i + 4, true);
        if (id === "fmt ") sr = v.getUint32(i + 12, true);
        if (id === "cue ") { const n = v.getUint32(i + 8, true); for (let k = 0; k < n; k++) { const o = i + 12 + k * 24; if (o + 24 > v.byteLength) break; const pos = v.getUint32(o + 4, true), so = v.getUint32(o + 20, true); out.push(so || pos); } }
        i += 8 + sz + (sz & 1);
      }
      return sr ? out.map(x => x / sr).sort((a, b) => a - b) : [];
    } catch (e) { return []; }
  }
  // a marker inside a stretch of speech splits it there
  function splitAtMarks(segs, marks) {
    let out = segs.slice();
    for (const m of marks) { const k = out.findIndex(s => s.a + 0.2 < m && m < s.b - 0.2); if (k >= 0) { const s = out[k]; out.splice(k, 1, Object.assign({}, s, { b: m - 0.03 }), Object.assign({}, s, { a: m + 0.03 })); } }
    return out;
  }
  // my own lines, recorded somewhere else: cut, matched by words, laid on my track in reading order with word timing, so Send works as usual
  async function importMine(file) {
    if (B.rec || B.busy || !file) return;
    if (!(await ensureStudio())) return;
    const runs = myRuns(); if (!runs.length) { toast("You have no lines in this chapter."); return; }
    if (T().hasAudio(B.audio) && !confirm("This chapter already has audio. Replace it with the lines from " + file.name + "? (Undo brings it back.)")) return;
    B.busy = "import"; renderSide(); busyNote("Reading " + file.name + "…"); pushUndo();
    try {
      const R = LRAudio.RATE, x = await decodeFile(file), marks = await wavMarkers(file), L0 = x.length / R;
      const targets = runs.map(run => ({ ci: B.ci, c: B.chap, run }));
      let { segs, mode } = cutTakes(x, targets.length); segs = splitAtMarks(segs, marks);
      let pairs = null;
      if (window.LRProof && Store.lsGet("lr-castwords") !== "0") {
        try { pairs = await matchByWords(x, segs, targets, B.readingAs); } catch (e) { console.warn(e); toast("Couldn't listen to the file (" + e.message + "), so lines were matched in order."); }
      }
      if (!pairs) pairs = segs.slice(0, targets.length).map((s, i) => [i, i]);
      pairs.sort((p, q) => p[1] - q[1]);
      const d = await Store.chapterAudioDir(B.book, B.chap), stamp = Date.now().toString(36), clips = [], anchors = [];
      let at = 0.5, last = -1;
      for (let k = 0; k < pairs.length; k++) {
        const [si, ti] = pairs[k], s = segs[si], run = targets[ti].run, h0 = Math.min(0.15, s.a), h1 = Math.min(0.15, L0 - s.b);
        busyNote("Placing your lines… " + (k + 1) + " / " + pairs.length);
        const piece = x.slice(Math.round((s.a - h0) * R), Math.round((s.b + h1) * R)), name = "imp-" + stamp + "-" + String(k + 1).padStart(3, "0") + ".wav";
        const w = await LRAudio.WavWriter.create(d, name, R); w.push(piece); await w.close();
        const dur = piece.length / R; clips.push({ file: name, off: 0, dur, at });
        anchors.push([at + h0, run.from], [at + dur - h1, run.to + 1]); at += dur + 0.6; last = Math.max(last, run.to + 1);
      }
      B.audio.tracks = [{ clips }]; B.audio.anchors = anchors; B.audio.markers = [];
      const missing = targets.filter((t, j) => !pairs.some(p => p[1] === j));
      if (last > 0) { const p = prog(); advanced(p.readTo || 0, Math.max(p.readTo || 0, last)); p.pos = last; }
      flushSession(); edited(); loadPeaks();
      notice("📥 " + pairs.length + " of your " + targets.length + " lines brought in from " + file.name + (marks.length ? " (" + marks.length + " marker" + (marks.length === 1 ? "" : "s") + " used)" : "") + "." +
        (missing.length ? " Not in the file: " + missing.map(t => "“" + short(t.run.text, 6) + "”").join(", ") + ". Record those here, then send." : " Check it over, then send."));
    } catch (e) { toast("Couldn't bring that file in: " + e.message); }
    finally { B.busy = null; busyNote(""); renderSide(); renderTransport(); }
  }
  async function castDropPick(r) { const f = await pickAudioFile(); if (f) return castDrop(r, f); }

  // ---- pickups: the lead asks, the reader re-records and sends, it replaces the old line in the timeline ----
  const isNarrator = name => Store.settings.narrators.some(n => n.name === name);
  const pkAll = () => Store.pickupReqs(B.book);
  const pkMine = () => pkAll().filter(q => q.asker === B.readingAs);
  const pkForMe = () => pkAll().filter(q => q.to === B.readingAs && q.status === "open");
  const chIndex = id => B.book.chapters.findIndex(c => c.id === id);
  async function saveMine(list) { await Store.savePickupReqs(B.book, B.readingAs, list); }
  async function askPickup(run, note) {
    if (!run) return;
    const list = pkMine().map(q => Object.assign({}, q)), have = list.find(q => q.chapterId === B.chap.id && q.r === run.r && q.w0 === run.from && q.status === "open");
    if (have) { have.note = note || have.note; await saveMine(list); toast("Already asked: note updated."); return renderSide(); }
    const ctx = B.toks.slice(Math.max(0, run.from - 12), run.from).map(t => t.w).join(" ");
    list.push({ id: Prep.uid(), to: run.r, r: run.r, chapterId: B.chap.id, chapter: B.chap.title, w0: run.from, w1: run.to, text: run.text, ctx, note: note || "", made: new Date().toISOString(), status: "open" });
    await saveMine(list);
    toast(isNarrator(run.r) ? "🔁 Asked " + run.r + " for a pickup. It shows up on their Dashboard and in their Booth." : "🔁 Added to " + run.r + "'s pickup list. Pickups ▸ Copy the list to send it to them.");
    renderSide();
  }
  function askPickupPrompt(run) { if (!run) return; const note = window.prompt("Pickup for " + run.r + ":\n“" + short(run.text, 20) + "”\n\nA note for them (optional):", ""); if (note === null) return; return askPickup(run, note.trim()); }
  async function cancelPickup(id) { const list = pkMine().map(q => Object.assign({}, q)), q = list.find(z => z.id === id); if (!q) return; q.status = "cancelled"; await saveMine(list.filter(z => z.status !== "cancelled" || z.id === id)); renderSide(); }
  // swap one placed line for its pickup: the timeline grows or shrinks by the difference, on every track
  function replaceClip(ti, ci, file, dur, id) {
    const a = B.audio, c = a.tracks[ti].clips[ci], at = c.at, od = c.dur;
    a.tracks[ti].clips.splice(ci, 1);
    if (dur > od) T().insertGap(a, at + od, dur - od); else if (dur < od) T().deleteRange(a, at + dur, at + od);
    T().overwrite(a, ti, [{ file, off: 0, dur, at: 0, line: c.line, pk: { id, old: { file: c.file, off: c.off, dur: c.dur } } }], at);
  }
  async function applyPickups(quiet) {
    if (!B || B.rec || B.busy) return 0;
    const todo = pkMine().filter(q => q.status === "open" && q.chapterId === B.chap.id && Store.pickupReply(B.book, q));
    if (!todo.length) return 0;
    const list = pkMine().map(q => Object.assign({}, q)), cd = await dir(); let put = 0, undone = false;
    for (const q of todo) {
      const rep = Store.pickupReply(B.book, q);
      try {
        const sd = await Store.pickupsDir(B.book, q.to), name = "pk-" + q.id + ".wav";
        const src = await (await sd.getFileHandle(rep.file)).getFile(), fh = await cd.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(src); await w.close();
        try { const ps = await (await sd.getFileHandle(rep.file.replace(/\.wav$/, ".peaks2"))).getFile(), ph = await cd.getFileHandle(name.replace(/\.wav$/, ".peaks2"), { create: true }), pw = await ph.createWritable(); await pw.write(ps); await pw.close(); } catch (e) {}
        const mk = q.mark && B.audio.markers.find(m => m.id === q.mark);
        if (mk) {            // the editor's pickup: it replaces the red zone on that actor's track, and the chapter fits around it
          if (!undone) { pushUndo(); undone = true; }
          const z = pkZone(mk), ti = pkTrack(z);
          T().deleteRange(B.audio, z.a, z.b); T().insertGap(B.audio, z.a, rep.dur);
          T().overwrite(B.audio, ti, [{ file: name, off: 0, dur: rep.dur, at: 0, pk: q.id }], z.a);
          B.audio.markers = B.audio.markers.filter(m => m.id !== mk.id);
        }
        const run = !mk && (theirRuns().find(x => x.r === q.to && x.from === q.w0) || theirRuns().find(x => x.r === q.to && x.text === q.text));
        if (run) {
          const p = placedClip(run);
          if (p) { if (!undone) { pushUndo(); undone = true; } replaceClip(p.ti, p.ci, name, rep.dur, q.id); }
          const du = duetData(), rec = du[run.r] = du[run.r] || { lines: [] };
          rec.lines = rec.lines.filter(l => l.from !== run.from); rec.lines.push({ n: 0, file: name, from: run.from, to: run.to, text: run.text, dur: rep.dur, pk: q.id });
        }
        const lq = list.find(z => z.id === q.id); lq.status = "in"; lq.in = new Date().toISOString(); put++;
      } catch (e) { console.warn("pickup", q.id, e); }
    }
    if (put) { await saveMine(list); B.peaks = B.peaks || {}; loadPeaks(); edited(); renderSide(); if (!quiet || put) notice("🔁 " + put + " pickup" + (put === 1 ? "" : "s") + " in, replacing the old read" + (put === 1 ? "" : "s") + (undone ? ". Undo takes them out." : ".")); }
    return put;
  }
  // the reader's side: record one pickup in a small booth of its own, then send it
  function pickupRecorder(q) {
    if (B.rec) return;
    const ov = document.createElement("div"); ov.className = "overlay pk-ov";
    let chunks = [], rec = false, t0 = 0, raf = 0, playCtx = null; const prevFrames = B.mic.onFrames;
    const total = () => chunks.reduce((a, c) => a + c.length, 0), joined = () => { const x = new Float32Array(total()); let o = 0; for (const c of chunks) { x.set(c, o); o += c.length; } return x; };
    const draw = () => {
      const has = total() > 0;
      ov.innerHTML = `<div class="card reader pk-card"><div class="pk-head"><b>🔁 Pickup for ${esc(q.asker)}</b><span class="muted">${esc(q.chapter || "")}</span></div>
        ${q.ctx ? `<div class="pk-ctx">…${esc(q.ctx)}</div>` : ""}<div class="pk-line">${esc(q.text)}</div>
        ${q.note ? `<div class="pk-note">“${esc(q.note)}” — ${esc(q.asker)}</div>` : ""}
        <div class="pk-meter"><i id="pk-lvl"></i></div><div class="pk-time" id="pk-time">${(total() / LRAudio.RATE).toFixed(1)} s</div>
        <div class="row pk-btns"><button class="btn ${rec ? "" : "primary"}" data-k="rec">${rec ? "■ Stop (S)" : has ? "● Record again (R)" : "● Record (R)"}</button><button class="btn" data-k="play" ${has && !rec ? "" : "disabled"}>▶ Listen</button>
          <div class="spacer"></div><button class="btn quiet" data-k="x">Close</button><button class="btn primary" data-k="send" ${has && !rec ? "" : "disabled"}>✓ Send to ${esc(q.asker)}</button></div></div>`;
    };
    const book = B.book, me = B.readingAs;
    const tick = () => { if (!B) { close(); return; } const l = $("#pk-lvl", ov), t = $("#pk-time", ov); if (l) l.style.width = Math.max(0, Math.min(100, (B.mic.level + 60) / 60 * 100)) + "%"; if (t && rec) t.textContent = (total() / LRAudio.RATE).toFixed(1) + " s"; raf = requestAnimationFrame(tick); };
    const stopPlay = () => { if (playCtx) { playCtx.close().catch(() => {}); playCtx = null; } };
    const start = async () => { if (!(await ensureMic())) return; stopPlay(); chunks = []; rec = true; B.mic.onFrames = f => { if (rec) chunks.push(new Float32Array(f)); }; draw(); };
    const stop = () => { rec = false; B.mic.onFrames = prevFrames; draw(); };
    const close = () => { rec = false; stopPlay(); cancelAnimationFrame(raf); document.removeEventListener("keydown", key, true); if (B) B.mic.onFrames = prevFrames; ov.remove(); };
    let sending = false;
    const play = () => { stopPlay(); const x = joined(); if (!x.length) return; playCtx = new AudioContext({ sampleRate: LRAudio.RATE }); const buf = playCtx.createBuffer(1, x.length, LRAudio.RATE); buf.copyToChannel(x, 0); const s = playCtx.createBufferSource(); s.buffer = buf; s.connect(playCtx.destination); s.start(); };
    const send = async () => {
      if (sending) return; sending = true; const sb = $("[data-k=send]", ov); if (sb) { sb.disabled = true; sb.textContent = "Sending…"; }
      const x = joined(), E = envOf(x); let f = 0, l = E.n - 1; while (f < E.n && E.env[f] < E.thr) f++; while (l > f && E.env[l] < E.thr) l--;
      if (f >= E.n) { sending = false; draw(); toast("That take is silent. Check the microphone and record again."); return; }
      const a = Math.max(0, f * 0.01 - 0.15), b = Math.min(x.length / LRAudio.RATE, (l + 1) * 0.01 + 0.3);
      try { const d = await Store.pickupsDir(book, me, true), name = q.id + ".wav", dur = await writeSeg(d, name, x, a, b);
        await Store.savePickupReply(book, me, q.id, { file: name, dur, made: new Date().toISOString() });
        close(); if (!B) return; renderSide(); const left = pkForMe().filter(z => !Store.pickupReply(B.book, z)).length;
        if (window.LRCele && !left) LRCele.celebrate({ title: "PICKUPS SENT", sub: "All of them, to " + q.asker, level: 1, noConfetti: true }); else notice("✓ Sent to " + q.asker + "." + (left ? " " + left + " to go." : ""));
      } catch (e) { sending = false; toast("Couldn't send it: " + e.message); if (B) draw(); }
    };
    const key = e => { if (e.target.closest && e.target.closest("input,textarea")) return; const k = e.key.toLowerCase();
      if (k === "r" && !rec) { e.preventDefault(); e.stopImmediatePropagation(); start(); } else if ((k === "s" || k === " ") && rec) { e.preventDefault(); e.stopImmediatePropagation(); stop(); }
      else if (k === "escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } else if (["r", "s", " ", "f", "m", "n", "c", "e"].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); } };
    ov.onclick = e => { const b = e.target.closest("[data-k]"); if (!b || b.disabled) return; ({ rec: () => rec ? stop() : start(), play, send, x: close })[b.dataset.k](); };
    document.addEventListener("keydown", key, true);
    draw(); document.body.appendChild(ov); tick();
    return { start, stop, send, close, get chunks() { return chunks; } };
  }
  // outside cast: a list to send them, and their pickups file back in
  function castPickupList(r) {
    const qs = pkMine().filter(q => q.to === r && q.status === "open" && !Store.pickupReply(B.book, q)).sort((a, b) => chIndex(a.chapterId) - chIndex(b.chapterId) || a.w0 - b.w0);
    return { qs, text: `Pickups for ${B.book.title} — ${r}\nRecord them in this order, with a click (or a clap) between each one.\n\n` + qs.map((q, i) => `${i + 1}. ${q.chapter}: ${qt(q.text)}${q.note ? "\n   Note: " + q.note : ""}`).join("\n") };
  }
  async function copyCastList(r) { const { qs, text } = castPickupList(r); if (!qs.length) { toast("Nothing waiting for " + r + "."); return; } try { await navigator.clipboard.writeText(text); notice("📋 " + qs.length + " pickup" + (qs.length === 1 ? "" : "s") + " for " + r + " copied. Paste it into an email or message."); } catch (e) { toast("Couldn't copy: " + e.message); } return text; }
  async function castPickupDrop(r, file) {
    if (!(await ensureStudio())) return;
    const { qs } = castPickupList(r); if (!qs.length || !file || B.busy) { if (!qs.length) toast("No open pickups for " + r + "."); return; }
    B.busy = "cast"; renderSide(); busyNote("Reading " + file.name + "…");
    try {
      const x = await decodeFile(file), { segs, mode } = cutTakes(x, qs.length), d = await Store.pickupsDir(B.book, r, true), n = Math.min(segs.length, qs.length);
      for (let i = 0; i < n; i++) { const name = qs[i].id + ".wav", dur = await writeSeg(d, name, x, segs[i].a, segs[i].b); await Store.savePickupReply(B.book, r, qs[i].id, { file: name, dur, made: new Date().toISOString(), src: file.name }); }
      notice(`🔁 ${n} of ${qs.length} pickup${qs.length === 1 ? "" : "s"} from ${r} cut ${mode === "clicks" ? "at the clicks" : "at the pauses"}.` + (segs.length !== qs.length ? ` The file had ${segs.length}: listen to them.` : "") + " Each goes in when you open its chapter.");
    } catch (e) { toast("Couldn't read that file: " + e.message); }
    finally { B.busy = null; busyNote(""); renderSide(); }
    await applyPickups();
  }
  async function playPickupReply(q, key) {
    const rep = Store.pickupReply(B.book, q); if (!rep) return;
    try { const d = await Store.pickupsDir(B.book, q.to); const x = await LRAudio.renderRange(d, [{ file: rep.file, off: 0, dur: rep.dur, at: 0 }], 0, rep.dur); stopLine();
      const ctx = new AudioContext({ sampleRate: LRAudio.RATE }), buf = ctx.createBuffer(1, x.length, LRAudio.RATE); buf.copyToChannel(x, 0); const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(); B.coPlay = ctx;
      if (key) { B.audKey = key; paintAud(); } s.onended = () => { if (B && B.coPlay === ctx) stopLine(); }; } catch (e) { stopLine(); toast(e.message); }
  }
  function pickupsAskedHtml() {
    const dis = B.rec || B.busy ? "disabled" : "";
    const forMe = pkForMe().sort((a, b) => chIndex(a.chapterId) - chIndex(b.chapterId) || a.w0 - b.w0);
    let h = "";
    if (forMe.length) {
      const left = forMe.filter(q => !Store.pickupReply(B.book, q)).length;
      h += `<div class="bd-sec pk-sec"><b>Asked of you (${left} to do)</b><div class="stu-note">Re-record each one and press Send. It goes straight into ${esc(forMe[0].asker)}'s chapter.</div>
        ${forMe.map(q => { const sent = Store.pickupReply(B.book, q); return `<div class="co-line ${sent ? "placed" : ""}"><span class="n">${sent ? "✓" : "🔁"}</span><span>${esc(qt(short(q.text, 16)))}<br><i>${esc(q.chapter || "")}${q.note ? " · “" + esc(short(q.note, 12)) + "”" : ""}${sent ? " · sent" : ""}</i></span>
          <span class="fx-chips"><button class="stu-btn ${sent ? "" : "stu-rec"}" data-p="pkrec:${q.id}" ${dis}>${sent ? "Redo" : "🎙 Record"}</button></span></div>`; }).join("")}</div>`;
    }
    const mine = pkMine().filter(q => q.status !== "cancelled");
    if (mine.length) {
      const by = {}; mine.forEach(q => (by[q.to] = by[q.to] || []).push(q));
      h += `<div class="bd-sec pk-sec"><b>Asked of others</b>` + Object.keys(by).map(r => {
        const qs = by[r].sort((a, b) => chIndex(a.chapterId) - chIndex(b.chapterId) || a.w0 - b.w0), waiting = qs.filter(q => q.status === "open" && !Store.pickupReply(B.book, q)).length;
        return `<div class="pk-who"><b>${esc(nm(r))}</b> <span class="muted">${waiting ? waiting + " waiting" : "nothing waiting"}</span>${isNarrator(r) ? "" : `<div class="fx-chips"><button class="stu-btn" data-p="pkcopy:${esc(r)}" ${waiting ? "" : "disabled"}>📋 Copy the list</button><button class="stu-btn" data-p="pkdrop:${esc(r)}" ${dis} ${waiting ? "" : "disabled"}>🎧 Drop in their pickups…</button></div>`}</div>` +
          qs.map(q => { const rep = Store.pickupReply(B.book, q), here = q.chapterId === B.chap.id, st = q.status === "in" ? "in" : rep ? "arrived" : "waiting";
            return `<div class="co-line ${st === "in" ? "placed" : st === "arrived" ? "" : "slot"}"><span class="n">${st === "in" ? "✓" : st === "arrived" ? "⬇" : "…"}</span><span>${esc(qt(short(q.text, 14)))}<br><i>${esc(q.chapter || "")} · ${st}${q.note ? " · “" + esc(short(q.note, 10)) + "”" : ""}</i></span>
              <span class="fx-chips">${rep ? audBtn("pk:" + q.id, `data-p="pkplay:${q.id}"`, "Listen") : ""}${st === "arrived" ? (here ? `<button class="stu-btn stu-rec" data-p="pkin" ${dis}>Put in</button>` : `<button class="stu-btn" data-ci="${chIndex(q.chapterId)}" title="Open that chapter: it goes in">go</button>`) : ""}${q.status === "open" ? `<button class="stu-btn" data-p="pkcancel:${q.id}" title="Never mind">✕</button>` : ""}</span></div>`; }).join("");
      }).join("") + `</div>`;
    }
    return h;
  }

  window.Booth = { open, close, get state() { return B; }, ACTIONS, keyLabel: a => kl(a) };
  // Test hooks exist only in ?test mode, so the everyday app carries no back door.
  if (/[?&]test\b/.test(location.search)) window.Booth._test = { markPos, everyoneRuns, renderCueWin, importMine, wavMarkers, sendToShared, bringInSends, trackSet, pkZone, heard, nextSentence, chapterComplete, mapChapter, findInBook, goHit, replaceSel, unpackOrig, proofChapter, skipLine, recutOf, swapRecut, selLine, renderLineEd, liveDrop, selectTake: (a,b) => selectTake(a,b), act, cutTakes, findPauses, evenPauses, learnTone, addSpace, drawWave,  castDrop, castPickupDrop, askPickup, applyPickups, pickupRecorder, pkForMe, pkMine, copyCastList, castPickupList, runsIn, decodeFile, theirRuns, myRuns, sendLines, bringLines, spliceAll, duetClick, checkGoals, chapterComplete, amLead, applyFx, armFx, previewFx, deleteTake, selectTake, gainSel, acxCheck, setReader, fxLast, act, keys, swapAlt, nextRecStart0, undo, redo, heard, flub, punchAt, stopRecording, startRecording, recordToggle, addMarker, clickWord, switchTrackLive, cut, copy, paste, deleteSel, splitHere, selectAll, addTrack, exportDialog, mix, len, seek, clockState };
})();
