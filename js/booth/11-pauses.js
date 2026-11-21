/* booth/11-pauses.js — Fades, space, room tone and pauses.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= fades, space, room tone, pauses =======================
  const PAUSE_DEF = { head: 0.8, heading: 2.0, scene: 1.5, tail: 3.5, cap: 0.7, space: 0.5, onComplete: false };
  const pz = () => Object.assign({}, PAUSE_DEF, Store.settings.pauses || {});
  function setPause(k, v) { Store.settings.pauses = Object.assign({}, pz(), { [k]: v }); Store.saveSettings(); }
  // the take a fade or gain applies to: the selected one, or the one under the playhead on the current track
  function targetClip() {
    if (B.selTake) { const c = B.audio.tracks[B.selTake.ti] && B.audio.tracks[B.selTake.ti].clips[B.selTake.ci]; if (c) return { c, ti: B.selTake.ti, ci: B.selTake.ci }; }
    const t = B.playhead != null ? B.playhead : null; if (t == null) return null;
    const ci = T().clipAt(B.audio, B.track, t); return ci >= 0 ? { c: B.audio.tracks[B.track].clips[ci], ti: B.track, ci } : null;
  }
  function setFades(fiMs, foMs) {
    const tg = targetClip(); if (!tg || B.rec) { toast("Select a take (click its label strip, or double-click it), or put the playhead inside one."); return; }
    pushUndo(); const c = tg.c, mx = c.dur / 2;
    if (fiMs != null) { const v = Math.min(mx, fiMs / 1000); if (v > 0) c.fi = +v.toFixed(3); else delete c.fi; }
    if (foMs != null) { const v = Math.min(mx, foMs / 1000); if (v > 0) c.fo = +v.toFixed(3); else delete c.fo; }
    edited(); notice("Fades set on that take. Drag the white dots to adjust them.");
  }
  function resetGainFades() {
    const tg = targetClip(); if (!tg || B.rec) { toast("Select a take first, or put the playhead inside one."); return; }
    pushUndo(); delete tg.c.g; delete tg.c.fi; delete tg.c.fo; edited(); notice("Gain and fades reset on that take.");
  }
  // G: open some space at the playhead (every track moves along; room tone fills it if you've taught it your room)
  function addSpace(sec) {
    if (B.rec) return; sec = sec || pz().space; const t = B.playhead != null ? B.playhead : len();
    pushUndo(); T().insertGap(B.audio, t, sec); B.playhead = t + sec; edited();
    notice("Added " + sec.toFixed(2) + " s at " + clock(t) + (toneOn() ? ", filled with your room tone." : ". Teach it your room tone (Levels) and gaps fill with it."));
  }
  // ---- room tone: per reader, a few seconds of your room, kept in the Studio folder ----
  const toneRec = () => ((B.book.roomTone || {})[B.readingAs]) || null;
  const toneOn = () => !!toneRec() && B.book.toneFill !== false;
  async function toneBuf() {
    const r = toneRec(); if (!r || B.book.toneFill === false) return null;
    if (B.tone && B.tone.key === r.file + r.made) return B.tone.buf;
    try { const bd = await Store.studio.getDirectoryHandle(B.book.folder, { create: true }), f = await (await bd.getFileHandle(r.file)).getFile(), x = await LRAudio.readPCM(f, 0, f.size / (LRAudio.RATE * 3));
      B.tone = { key: r.file + r.made, buf: LRAudio.loopTone(x) }; return B.tone.buf; } catch (e) { return null; }
  }
  async function learnTone() {
    if (B.rec || B.busy) return; if (!(await ensureStudio())) return;
    B.busy = "tone"; renderSide();
    try {
      const d = await dir(), tr = B.audio.tracks[B.track] || B.audio.tracks[0]; let a, b;
      if (B.sel && B.sel.b - B.sel.a >= 0.8) { a = B.sel.a; b = Math.min(B.sel.b, B.sel.a + 10); }
      else {   // the quietest 1.5 s of this track that is still recording (not an empty gap)
        const L = T().trackLen(tr); if (L < 3) { toast("Record a little first (or select a few seconds of silence) so there's room tone to learn from."); return; }
        const x = await LRAudio.renderRange(d, tr.clips, 0, L), hop = 480, n = Math.floor(x.length / hop), e = new Float32Array(n);
        for (let k = 0; k < n; k++) { let s2 = 0; for (let j = k * hop; j < (k + 1) * hop; j++) s2 += x[j] * x[j]; e[k] = Math.sqrt(s2 / hop); }
        const W = 150; let best = -1, bv = Infinity, sum = 0, dead = 0;
        for (let k = 0; k < n; k++) { sum += e[k]; if (e[k] < 1e-6) dead++; if (k >= W) { sum -= e[k - W]; if (e[k - W] < 1e-6) dead--; } if (k >= W - 1 && !dead && sum < bv) { bv = sum; best = k - W + 1; } }
        if (best < 0) { toast("Couldn't find a stretch of quiet room in this chapter. Select one by hand (about 2 s between sentences) and try again."); return; }
        a = best * 0.01 + 0.15; b = a + 1.2;
      }
      const x = await LRAudio.renderRange(d, tr.clips, a, b - a);
      let s2 = 0; for (const v of x) s2 += v * v; const db = 20 * Math.log10(Math.sqrt(s2 / Math.max(1, x.length)) + 1e-9);
      if (db > -40) { toast("That stretch is too loud for room tone (" + db.toFixed(0) + " dB): pick a pause with no breath or words in it."); return; }
      const bd = await Store.studio.getDirectoryHandle(B.book.folder, { create: true }), name = "roomtone-" + B.readingAs.replace(/[^\w-]+/g, "") + ".wav";
      const w = await LRAudio.WavWriter.create(bd, name, LRAudio.RATE); w.push(x); await w.close();
      B.book.roomTone = B.book.roomTone || {}; B.book.roomTone[B.readingAs] = { file: name, made: new Date().toISOString(), db: +db.toFixed(1), dur: +(b - a).toFixed(2) };
      Store.saveBook(B.book); B.tone = null; notice("🔇 Room tone learned (" + db.toFixed(0) + " dB, " + (b - a).toFixed(1) + " s). Gaps now fill with it when you play and export.");
    } catch (e) { toast("Couldn't learn room tone: " + e.message); }
    finally { B.busy = null; renderSide(); }
  }
  async function playTone() { const t = await toneBuf(); if (!t) { toast("No room tone yet."); return; } stopLine(); const n = Math.min(t.length * 3, LRAudio.RATE * 4), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = t[i % t.length]; const ctx = new AudioContext({ sampleRate: LRAudio.RATE }), buf = ctx.createBuffer(1, n, LRAudio.RATE); buf.copyToChannel(x, 0); const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(); B.coPlay = ctx; }
  // ---- pauses: find them in what's actually recorded (all tracks, no room tone), then set each to its length ----
  async function findPauses() {
    const L = len(); if (!L) return null;
    const render = LRAudio.mixer(await dir(), B.audio, trackSet(), { bypass: true }), E = await envelope(render, L), n = Math.min(E.env.length, Math.floor(L / 0.01));
    let f = 0; while (f < n && E.env[f] < E.thr) f++;
    let l = n - 1; while (l > f && E.env[l] < E.thr) l--;
    if (f >= n) return null;
    const pauses = []; let s0 = -1;
    for (let k = f; k <= l; k++) { const q = E.env[k] < E.thr; if (q && s0 < 0) s0 = k; if (!q && s0 >= 0) { if (k - s0 >= 20) pauses.push({ a: s0 * 0.01, b: k * 0.01 }); s0 = -1; } }
    return { L, first: f * 0.01, last: (l + 1) * 0.01, pauses };
  }
  // which pause follows the chapter heading, and which ones sit at scene breaks (from the follow-along word timing)
  function classify(P) {
    const toks = B.toks, paras = B.chap.paras, an = B.audio.anchors || [], have = an.length > 2, tw = w => T().timeOfWord(B.audio, w);
    let hp = 0; const p0 = paras[0] ? Prep.paraText(paras[0]).trim() : "";
    if (p0 && p0.length <= 120) { hp = 1; const p1 = paras[1] ? Prep.paraText(paras[1]).trim() : ""; if (p1 && B.chap.title.includes(": ") && B.chap.title.endsWith(p1)) hp = 2; }
    const hEnd = toks.reduce((m, t, i) => t.p < hp ? i : m, -1), out = { heading: null, scenes: [], guessed: false, missedScenes: 0 };
    if (hEnd >= 0 && hEnd < toks.length - 1) {
      const hT = have ? tw(hEnd + 1) : null;
      if (hT != null) out.heading = P.pauses.filter(p => p.b <= hT + 1.2 && p.a >= P.first).pop() || null;
      if (!out.heading) { out.heading = P.pauses.find(p => p.a - P.first < 5 && p.b - p.a >= 0.3) || null; out.guessed = !!out.heading; }
    }
    for (let i = 0; i < toks.length - 1; i++) {
      let scene = false; for (let q = toks[i].p + 1; q < toks[i + 1].p; q++) if (paras[q] === "⁂") scene = true;
      if (!scene) continue;
      const sT = have ? tw(i + 1) : null, p = sT != null ? P.pauses.filter(x => x.b <= sT + 1.2 && x.b >= sT - 4).pop() : null;
      if (p && p !== out.heading) out.scenes.push(p); else out.missedScenes++;
    }
    return out;
  }
  // the plan for this chapter, as a list of changes (nothing is touched until it's applied)
  async function pausePlan() {
    const P = await findPauses(); if (!P) return null;
    const S = pz(), C = classify(P), plan = [];
    plan.push({ kind: "head", a: 0, b: P.first, target: S.head });
    for (const p of P.pauses) {
      const kind = p === C.heading ? "heading" : C.scenes.includes(p) ? "scene" : "pause", target = kind === "heading" ? S.heading : kind === "scene" ? S.scene : S.cap, cur = p.b - p.a;
      if (kind === "pause" && cur <= target + 0.02) continue;
      if (Math.abs(cur - target) < 0.03) continue;
      plan.push({ kind, a: p.a, b: p.b, target });
    }
    plan.push({ kind: "tail", a: P.last, b: P.L, target: S.tail });
    return { P, C, plan };
  }
  async function evenPauses(preview) {
    if (B.rec || B.busy) return null;
    if (!(await ensureStudio())) return null;
    B.busy = "pauses"; renderSide();
    try {
      const r = await pausePlan(); if (!r) { toast("Nothing recorded in this chapter yet."); return null; }
      const { plan, C } = r, n = { capped: 0, cut: 0, added: 0 };
      for (const x of plan) { const cur = x.b - x.a; if (x.kind === "pause") { n.capped++; n.cut += cur - x.target; } }
      const head = plan[0], tail = plan[plan.length - 1], hd = plan.find(x => x.kind === "heading"), sc = plan.filter(x => x.kind === "scene");
      const summary = `Head ${(head.b - head.a).toFixed(1)}→${head.target} s · ` + (hd ? `after the heading ${(hd.b - hd.a).toFixed(1)}→${hd.target} s${C.guessed ? " (guessed)" : ""} · ` : C.heading ? "" : "no heading pause found · ") +
        (sc.length ? sc.length + " scene break" + (sc.length === 1 ? "" : "s") + " → " + pz().scene + " s · " : "") + (C.missedScenes ? C.missedScenes + " scene break" + (C.missedScenes === 1 ? "" : "s") + " not found (no word timing there) · " : "") +
        `${n.capped} pause${n.capped === 1 ? "" : "s"} over ${pz().cap} s shortened (−${n.cut.toFixed(1)} s) · tail ${(tail.b - tail.a).toFixed(1)}→${tail.target} s`;
      B.pausePreview = { ci: B.ci, summary, applied: !preview };
      if (preview) return r;
      pushUndo(); const a = B.audio;
      for (const x of plan.slice().sort((p, q) => q.a - p.a)) {          // back to front, so earlier times stay put
        const cur = x.b - x.a;
        if (x.kind === "tail") { if (cur > x.target) { T().deleteRange(a, x.a + x.target, x.b); delete a.pad; } else a.pad = +(x.target - cur).toFixed(3); continue; }
        if (x.kind === "head") { if (cur > x.target) T().deleteRange(a, 0, cur - x.target); else T().insertGap(a, 0, x.target - cur); continue; }
        if (cur > x.target) T().deleteRange(a, x.a + x.target / 2, x.b - x.target / 2);
        else T().insertGap(a, (x.a + x.b) / 2, x.target - cur);
      }
      edited(); notice("⏱ Pauses evened: " + summary + ". Undo puts them back.");
      return r;
    } catch (e) { console.error(e); toast("Couldn't even out the pauses: " + e.message); return null; }
    finally { B.busy = null; busyNote(""); renderSide(); }
  }
  function spacingHtml() {
    const dis = B.rec || B.busy ? "disabled" : "", S = pz(), tr = toneRec(), tg = targetClip(), num = (k, v, st, mn) => `<input class="stu-in pz" type="number" step="${st || 0.1}" min="${mn || 0}" data-pz="${k}" value="${v}">`;
    return `<div class="bd-sec"><b>Fades</b><div class="stu-note">Drag the white dots at a take's bottom corners, or set them here for ${tg ? "the " + (B.selTake ? "selected take" : "take at the playhead") : "a take (select one first)"}. Every cut already gets an 8 ms fade so it never clicks.</div>
        <div class="fx-chips"><span class="stu-note">In</span><input class="stu-in pz" type="number" step="10" min="0" id="fz-in" value="${tg && tg.c.fi ? Math.round(tg.c.fi * 1000) : 0}"><span class="stu-note">ms · Out</span><input class="stu-in pz" type="number" step="10" min="0" id="fz-out" value="${tg && tg.c.fo ? Math.round(tg.c.fo * 1000) : 0}"><span class="stu-note">ms</span>
        <button class="stu-btn" data-p="fzset" ${dis} ${tg ? "" : "disabled"}>Set</button><button class="stu-btn" data-p="fzreset" ${dis} ${tg ? "" : "disabled"}>Reset gain &amp; fades</button></div></div>
      <div class="bd-sec"><b>Spacing by hand</b><div class="stu-note">Drag either edge of a take: everything after it moves along on every track (in to tighten a pause, out to open it up as far as the recording goes). Hold ⌥ to trim just that take. Edges snap to other takes and markers.</div>
        <div class="fx-chips"><button class="stu-btn" data-p="addspace" ${dis}>＋ Add ${S.space} s at the playhead (${esc(kl("addSpace"))})</button><span class="stu-note">length</span>${num("space", S.space, 0.1, 0.1)}<span class="stu-note">s</span></div></div>
      <div class="bd-sec"><b>Room tone</b><div class="stu-note">${tr ? `Learned ${new Date(tr.made).toLocaleDateString()} · ${tr.db} dB.` : "Not learned yet."} Gaps between takes, added space and the tail fill with it when you play and export, so nothing drops to dead silence. Select a quiet pause to learn from, or let it find one.</div>
        <div class="fx-chips"><button class="stu-btn" data-p="tonelearn" ${dis}>${B.busy === "tone" ? "Listening…" : B.sel ? "Learn from the selection" : "Learn from this chapter"}</button>${tr ? `<button class="stu-btn" data-p="toneplay">▶ Listen</button>` : ""}</div>
        <label class="check"><input type="checkbox" data-pzc="fill" ${B.book.toneFill !== false ? "checked" : ""} ${tr ? "" : "disabled"}> Fill gaps with room tone</label></div>
      <div class="bd-sec"><b>Even out pauses</b><div class="stu-note">Sets the head, the pause after the chapter heading, scene breaks and the tail to your lengths, and shortens any other pause that runs long. Shorter pauses are left alone. Uses follow-along's word timing to find the heading and the scene breaks.</div>
        <div class="pz-grid"><span>Head</span>${num("head", S.head)}<span>After the heading</span>${num("heading", S.heading)}<span>Scene breaks</span>${num("scene", S.scene)}<span>Tail</span>${num("tail", S.tail)}<span>Any other pause, at most</span>${num("cap", S.cap)}</div>
        ${B.pausePreview && B.pausePreview.ci === B.ci ? `<div class="stu-note pz-sum">${B.pausePreview.applied ? "Done: " : "Plan: "}${esc(B.pausePreview.summary)}</div>` : ""}
        <div class="fx-chips"><button class="stu-btn" data-p="pzprev" ${dis} ${len() ? "" : "disabled"}>${B.busy === "pauses" ? "Listening…" : "Preview"}</button><button class="stu-btn stu-rec" data-p="pzapply" ${dis} ${len() ? "" : "disabled"}>Even out this chapter</button></div>
        <label class="check"><input type="checkbox" data-pzc="onComplete" ${S.onComplete ? "checked" : ""}> Do it when I mark a chapter complete</label></div>`;
  }

