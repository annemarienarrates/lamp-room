/* booth/07-duets.js — Duets: dropping the co-narrator's lines in, sending mine, bringing theirs in.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= duets: the co-narrator's lines =======================
  // A "run" is a stretch of one reader's words with nobody else's in between. The chapter's narrator is the lead: they
  // record straight through and their co-narrator's runs drop in as lines. The co-narrator records their runs and sends
  // them: each run is cut from their recording by its word timing and the pauses around it.
  // a timeline built from everyone's shares gets the lead's view (to drop in the cast who don't use the Lamp Room)
  const amLead = () => (Prep.readerOf("n", B.chap, B.book) || B.readingAs) === B.readingAs || assembled();
  const runKey = x => x.r + ":" + x.from;
  function runsOf(pred) {
    const out = []; let cur = null;
    B.toks.forEach((t, i) => {
      const r = pred(i, t);
      if (r && cur && cur.r === r && cur.to === i - 1) cur.to = i;
      else if (r) { cur = { r, from: i, to: i }; out.push(cur); } else cur = null;
    });
    out.forEach(x => { x.text = B.toks.slice(x.from, x.to + 1).map(t => t.w).join(" "); x.words = x.to - x.from + 1; });
    return out;
  }
  // other readers' runs (what the lead waits for)
  // every reader's runs, mine included (what the editor assembles from)
  function everyoneRuns() { return runsOf((i, t) => Prep.readerOf(t.part, B.chap, B.book)); }
  function allRuns() { if (!B.runsCache || B.runsCache.v !== B.toks) B.runsCache = { v: B.toks, runs: runsOf((i, t) => B.mine[i] ? null : Prep.readerOf(t.part, B.chap, B.book)) }; return B.runsCache.runs; }
  // what I bring in by hand: everyone else's lines — or, in a timeline built from shares, only the cast outside the Lamp Room (the rest came in the shares)
  function theirRuns() { const r = allRuns(); return assembled() ? r.filter(x => outsideCast(x.r)) : r; }
  // my runs (what a co-narrator sends) — only in a chapter someone else narrates
  function myRuns() { return runsOf((i) => B.mine[i] ? B.readingAs : null); }
  const duetData = () => (B.audio.duet = B.audio.duet || {});
  const lineFor = x => ((duetData()[x.r] || {}).lines || []).find(l => l.from === x.from);
  function placedClip(x) {
    for (let ti = 0; ti < B.audio.tracks.length; ti++) { const ci = B.audio.tracks[ti].clips.findIndex(c => c.line && c.line.r === x.r && c.line.from === x.from); if (ci >= 0) return { ti, ci }; }
    return null;
  }
  const slotOf = x => B.audio.markers.find(m => m.slot && m.slot.r === x.r && m.slot.from === x.from);
  function coTrack(r) {
    const ts = trackSet(); let i = ts.findIndex((t, k) => k > 0 && t.name === r);
    if (i < 0) { i = ts.findIndex((t, k) => k > 0 && /^Track \d+$/.test(t.name || "") && !(B.audio.tracks[k] || { clips: [] }).clips.length); if (i >= 0) ts[i].name = r; }
    if (i < 0) { if (!addTrack(true)) return -1; i = ts.length - 1; ts[i].name = r; }
    return i;
  }
  const duetOpt = k => { const o = Store.settings.duet || {}; return o[k] !== false; };
  function setDuetOpt(k, v) { Store.settings.duet = Store.settings.duet || {}; Store.settings.duet[k] = v; Store.saveSettings(); }
  // hear a line in the headphones
  async function playLine(l, onEnd, key) {
    stopLine(); if (key) { B.audKey = key; paintAud(); }
    try {
      const x = await LRAudio.renderRange(await dir(), [{ file: l.file, off: l.hin || 0, dur: l.dur, at: 0 }], 0, l.dur);
      const ctx = new AudioContext({ sampleRate: LRAudio.RATE }), buf = ctx.createBuffer(1, x.length, LRAudio.RATE); buf.copyToChannel(x, 0);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const gn = ctx.createGain(); gn.gain.value = coVol(); src.connect(gn); gn.connect(ctx.destination); src.start();   // their line, at your headphone level
      B.coPlay = ctx; src.onended = () => { if (B && B.coPlay === ctx) stopLine(); onEnd && onEnd(); };
    } catch (e) { toast("Couldn't play that line: " + e.message); }
  }
  function stopLine() { if (B && B.coPlay) { B.coPlay.close().catch(() => {}); B.coPlay = null; } if (B && B.audKey && !String(B.audKey).startsWith("sm:")) { B.audKey = null; paintAud(); } }
  // a ▶ button that turns into ■ while its clip plays: one clip at a time
  const audBtn = (key, attr, tip) => `<button class="stu-btn${B.audKey === key ? " on" : ""}" ${attr} data-aud="${esc(key)}" title="${B.audKey === key ? "Stop" : tip || "Listen"}">${B.audKey === key ? "■" : "▶"}</button>`;
  function paintAud() { document.querySelectorAll("[data-aud]").forEach(b => { const on = b.dataset.aud === (B && B.audKey); b.textContent = on ? "■" : "▶"; b.classList.toggle("on", on); b.title = on ? "Stop" : (b.dataset.tip || "Listen"); }); }
  function stopSample() { if (B && B.charAudio) { B.charAudio.pause(); B.charAudio = null; } if (B && B.audKey && String(B.audKey).startsWith("sm:")) { B.audKey = null; paintAud(); } }
  function toggleAud(key, start) { const was = B.audKey === key; stopLine(); stopSample(); if (was) return; B.audKey = key; paintAud(); start(); }
  function duetBanner(title, text, secs, go) {
    let b = $("#duet-banner"); if (b) b.remove();
    const mode = Store.settings.duetCues || "full"; if (mode === "off") return null;
    b = document.createElement("div"); b.id = "duet-banner"; b.className = "duet-banner" + (go ? " go" : "") + (mode === "small" ? " small" : "");
    b.innerHTML = `<b>${esc(title)}</b>${text ? `<i>${esc(text)}</i>` : ""}${secs ? `<div class="db-bar"><span style="animation-duration:${secs}s"></span></div>` : ""}`;
    document.body.appendChild(b);
    clearTimeout(B.bannerT); B.bannerT = setTimeout(() => b.remove(), (secs || 2.2) * 1000);
    return b;
  }
  const short = (t, n) => { const w = t.split(" "); return w.length > n ? w.slice(0, n).join(" ") + "…" : t; };
  const qt = t => /^[“"‘']/.test(t) ? t : "“" + t + "”";

  // ---- while recording: drop their line in when you've read up to it and gone quiet ----
  function duetLive() {
    const r = B.rec; if (!r || r.paused || !amLead()) return;
    const cn = r.coNow; if (cn && !cn.skipped && B.f.pos >= cn.pos0 + 2) skipLine(cn.speak != null ? cn.speak : null, true);   // you've read on two words since it dropped
    if (!duetOpt("auto")) return;
    const now = r.clip.at + r.clip.dur;
    if (B.turnAt != null && r.loud > B.turnAt + 0.15) { const bn = $("#duet-banner.go"); if (bn) bn.remove(); B.turnAt = null; }
    if (r.coUntil && now < r.coUntil + 0.2) return;
    const pos = B.f.pos, x = theirRuns().find(x => x.from >= r.pos0 && x.from < pos && !r.handled.has(runKey(x)) && !placedClip(x));
    if (!x) return;
    const l = lineFor(x);
    if (!l) { liveSlot(x, Math.max(r.start, now - SYNC_LAT)); return; }
    if (now - Math.max(r.loud || 0, r.start) < 0.35) return;              // wait until you stop talking
    liveDrop(x, l, Math.min(now, Math.max(r.start, (r.loud || r.start) + 0.3)));
  }
  function liveDrop(x, l, t) {
    const r = B.rec; r.handled.add(runKey(x));
    const ti = coTrack(x.r); if (ti < 0 || ti === r.track) { toast("Their lines need a track of their own: record on track 1 and keep a track free for " + x.r + "."); return; }
    T().overwrite(B.audio, ti, [{ file: l.file, off: l.hin || 0, dur: l.dur, at: 0, line: { r: x.r, from: x.from } }], t);
    r.coUntil = t + l.dur;
    r.drops = r.drops || []; const drop = { t, dur: l.dur, ti, speak: null, x, pos0: B.f.pos }; r.drops.push(drop); r.coNow = drop;
    const sl = slotOf(x); if (sl) B.audio.markers = B.audio.markers.filter(m => m !== sl);
    if (window.LRCele) LRCele.comboHold(l.dur * 1000 + 6000);
    duetBanner(x.r.toUpperCase() + " · " + l.dur.toFixed(1) + " s", qt(short(x.text, 14)), l.dur);
    const yourTurn = () => { if (B && B.rec === r) { const nx = B.toks.slice(x.to + 1).findIndex((_, k) => B.mine[x.to + 1 + k]); const w = nx >= 0 ? B.toks.slice(x.to + 1 + nx, x.to + 1 + nx + 6).map(t => t.w).join(" ") : ""; duetBanner("YOUR TURN", w ? "“" + w + "…”" : "", turnSecs(), true); B.turnAt = r.clip.at + r.clip.dur; } if (r.coNow === drop) r.coNow = null; };
    drop.yourTurn = yourTurn;
    const bn = $("#duet-banner"); if (bn) { bn.classList.add("skippable"); bn.onclick = () => skipLine(); bn.insertAdjacentHTML("beforeend", `<div class="db-skip">Space or click to skip</div>`); }
    if (duetOpt("hear")) playLine(l, () => { if (!drop.skipped) yourTurn(); }); else drop.timer = setTimeout(() => { if (!drop.skipped) yourTurn(); }, l.dur * 1000);
    renderTransport();
  }
  // Space or a click while their line plays: carry on now. When you stop, your audio after this moment moves along by the
  // part you didn't wait for, so the chapter comes out exactly as if you'd waited.
  // at: when you started reading again (defaults to now, or to when you first spoke over it if that was earlier)
  function skipLine(at, auto) {
    const r = B && B.rec, d = r && r.coNow; if (!d || d.skipped) return false;
    const now = r.clip.at + r.clip.dur;
    let t = at != null ? at : now; if (at == null && d.speak != null && d.speak < t) t = d.speak;
    t = Math.max(d.t + 0.05, Math.min(now, t));
    const remain = d.t + d.dur - t; if (remain < 0.05) return false;
    d.skipped = true; clearTimeout(d.timer); stopLine();
    (r.skips = r.skips || []).push({ at: t, need: remain, ti: d.ti });
    r.coUntil = now; if (r.coNow === d) r.coNow = null;
    const bn = $("#duet-banner"); if (bn) bn.remove();
    if (auto) duetBanner("CARRY ON", "their line keeps its place; you land after it", 1.2, true); else d.yourTurn && d.yourTurn();
    return true;
  }
  const notice = m => { if (window.note) window.note(m); };
  const coVol = () => { const v = (Store.settings.duet || {}).vol; return v == null ? 0.6 : Math.max(0, Math.min(1, v)); };
  const turnSecs = () => { const v = (Store.settings.duet || {}).turn; return v == null ? 0.8 : Math.max(0.3, Math.min(3, v)); };
  function liveSlot(x, t) {
    const r = B.rec; r.handled.add(runKey(x));
    if (slotOf(x)) return;
    B.audio.markers.push({ id: Prep.uid(), t, w: x.from, ctx: short(x.text, 8), note: x.r + "'s line goes here", slot: { r: x.r, from: x.from, to: x.to }, done: false });
    B.audio.markers.sort((a, b) => a.t - b.t);
    duetBanner("SLOT FOR " + x.r.toUpperCase(), qt(short(x.text, 10)) + " · their audio isn't in yet; it splices in here later", 2.2);
  }
  // C: their next line, now (or a slot if it hasn't arrived); not recording: at the playhead
  async function duetClick() {
    if (!amLead() && myRuns().length) {            // reading your own lines: C marks "that line ends here" for the cutter
      const t = B.rec ? B.rec.clip.at + B.rec.clip.dur : B.playhead != null ? B.playhead : len();
      B.audio.markers.push({ id: Prep.uid(), t, w: B.f.pos, ctx: "", note: "✂ line ends", cut: true, done: true });
      B.audio.markers.sort((a, b) => a.t - b.t); if (!B.rec) Store.saveBook(B.book);
      const bn = duetBanner("✂ CUT", "", 0.6); return;
    }
    const runs = theirRuns().filter(x => !placedClip(x));
    if (!runs.length) { toast(theirRuns().length ? "Every co-narrator line in this chapter is already in." : "This chapter has no co-narrator lines."); return; }
    const pos = B.f.pos, ahead = runs.filter(x => x.to >= pos - 1 && !(B.rec && B.rec.handled.has(runKey(x)))), x = ahead.find(x => x.from - pos <= 40) || ahead[0] || runs[0];
    if (B.rec) {
      const r = B.rec, now = r.clip.at + r.clip.dur, l = lineFor(x);
      if (l) liveDrop(x, l, now); else liveSlot(x, now);
      return;
    }
    const l = lineFor(x); if (!l) { toast(x.r + "'s line “" + short(x.text, 8) + "” hasn't arrived yet."); return; }
    pushUndo();
    const t = await spliceAt(x, l, B.playhead != null ? B.playhead : len(), true);
    B.playhead = t + l.dur + 0.3; edited(); renderSide();
  }
  // put a line in after the fact: find the pause, open a gap on every track, drop the line into it
  async function spliceAt(x, l, near, exact) {
    const render = await mix(), L = len();
    let t = Math.min(near, L);
    if (!exact || L) t = await LRAudio.quietPoint(render, t, exact ? 0.6 : 0.2, exact ? 0.6 : 1.6);
    t = Math.max(0, Math.min(t, len()));
    const ti = coTrack(x.r);
    T().insertGap(B.audio, t, l.dur + 0.35);
    T().overwrite(B.audio, ti, [{ file: l.file, off: l.hin || 0, dur: l.dur, at: 0, line: { r: x.r, from: x.from } }], t);
    const sl = slotOf(x); if (sl) B.audio.markers = B.audio.markers.filter(m => m !== sl);
    return t;
  }
  async function spliceAll() {
    if (B.rec || B.busy) return;
    const todo = theirRuns().filter(x => !placedClip(x) && lineFor(x));
    if (!todo.length) { toast("Nothing to splice: every line that has arrived is already in."); return; }
    B.busy = "splice"; pushUndo(); let done = 0, missed = 0;
    for (const x of todo) {
      busyNote("Splicing " + x.r + "'s lines… " + (done + missed + 1) + " / " + todo.length);
      const sl = slotOf(x), an = (B.audio.anchors || []).find(p => p[1] > x.from);
      const near = sl ? sl.t : an ? an[0] : null;
      if (near == null || near > len() + 0.5) { missed++; continue; }
      await spliceAt(x, lineFor(x), near, false); done++;
    }
    B.busy = null; busyNote(""); edited(); renderSide();
    notice("⤓ " + done + " line" + (done === 1 ? "" : "s") + " spliced in" + (missed ? ". " + missed + " couldn't be placed (no word timing there yet): put the playhead where each goes and press " + kl("click") + "." : "."));
  }
  function unplace(x) { const p = placedClip(x); if (p) deleteTake(p.ti, p.ci); }

  // ---- the co-narrator's side: cut my runs out of my recording and send them ----
  async function envelope(render, L) {
    const R = LRAudio.RATE, hop = Math.round(R * 0.01), env = new Float32Array(Math.ceil(L / 0.01) + 1);
    for (let t = 0, k = 0; t < L; t += 10) {
      const x = await render(t, Math.min(10, L - t));
      for (let i = 0; i < x.length; i += hop, k++) { let s = 0; const e = Math.min(x.length, i + hop); for (let j = i; j < e; j++) s += x[j] * x[j]; env[k] = Math.sqrt(s / Math.max(1, e - i)); }
      busyNote("Listening through your take… " + Math.round(100 * Math.min(1, (t + 10) / L)) + "%");
    }
    const sorted = Array.from(env).filter(v => v > 1e-6).sort((a, b) => a - b), floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 1e-4;
    return { env, thr: Math.max(floor * 3.5, 0.0035) };
  }
  // seconds → frames helpers over the envelope: find a quiet stretch of at least `need` seconds
  function quietBack(E, t, need, stop) { const thr = E.thr, n = Math.round(need / 0.01); let k = Math.floor(t / 0.01), run = 0; for (; k > Math.floor(stop / 0.01); k--) { if (E.env[k] < thr) { if (++run >= n) return (k + n) * 0.01; } else run = 0; } return stop; }
  function quietFwd(E, t, need, stop) { const thr = E.thr, n = Math.round(need / 0.01); let k = Math.ceil(t / 0.01), run = 0; const end = Math.min(E.env.length - 1, Math.floor(stop / 0.01)); for (; k < end; k++) { if (E.env[k] < thr) { if (++run >= n) return (k - n) * 0.01; } else run = 0; } return stop; }
  async function sendLines(copyTo) {
    if (B.rec || B.busy) return;
    if (amLead()) { toast("You narrate this chapter, so you're the lead: their lines come to you."); return; }
    const runs = myRuns(), L = len();
    if (!runs.length) { toast("You have no lines in this chapter."); return; }
    if (!L) { toast("Record your lines first, then send them."); return; }
    B.busy = "send"; renderSide();
    try {
      const render = await mix(), E = await envelope(render, L), A = B.audio.anchors || [];
      const heardAt = w => { const p = A.find(p => p[1] > w); return p ? p[0] : null; };
      // where each run sits in my recording, from my word timing; refined to the pauses around it
      const spans = runs.map(x => ({ x, a: heardAt(x.from), b: heardAt(x.to) }));
      let timed = spans.filter(s => s.a != null && s.b != null).length;
      if (timed < spans.length) {
        // no follow-along timing for some: fall back to the stretches of speech, in order
        const segs = []; let inS = false, s0 = 0;
        for (let k = 0; k < E.env.length; k++) { const loud = E.env[k] >= E.thr; if (loud && !inS) { inS = true; s0 = k * 0.01; } if (!loud && inS) { const q = quietFwd(E, k * 0.01, 0.7, k * 0.01 + 0.7); if (q < k * 0.01 + 0.69) continue; inS = false; segs.push([s0, k * 0.01]); } }
        if (inS) segs.push([s0, L]);
        const merged = segs.filter(s => s[1] - s[0] > 0.25);
        spans.forEach((s, i) => { if (s.a == null || s.b == null) { const g = merged[i]; if (g) { s.a = g[0] + 0.3; s.b = g[1] - 0.05; s.guess = true; } } });
      }
      // ✂ marks from C: when there's one between every line, they decide the cuts outright
      const cuts = B.audio.markers.filter(m => m.cut).map(m => m.t).sort((a, b) => a - b);
      if (cuts.length) {
        const bounds = [0].concat(cuts, [L]), segs = [];
        for (let i = 0; i < bounds.length - 1; i++) {
          let f = Math.round(bounds[i] / 0.01), l = Math.round(bounds[i + 1] / 0.01) - 1; while (f < l && E.env[f] < E.thr) f++; while (l > f && E.env[l] < E.thr) l--;
          if (l - f >= 15) segs.push([f * 0.01, (l + 1) * 0.01, bounds[i], bounds[i + 1]]);
        }
        if (segs.length === spans.length) spans.forEach((s, i) => { s.a = segs[i][0] + 0.3; s.b = segs[i][1] - 0.05; s.lo = segs[i][2]; s.hi = segs[i][3]; s.guess = false; s.cut = true; });
        else spans.forEach(s => { if (s.a == null) return; const lo = cuts.filter(c => c <= s.a).pop(), hi = cuts.find(c => c >= s.b); if (lo != null) s.lo = lo; if (hi != null) s.hi = hi; });
      }
      const out = [];
      spans.forEach((s, i) => {
        if (s.a == null) return;
        const prevEnd = i ? (out.length ? out[out.length - 1].b : 0) : 0, nextA = spans.slice(i + 1).find(z => z.a != null);
        const a = Math.max(prevEnd, quietBack(E, Math.max(0, s.a - 0.35), 0.22, Math.max(prevEnd, s.a - 6)) - 0.12);
        const b = Math.min(nextA ? nextA.a - 0.6 : L, quietFwd(E, Math.max(s.b - 0.15, a + 0.2), 0.38, Math.min(L, s.b + 6)) + 0.2);
        let a2 = Math.max(0, a), b2 = Math.min(L, Math.max(b, a + 0.25));
        if (s.lo != null) a2 = Math.max(a2, s.lo + 0.05); if (s.hi != null) b2 = Math.min(b2, s.hi - 0.03);
        out.push({ x: s.x, a: a2, b: Math.max(b2, a2 + 0.25), guess: s.guess });
      });
      // A re-send never reuses a file name and never deletes lines.json: Drive trips over a file deleted and written
      // again under the same name (it makes "line-008 (1).wav" and can lose the index). New lines go under a fresh
      // prefix, lines.json is overwritten in place, and only then are the old files cleared away.
      const d = await Store.duetDir(B.book, B.chap, B.readingAs, true), sh = await Store.sharedLinesDir(B.book, B.chap, B.readingAs, true);
      copyTo = [copyTo, sh].filter(Boolean);
      const R = LRAudio.RATE, lines = [], tag = Date.now().toString(36);
      for (let i = 0; i < out.length; i++) {
        // each line carries ~0.6 s of handle either side, hidden: drag its edge out on the lead's side to get a clipped word back
        const o = out[i], n = i + 1, file = tag + "-line-" + String(n).padStart(3, "0") + ".wav", hin = Math.min(0.6, o.a), hout = Math.min(0.6, Math.max(0, L - o.b)), x = await render(o.a - hin, o.b - o.a + hin + hout);
        const fade = Math.min(x.length, Math.round(R * 0.012)); for (let k = 0; k < fade; k++) { x[k] *= k / fade; x[x.length - 1 - k] *= k / fade; }
        for (const dd of [d].concat(copyTo)) { const w = await LRAudio.WavWriter.create(dd, file, R); w.push(x); await w.close(); }
        lines.push({ n, file, from: o.x.from, to: o.x.to, text: o.x.text, dur: +(o.b - o.a).toFixed(4), hin: +hin.toFixed(4), hout: +hout.toFixed(4), guess: !!o.guess });
        busyNote("Cutting line " + n + " / " + out.length);
      }
      const pack = { v: 1, book: B.book.title, bookId: B.book.id, chapter: B.chap.title, chapterId: B.chap.id, reader: B.readingAs, made: new Date().toISOString(), rate: R, lines };
      for (const dd of [d].concat(copyTo)) { const fh = await dd.getFileHandle("lines.json", { create: true }), w = await fh.createWritable(); await w.write(JSON.stringify(pack, null, 1)); await w.close(); }
      const keep = new Set(["lines.json"].concat(lines.map(l => l.file)));
      for (const dd of [d].concat(copyTo)) { const old = []; for await (const [name, h] of dd.entries()) if (h.kind === "file" && !keep.has(name) && /\.(wav|peaks2|json)$/i.test(name)) old.push(name); for (const n of old) await dd.removeEntry(n).catch(() => {}); }
      B.sent = { ci: B.ci, n: lines.length, guessed: lines.filter(l => l.guess).length, missing: runs.length - lines.length, when: Date.now() };
      celebrateOrToast(lines.length + " LINES SENT", "to " + (Prep.readerOf("n", B.chap, B.book) || "the lead") + " · " + B.chap.title);
    } catch (e) { console.error(e); toast("Sending failed: " + e.message); }
    B.busy = null; busyNote(""); renderSide();
  }
  const celebrateOrToast = (title, sub) => window.LRCele ? LRCele.celebrate({ title, sub, level: 1, noConfetti: true }) : toast(title + " — " + sub);

  // ---- the lead's side: bring their lines in (from the shared Library, or a folder you choose) ----
  async function readPack(d) { try { const f = await (await d.getFileHandle("lines.json")).getFile(); return JSON.parse(await f.text()); } catch (e) { return null; } }
  async function bringLines(picked, quiet) {
    const readers = [...new Set(theirRuns().map(x => x.r))]; let got = 0, fresh = 0;
    for (const r of readers) {
      let d = null, pack = null;
      if (picked) { pack = await readPack(picked); if (pack && pack.reader === r) d = picked; else { try { d = await picked.getDirectoryHandle(r); pack = await readPack(d); } catch (e) { d = null; } } }
      else {
        // the shared folder's pack or the Library's, whichever is newer (a co-narrator in another Library only reaches the shared one)
        for (const get of [() => Store.sharedLinesDir(B.book, B.chap, r, false), () => Store.duetDir(B.book, B.chap, r, false)]) {
          try { const dd = await get(); const pk = dd && await readPack(dd); if (pk && (!pack || pk.made > pack.made)) { d = dd; pack = pk; } } catch (e) {}
        }
      }
      if (!d || !pack || (pack.chapterId && pack.chapterId !== B.chap.id && !picked)) continue;
      const have = duetData()[r]; if (have && have.made === pack.made && !picked) { got += have.lines.length; continue; }
      const cd = await dir(), stamp = Date.now().toString(36), runs = theirRuns().filter(x => x.r === r), lines = [];
      for (const l of pack.lines) {
        // match to my text: same word positions if the manuscripts agree, otherwise find the words
        let x = runs.find(z => z.from === l.from && z.text === l.text) || runs.find(z => z.text === l.text) || runs.find(z => z.from === l.from);
        if (!x) continue;
        const name = "co-" + r.replace(/[^\w-]+/g, "") + "-" + stamp + "-" + String(l.n).padStart(3, "0") + ".wav";
        const src = await (await d.getFileHandle(l.file)).getFile(), fh = await cd.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(src); await w.close();
        try { const ps = await (await d.getFileHandle(l.file.replace(/\.wav$/, ".peaks2"))).getFile(), ph = await cd.getFileHandle(name.replace(/\.wav$/, ".peaks2"), { create: true }), pw = await ph.createWritable(); await pw.write(ps); await pw.close(); } catch (e) {}
        lines.push({ n: l.n, file: name, from: x.from, to: x.to, text: x.text, dur: l.dur, hin: l.hin || 0, hout: l.hout || 0 });
      }
      duetData()[r] = { made: pack.made, got: new Date().toISOString(), lines }; got += lines.length; fresh += lines.length;
      const re = recutOf(r); if (re.length) { B.recut = B.recut || {}; B.recut[r] = re.length; }
      B.peaks = B.peaks || {};
    }
    // a re-send of lines already in the chapter swaps in by itself (Undo puts the old ones back)
    const rc = Object.entries(B.recut || {}).filter(([r, n]) => n && recutOf(r).length);
    if (rc.length && !B.rec && !B.busy) for (const [r] of rc) swapRecut(r);
    else if (rc.length) toast("🔁 " + rc.map(([r, n]) => r + " re-sent " + n + " line" + (n === 1 ? "" : "s") + " you've already placed").join(", ") + ". Collaborate tab ▸ Swap them in.");
    if (fresh) { Store.saveBook(B.book); renderSide(); notice("👥 " + fresh + " co-narrator line" + (fresh === 1 ? "" : "s") + " arrived for " + B.chap.title + "." + (B.audio.markers.some(m => m.slot) ? " Splice all fills your slots." : "")); }
    else if (!quiet) toast(picked ? "No lines for this chapter in that folder." : "No new lines yet. When your co-narrator presses Send, they appear here (through the shared Library folder).");
    return got;
  }
  // placed lines whose newest version (from a re-send) isn't the one in the chapter
  // a send you've already swapped in (or chosen to keep yours over) stays quiet until a newer one arrives
  function recutOf(r) {
    const out = [], rec = duetData()[r]; if (!rec || rec.done === rec.made) return out;
    B.audio.tracks.forEach((tr, ti) => tr.clips.forEach((c, ci) => { if (!c.line || c.line.r !== r) return; const l = rec.lines.find(z => z.from === c.line.from); if (l && l.file !== c.file) out.push({ ti, ci, l }); }));
    return out;
  }
  // swap a placed line for a new version: the chapter grows or shrinks to fit (your audio moves along with it)
  function swapClip(ti, ci, l) {
    const c = B.audio.tracks[ti].clips[ci], end = c.at + c.dur, d = l.dur - c.dur, tag = Prep.uid(); c.swapTag = tag;
    if (d > 0.005) T().insertGap(B.audio, end, d);
    else if (d < -0.005) { const a = end + d, busy = B.audio.tracks.some((tr, k) => k !== ti && tr.clips.some(z => z.at < end - 0.01 && z.at + z.dur > a + 0.01)); if (!busy) T().deleteRange(B.audio, a, end); }
    const k = B.audio.tracks[ti].clips.find(z => z.swapTag === tag) || B.audio.tracks[ti].clips.find(z => z.line && c.line && z.line.from === c.line.from && z.line.r === c.line.r) || c;
    delete k.swapTag; delete c.swapTag;
    k.file = l.file; k.off = l.hin || 0; k.dur = l.dur; delete k.fi; delete k.fo; delete k.g;
  }
  function swapRecut(r) {
    if (B.rec || B.busy) return;
    const seen = new Set(), todo = recutOf(r).filter(x => { const k = x.l.from; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => B.audio.tracks[b.ti].clips[b.ci].at - B.audio.tracks[a.ti].clips[a.ci].at);   // last first, so earlier times stay put
    if (!todo.length) { toast("Nothing to swap."); return; }
    pushUndo(); for (const x of todo) swapClip(x.ti, x.ci, x.l);
    duetData()[r].done = duetData()[r].made;
    if (B.recut) delete B.recut[r];
    edited(); renderSide(); notice("🔁 " + todo.length + " of " + r + "'s line" + (todo.length === 1 ? "" : "s") + " swapped for the new cut. Undo puts the old ones back.");
  }
  function keepRecut(r) { const d = duetData()[r]; if (!d) return; d.done = d.made; if (B.recut) delete B.recut[r]; Store.saveBook(B.book); renderSide(); toast("Keeping the lines you have. A newer send from " + r + " will ask again."); }
  async function pickLinesFolder() { try { const d = await window.showDirectoryPicker({ id: "lamp-room-lines", mode: "read" }); await bringLines(d); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }
  async function pickCopyFolder() { try { const d = await window.showDirectoryPicker({ id: "lamp-room-lines-out", mode: "readwrite" }); const sub = await d.getDirectoryHandle((B.book.folder + " - " + B.chap.title + " - " + B.readingAs).replace(/[\\/:*?"<>|]+/g, "-"), { create: true }); await sendLines(sub); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }

  function duetTabHtml() {
    const dis = B.rec || B.busy ? "disabled" : "";
    if (!amLead()) {
      const runs = myRuns(), lead = Prep.readerOf("n", B.chap, B.book) || "the lead", s = B.sent && B.sent.ci === B.ci ? B.sent : null;
      return `<div class="bd-sec"><b>You're reading for ${esc(lead)}</b><div class="stu-note">${esc(lead)} narrates this chapter. Record your ${runs.length} line${runs.length === 1 ? "" : "s"} (${num(runs.reduce((a, x) => a + x.words, 0))} words) straight through, with a breath between lines. Then <b>Send</b>: each line is cut out by your word timing and the pauses around it, and lands in the shared Library where ${esc(lead)}'s Booth picks it up.</div>
          <div class="fx-chips"><button class="stu-btn stu-rec" data-p="send" ${dis} ${len() ? "" : "disabled"}>${B.busy === "send" ? "Sending…" : "📤 Send my lines"}</button><button class="stu-btn" data-p="sendcopy" ${dis} ${len() ? "" : "disabled"} title="Also save the lines in a folder you choose (to share another way)">Send + save a copy…</button></div>
          ${s ? `<div class="co-chips"><span class="ok">${s.n} sent</span>${s.guessed ? `<span class="warn">${s.guessed} placed by pauses (no word timing)</span>` : ""}${s.missing ? `<span class="warn">${s.missing} not found in the recording</span>` : ""}</div>` : ""}</div>
        <div class="bd-sec"><b>Recorded somewhere else?</b><div class="stu-note">Bring in a file of your lines from Audition or anywhere: it's cut at the clicks, markers or pauses between lines, each piece matched to its line by the words, and laid on your track in order. Then it's yours to check and send like a Booth recording. Its words count toward your day; booth time doesn't.</div><div class="fx-chips"><button class="stu-btn" data-p="impmine" ${dis} ${runs.length ? "" : "disabled"}>${B.busy === "import" ? "Bringing in…" : "📥 Bring in my lines from a file…"}</button></div>
          <label class="check"><input type="checkbox" data-p2="castwords" ${Store.lsGet("lr-castwords") !== "0" ? "checked" : ""}> Match lines by their words (handles retakes, breaths and missed lines; the first time, it downloads its listening model)</label></div>
        <div class="bd-sec"><b>Your lines</b>${runs.map((x, i) => `<div class="co-line"><span class="n">${i + 1}</span><span>${esc(qt(short(x.text, 18)))}</span><span></span></div>`).join("") || `<div class="stu-note">None in this chapter.</div>`}</div>`;
    }
    const runs = theirRuns();
    if (!runs.length) return `<div class="bd-sec"><b>Collaborate</b><div class="stu-note">No one else reads in this chapter.</div></div>`;
    const arrived = runs.filter(x => lineFor(x)).length, placed = runs.filter(x => placedClip(x)).length, slots = runs.filter(x => !placedClip(x) && slotOf(x)).length, who = [...new Set(runs.map(x => x.r))].join(" & ");
    const rcs = [...new Set(runs.map(x => x.r))].map(r => [r, recutOf(r).length]).filter(z => z[1]);
    const miss = [...new Set(runs.map(x => x.r))].map(r => [r, runs.filter(x => x.r === r && ((duetData()[r] || {}).missing || []).includes(x.from) && !lineFor(x)).length]).filter(z => z[1]);
    return `${miss.map(([r, n]) => `<div class="bd-sec recut"><b>⚠ ${n} line${n === 1 ? "" : "s"} missing from ${esc(nm(r))}'s file</b><div class="stu-note">Their file had no take of ${n === 1 ? "this line" : "these lines"} (marked below). Mark them as pickups and they go on ${esc(r)}'s list${isNarrator(r) ? "" : " for you to send"}.</div><div class="fx-chips"><button class="stu-btn stu-rec" data-p="miss:${esc(r)}" ${dis}>🔁 Mark as pickups</button></div></div>`).join("")}${rcs.map(([r, n]) => `<div class="bd-sec recut"><b>🔁 ${esc(r)} re-cut ${n} line${n === 1 ? "" : "s"} you've already placed</b><div class="stu-note">Swap in the new cut: each one replaces the old in place, and the chapter grows or shrinks to fit. Undo puts the old ones back.</div><div class="fx-chips"><button class="stu-btn stu-rec" data-p="recut:${esc(r)}" ${dis}>Swap them in</button><button class="stu-btn" data-p="recutkeep:${esc(r)}" ${dis}>Keep mine</button></div></div>`).join("")}<div class="bd-sec"><b>${esc(who)}'s lines</b>
        <div class="co-chips"><span>${runs.length} in this chapter</span><span class="${arrived === runs.length ? "ok" : arrived ? "" : "warn"}">${arrived} arrived</span><span class="${placed ? "ok" : ""}">${placed} in</span>${slots ? `<span class="warn">${slots} slots waiting</span>` : ""}</div>
        <label class="check"><input type="checkbox" data-duet="auto" ${duetOpt("auto") ? "checked" : ""}> <b>Auto-place while I record</b></label>
        <div class="stu-note">Read through. When you've finished the line before theirs and gone quiet, their line drops in on their track${duetOpt("hear") ? " and plays in your headphones" : ""}; wait for “Your turn”. If their audio isn't in yet, a slot is marked and it splices in later. <b>${esc(kl("click"))}</b> drops their next line in by hand.</div>
        <label class="check"><input type="checkbox" data-duet="hear" ${duetOpt("hear") ? "checked" : ""}> Play their line in my headphones</label>
        <div class="fx-chips"><button class="stu-btn stu-rec" data-p="spliceall" ${dis} ${arrived > placed ? "" : "disabled"} title="Fill the slots, and place any line not yet in by your word timing">⤓ Splice all</button><button class="stu-btn" data-p="bring" ${dis}>Check for new lines</button><button class="stu-btn" data-p="bringfrom" ${dis}>Load from a folder…</button></div></div>
      <div class="bd-sec">${runs.map((x, i) => { const l = lineFor(x), p = placedClip(x), sl = !p && slotOf(x);
        return `<div class="co-line ${p ? "placed" : sl ? "slot" : ""}"><span class="n">${i + 1}</span><span>${esc(qt(short(x.text, 16)))}<br><i>${esc(nm(x.r))} · ${!l && !p && ((duetData()[x.r] || {}).missing || []).includes(x.from) ? '<b class="warn-t">missing from their file</b> · ' : ""}${p ? "in · " + clock(B.audio.tracks[p.ti].clips[p.ci].at) : sl ? "slot at " + clock(sl.t) : ""}${l ? (p || sl ? " · " : "") + l.dur.toFixed(1) + " s" + (l.check ? ' · <b class="warn-t">check</b>' : "") + (l.pk ? " · pickup" : "") : (p || sl ? "" : "") + (l ? "" : " not arrived")}</i></span>
          <span class="fx-chips">${l ? audBtn("l:" + i, `data-p="lplay:${i}"`, "Listen") : ""}${p ? `<button class="stu-btn" data-p="lgo:${i}" title="Go to it">go</button><button class="stu-btn" data-p="lout:${i}" ${dis} title="Take it back out">↩</button>` : l ? `<button class="stu-btn" data-p="lin:${i}" ${dis} title="Put it in at the playhead (snaps to the pause)">Place</button>` : ""}<button class="stu-btn" data-p="lask:${i}" title="Mark as a pickup for ${esc(x.r)}">🔁</button></span></div>`; }).join("")}</div>
      <div class="bd-sec"><b>A recording from outside the Lamp Room</b><div class="stu-note">Cast who don't use the Lamp Room send you a file. Drop it here and it's cut into their lines: at the clicks or claps between lines if there are any, otherwise at the pauses. WAV, MP3, M4A, AIFF or FLAC.</div>
        <div class="fx-chips">${[...new Set(runs.map(x => x.r))].map(r => `<button class="stu-btn" data-p="castdrop:${esc(r)}" ${dis}>🎧 ${esc(nm(r))}'s file…</button>`).join("")}</div>
        <label class="check"><input type="checkbox" data-duet="spill" ${spillOn() ? "checked" : ""}> The file runs on into the next chapters</label>
        <label class="check"><input type="checkbox" data-p2="castwords" ${Store.lsGet("lr-castwords") !== "0" ? "checked" : ""}> Match lines by their words (handles retakes and missed lines; uses the proofer)</label></div>
      <div class="bd-sec"><b>While their lines play</b>
        <div class="fx-chips"><span class="stu-note">Their lines in my headphones</span><input type="range" min="0" max="100" step="5" data-dv="vol" value="${Math.round(coVol() * 100)}"><span class="stu-note">${Math.round(coVol() * 100)}%</span></div>
        <div class="fx-chips"><span class="stu-note">“Your turn” shows for</span><input class="stu-in pz" type="number" min="0.3" max="3" step="0.1" data-dv="turn" value="${turnSecs()}"><span class="stu-note">s</span></div>
        <label class="check"><input type="checkbox" data-dv="clean" ${(Store.settings.duet || {}).clean !== false ? "checked" : ""}> Clean up my track under their lines (removes headphone bleed; stops the moment I start speaking)</label>
        <div class="stu-note">Don't want to wait? Just keep reading, or press Space. Their line keeps its place and what you read lands after it, so you never record over them.</div>
        <div class="stu-note">To fix a line that cut badly, click it on its track: a small editor opens to trim, extend, nudge or re-cut it.</div></div>`;
  }
  function pickupsTabHtml() {
    const open = B.audio.markers.filter(m => !m.done && !m.slot);
    return pickupsAskedHtml() + `<div class="bd-sec"><b>Pickups</b><div class="stu-note">Your flags in this chapter: flub markers (${esc(kl("marker"))}), named markers (${esc(kl("custom"))}), proofing flags and the spots that clipped. Each one's sentence is <b class="pk-t">red</b> in the text and on the waveform; drag the red zone's edges to take in more or less. <b>▶</b> plays it in context. <b>Fix</b> re-records just that zone, on the same track, and the chapter closes up or opens to fit.</div>
        ${open.length ? open.map(m => { const z = pkZone(m); return `<div class="co-line"><span class="n">⚑</span><span><b data-p="pgo:${m.id}" class="lnk" title="Play it in context">▶ ${clock(z ? z.a : m.t)}</b> ${esc(m.note || "Flub")}<br><i>${m.ctx ? "“…" + esc(m.ctx) + "…”" : ""}</i></span><span class="fx-chips">${assembled() ? (pkAsked(m) ? `<span class="stu-note">asked ${esc(pkAsked(m).to)}</span>` : `<button class="stu-btn stu-rec" data-p="pask:${m.id}" ${B.rec ? "disabled" : ""} title="Send this to whoever read it">🔁 Ask ${esc(whoRead(m) || "…")}</button>`) : `<button class="stu-btn stu-rec" data-p="pfix:${m.id}" ${B.rec ? "disabled" : ""}>Fix</button>`}<button class="stu-btn" data-p="pdone:${m.id}" title="It's fine: remove the flag">✓</button>${m.proof && m.proof.text ? `<button class="stu-btn" data-p="pign:${m.id}" title="This is right (a name, a word the proofer doesn't know): never flag it again, in any of your books">Always ignore</button>` : ""}</span></div>`; }).join("") : `<div class="stu-note">No open flags. Clean chapter.</div>`}</div>`;
  }
