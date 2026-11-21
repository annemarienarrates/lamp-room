/* booth/05-guide-proof.js — The character guide and proofing.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= the character guide: yours alone, on this computer, carried through the series =======================
  const slug = x => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
  const seriesOf = bk => (bk.series || "").trim() || (window.LL && LL.S && bk.titleId && ((LL.S.titles || []).find(t => t.id === bk.titleId) || {}).series) || bk.title;
  async function charDir(create) {
    if (!(await ensureStudio())) return null;
    const me = Store.me() || B.readingAs;
    let d = await Store.studio.getDirectoryHandle("_characters", { create: true });
    d = await d.getDirectoryHandle(slug(me), { create: true });
    return d.getDirectoryHandle(slug(seriesOf(B.book)), { create: !!create || true });
  }
  async function charLoad() {
    const key = (Store.me() || B.readingAs) + "|" + seriesOf(B.book);
    if (B.chars && B.chars.key === key) return B.chars;
    B.chars = { key, list: [], loaded: false };
    try { const d = await charDir(); const f = await (await d.getFileHandle("guide.json")).getFile(); B.chars.list = JSON.parse(await f.text()).characters || []; } catch (e) { }
    B.chars.loaded = true; return B.chars;
  }
  async function charSave() {
    const d = await charDir(true); if (!d) return;
    const w = await (await d.getFileHandle("guide.json", { create: true })).createWritable();
    await w.write(JSON.stringify({ series: seriesOf(B.book), person: Store.me() || B.readingAs, characters: B.chars.list }, null, 1)); await w.close();
  }
  const charNames = c => [c.name, ...(c.aka || [])].map(x => String(x).trim()).filter(Boolean);
  function charFind(name) { const n = slug(name); return (B.chars && B.chars.list || []).find(c => charNames(c).some(x => slug(x) === n)); }
  // where each character first turns up in this chapter's text (by name or nickname)
  function charsInChapter() {
    const text = " " + B.toks.map(t => t.w).join(" ").toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ") + " ", out = [];
    for (const c of (B.chars && B.chars.list) || []) {
      let at = Infinity; for (const n of charNames(c)) { const k = text.indexOf(" " + n.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ") + " "); if (k >= 0 && k < at) at = k; }
      if (at < Infinity) out.push({ c, at });
    }
    return out.sort((a, b) => a.at - b.at).map(x => x.c);
  }
  async function charAddOrOpen(name) {
    await charLoad();
    let c = charFind(name);
    if (!c) { c = { id: Prep.uid(), name, aka: [], desc: "", notes: "", samples: [], fx: null, made: new Date().toISOString() }; B.chars.list.push(c); await charSave(); notice("🎭 " + name + " added to your guide for " + seriesOf(B.book) + "."); }
    B.charsOpen = true; B.charOpen = c.id; B.charQ = ""; renderChars();
  }
  async function renderChars() {
    const el = $("#bd-chars"); if (!el || !B) return;
    if (!B.charsOpen) { el.innerHTML = `<button class="bd-chars-tab" data-c="open" title="Your character guide for this chapter">🎭 Characters ‹</button>`; el.onclick = charClick; return; }
    await charLoad(); if (!B || !B.charsOpen) return;
    const q = (B.charQ || "").trim().toLowerCase(), here = charsInChapter(), all = B.chars.list;
    const shown = q ? all.filter(c => charNames(c).some(n => n.toLowerCase().includes(q))) : here;
    const ts = trackSet(), card = c => {
      const open = B.charOpen === c.id;
      if (!open) return `<button class="ch-row" data-c="card:${c.id}"><b>${esc(c.name)}</b>${(c.aka || []).length ? `<span>${esc(c.aka.join(", "))}</span>` : ""}${c.samples && c.samples.length ? `<i>▶ ${c.samples.length}</i>` : ""}${c.fx && (c.fx.armed || []).length ? `<i>FX</i>` : ""}</button>`;
      const fxs = c.fx && (c.fx.armed || []).length ? c.fx.armed.map(e => LRFx.KINDS[e.k] ? LRFx.KINDS[e.k].name + (LRFx.KINDS[e.k].sum ? " (" + LRFx.KINDS[e.k].sum(e.p) + ")" : "") : e.k).join(" · ") : "";
      return `<div class="ch-card" data-id="${c.id}">
        <div class="ch-top"><input class="ch-name" data-cf="name" value="${esc(c.name)}"><button class="stu-btn" data-c="close" title="Close the card">▾</button></div>
        <label class="ch-l">Other names<input data-cf="aka" value="${esc((c.aka || []).join(", "))}" placeholder="the Captain, Cap"></label>
        <label class="ch-l">Description<textarea data-cf="desc" rows="2" placeholder="Who they are, at a glance">${esc(c.desc || "")}</textarea></label>
        <label class="ch-l">Voice notes<textarea data-cf="notes" rows="2" placeholder="Accent, age, pace, quirks">${esc(c.notes || "")}</textarea></label>
        <div class="ch-l">Samples</div>
        ${(c.samples || []).map(sm => `<div class="ch-sm">${audBtn("sm:" + sm.id, `data-c="play:${sm.id}"`, "Play this sample")}<input data-sm="${sm.id}" value="${esc(sm.label || "")}" placeholder="calm, shouting…"><span>${sm.dur ? sm.dur.toFixed(1) + " s" : ""}</span><button class="stu-btn" data-c="smx:${sm.id}" title="Remove this sample">✕</button></div>`).join("") || `<div class="stu-note">None yet.</div>`}
        <div class="fx-chips"><button class="stu-btn" data-c="smsel" title="Select some audio on the waveform (or a take) first">＋ From selection</button><button class="stu-btn" data-c="smup">＋ Upload</button></div>
        <div class="ch-l">FX</div>
        <div class="stu-note">${fxs ? esc(fxs) : "None saved."}</div>
        <div class="fx-chips"><select class="stu-sel" data-c2="trk">${B.audio.tracks.map((_, i) => `<option value="${i}" ${i === B.track ? "selected" : ""}>${i + 1}. ${esc((ts[i] || {}).name || "Track " + (i + 1))}</option>`).join("")}</select>
          <button class="stu-btn stu-rec" data-c="arm" ${c.fx ? "" : "disabled"} title="Put ${esc(c.name)}'s FX on that track and name it after them">Arm on track</button>
          <button class="stu-btn" data-c="grab" title="Save that track's FX into this card">Save track's FX here</button></div>
        <div class="fx-chips" style="margin-top:6px"><button class="stu-btn quiet" data-c="del">Remove from my guide</button></div>
      </div>`;
    };
    el.innerHTML = `<div class="bd-chars-panel"><div class="bd-tools-head"><b>🎭 Characters</b><button class="stu-btn" data-c="shut" title="Close">›</button></div>
      <div class="stu-note">${esc(seriesOf(B.book))}${B.book.series ? "" : ` · <span title="Set a Series on the book page so the guide follows every book in it">set a series</span>`}</div>
      <div class="fx-chips"><input class="stu-in" data-c2="q" placeholder="Find anyone…" value="${esc(B.charQ || "")}" style="flex:1;min-width:0"><button class="stu-btn stu-rec" data-c="add">＋ Add</button></div>
      <div class="ch-sub">${q ? "Matching" : "In this chapter"} <span>${shown.length}${q ? "" : " of " + all.length}</span></div>
      <div class="ch-list">${shown.map(card).join("") || `<div class="stu-note">${all.length ? (q ? "No one by that name." : "None of your characters appear in this chapter.") : "Your guide is empty. Select a name in the text and choose 🎭 Add, or press ＋ Add."}</div>`}</div></div>`;
    el.onclick = charClick; el.onchange = charChange; el.oninput = e => { if (e.target.dataset.c2 === "q") { B.charQ = e.target.value; clearTimeout(B.charQt); B.charQt = setTimeout(() => { const pos = e.target.selectionStart; renderChars().then(() => { const i = el.querySelector('[data-c2="q"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }); }, 250); } };
  }
  function charCur() { return B.chars && B.chars.list.find(c => c.id === B.charOpen); }
  async function charClick(e) {
    const b = e.target.closest("[data-c]"); if (!b || b.disabled) return; const [a, x] = b.dataset.c.split(":"); b.blur();
    if (a === "open") { B.charsOpen = true; return renderChars(); }
    if (a === "shut") { B.charsOpen = false; return renderChars(); }
    if (a === "card") { B.charOpen = x; return renderChars(); }
    if (a === "close") { B.charOpen = null; return renderChars(); }
    if (a === "add") { const n = prompt("Character's name:", (B.charQ || "").trim()); if (n && n.trim()) charAddOrOpen(n.trim()); return; }
    const c = charCur(); if (!c) return;
    const d = await charDir(true);
    if (a === "play") { const sm = c.samples.find(z => z.id === x); if (!sm) return; toggleAud("sm:" + x, async () => { try { const f = await (await d.getFileHandle(sm.file)).getFile(); const au = new Audio(URL.createObjectURL(f)); B.charAudio = au; au.onended = () => { if (B && B.charAudio === au) stopSample(); }; await au.play(); } catch (er) { stopSample(); toast("That sample's file is missing."); } }); return; }
    if (a === "smx") { if (!confirm("Remove this sample?")) return; c.samples = c.samples.filter(z => z.id !== x); await charSave(); return renderChars(); }
    if (a === "smsel" || a === "smup") {
      let x48;
      if (a === "smsel") {
        if (!B.sel && !B.selTake) { toast("Select some audio on the waveform first (drag across it), or click a take."); return; }
        let ti = B.track, s0, s1; if (B.sel) { s0 = B.sel.a; s1 = B.sel.b; } else { const k = B.audio.tracks[B.selTake.ti].clips[B.selTake.ci]; ti = B.selTake.ti; s0 = k.at; s1 = k.at + k.dur; }
        if (B.sel) { let most = 0; B.audio.tracks.forEach((tr, i) => { let n = 0; for (const k of tr.clips) n += Math.max(0, Math.min(k.at + k.dur, s1) - Math.max(k.at, s0)); if (n > most) { most = n; ti = i; } }); }
        x48 = await LRAudio.renderRange(await dir(), B.audio.tracks[ti].clips, s0, Math.min(60, s1 - s0));
      } else { const f = await pickAudioFile(); if (!f) return; x48 = await decodeFile(f); }
      const id = Prep.uid(), file = "sample-" + slug(c.name) + "-" + id + ".wav", w = await LRAudio.WavWriter.create(d, file, LRAudio.RATE); w.push(x48); await w.close();
      (c.samples = c.samples || []).push({ id, file, label: "", dur: x48.length / LRAudio.RATE }); await charSave(); notice("🎭 Sample saved to " + c.name + "'s card."); return renderChars();
    }
    const ti = +((document.querySelector('#bd-chars [data-c2="trk"]') || {}).value || B.track), ts = trackSet();
    if (a === "grab") { const st = ts[ti] || {}; c.fx = { armed: JSON.parse(JSON.stringify(st.armed || [])), chain: JSON.parse(JSON.stringify(LRFx.chainOf(st))) }; await charSave(); notice("🎭 " + c.name + "'s FX saved from track " + (ti + 1) + "."); return renderChars(); }
    if (a === "arm") { if (!c.fx) return; const st = ts[ti] = ts[ti] || {}; st.armed = JSON.parse(JSON.stringify(c.fx.armed || [])); st.chain = JSON.parse(JSON.stringify(c.fx.chain || LRFx.CHAIN_DEFAULT())); st.name = c.name; Store.saveBook(B.book); chainChanged(); renderTransport(); renderSide(); notice("🎭 " + c.name + "'s FX armed on track " + (ti + 1) + ". New takes there get them when you press Stop."); return renderChars(); }
    if (a === "del") { if (!confirm("Remove " + c.name + " and their samples from your guide?")) return; for (const sm of c.samples || []) { try { await d.removeEntry(sm.file); } catch (er) { } } B.chars.list = B.chars.list.filter(z => z !== c); B.charOpen = null; await charSave(); return renderChars(); }
  }
  async function charChange(e) {
    const t = e.target, c = charCur(); if (!c) return;
    if (t.dataset.cf) { const f = t.dataset.cf; c[f] = f === "aka" ? t.value.split(",").map(z => z.trim()).filter(Boolean) : t.value; await charSave(); if (f === "name" || f === "aka") renderChars(); return; }
    if (t.dataset.sm) { const sm = c.samples.find(z => z.id === t.dataset.sm); if (sm) { sm.label = t.value; await charSave(); } }
  }
  // ======================= proofing: listen back and flag what doesn't match the text =======================
  const PROOF_EVERY = 20;
  const proofMode = () => { const m = Store.settings.proofMode; return m === "live" || m === "stop" ? m : "off"; };
  const proofKind = live => live ? "fast" : (Store.settings.proofModel === "fast" ? "fast" : "careful");
  const proofIgnore = book => new Set([...(book.proofIgnore || []), ...(Store.settings.proofIgnore || [])].map(w => LRProof.norm(w)));
  function wordAtA(list, t) { let w = null; for (const p of list) { if (p[0] > t + 1e-3) break; w = p[1]; } return w; }
  function proofQueue(job) { B.proofQ = (B.proofQ || Promise.resolve()).then(job).catch(e => { console.warn("proof", e); if (!B.proofWarned) { B.proofWarned = 1; toast("The proofer couldn't run: " + e.message + ". It needs an internet connection the first time, to download."); } }); return B.proofQ; }
  if (window.LRProof) LRProof.onProgress = m => { if (!B) return; if (m.done) busyNote(""); else busyNote("Downloading the proofer (first time only)… " + Math.round(100 * m.loaded / m.total) + "%"); };
  // one stretch of audio x, from timeline time a: what words should it hold, what did the model hear, where do they differ
  async function proofWindow(x, a, ctx, live) {
    const b = a + x.length / LRAudio.RATE, an = ctx.anchors;
    let wA = wordAtA(an, a), wB = wordAtA(an, b);
    if (wA == null) wA = ctx.pos0; if (wB == null) wB = ctx.pos1 != null ? ctx.pos1 : wA + 80;
    const lo = Math.max(0, wA - 6), hi = Math.min(ctx.toks.length - 1, wB + 15), text = [];
    for (let i = lo; i <= hi; i++) if (ctx.mine[i]) text.push({ w: ctx.toks[i].w, i });
    if (!text.length) return 0;
    const heard = await LRProof.hear(x, proofKind(live));
    const issues = LRProof.align(text, heard, proofIgnore(ctx.book));
    let n = 0;
    for (const it of issues) {
      if (ctx.audio.markers.some(m => m.proof && m.proof.from <= it.to && m.proof.to >= it.from)) continue;
      const t = (ctx.audio.anchors || []).find(p => p[1] >= it.from), ctxTxt = ctx.toks.slice(Math.max(0, it.from - 4), it.to + 4).map(z => z.w).join(" ");
      const note = it.kind === "missed" ? "Proof: skipped “" + it.text + "”" : it.kind === "extra" ? "Proof: extra “" + it.heard + "”" : "Proof: heard “" + it.heard + "” for “" + it.text + "”";
      ctx.audio.markers.push({ id: Prep.uid(), t: t ? t[0] : a, w: it.from, ctx: ctxTxt, note, proof: it, auto: true, done: false }); n++;
    }
    if (n) { ctx.audio.markers.sort((p, q) => p.t - q.t); Store.saveBook(ctx.book); if (B && B.audio === ctx.audio) { applyProofMarks(); renderSide(); renderTransport(); } }
    return n;
  }
  function proofCtx(r) { return { book: B.book, audio: B.audio, toks: B.toks, mine: B.mine, anchors: (r ? r.anchors : []).concat(B.audio.anchors || []).sort((p, q) => p[0] - q[0]), pos0: r ? r.pos0 : 0, pos1: B.f.pos }; }
  // live: every ~20 s of recording (and what's left when you stop)
  function proofLive(r, last) {
    const pf = r.pf; if (!pf || (!last && pf.busy)) return;
    const n = pf.n; if (n < LRAudio.RATE * 1.5) return;
    const x = new Float32Array(n); let o = 0; for (const c of pf.buf) { x.set(c, o); o += c.length; }
    const a = pf.a, keep = Math.min(n, Math.round(LRAudio.RATE * 2)), ctx = proofCtx(r);
    pf.buf = [x.slice(n - keep)]; pf.n = keep; pf.a = a + (n - keep) / LRAudio.RATE;     // two seconds carry over, so a word on the seam isn't lost
    if (last) r.pf = null;
    pf.busy = true;
    proofQueue(async () => { const k = await proofWindow(x, a, ctx, true); pf.busy = false; if (last) proofSummary(r, null); return k; });
  }
  // at stop: the whole take, half a minute at a time
  function proofTake(r) {
    const ctx = proofCtx(r), file = r.file, off = r.clip.off, dur = r.clip.dur, start = r.start;
    if (dur < 1) return;
    proofQueue(async () => {
      const d = await dir(); let n = 0;
      for (let s = 0; s < dur - 0.5; s += 28) { const len = Math.min(30, dur - s); n += await proofWindow(await LRAudio.renderRange(d, [{ file, off: off + s, dur: len, at: 0 }], 0, len), start + s, ctx, false); }
      proofSummary(r, n);
    });
  }
  function proofSummary(r, n) {
    if (!B) return;
    const open = B.audio.markers.filter(m => m.proof && !m.done && m.t >= r.start - 0.5).length;
    if (open) notice("🔎 Proof: " + open + " spot" + (open === 1 ? "" : "s") + " to check in that take, underlined in the text. Tools ▸ Pickups lists them.");
    else if (n != null) notice("🔎 Proof: that take matches your text ✓");
  }
  // the whole chapter, your own audio only (partner lines left out, so their words aren't "extra"); returns open flags
  async function proofChapter(onP) {
    if (!(await ensureStudio())) return 0;
    const clips = B.audio.tracks.flatMap(tr => tr.clips.filter(c => !c.line)), L = len(); if (!clips.length || !L) return 0;
    const ctx = proofCtx(null), d = await dir(); ctx.pos0 = 0; ctx.pos1 = B.toks.length - 1;
    for (let t = 0; t < L - 0.5; t += 28) { const n = Math.min(30, L - t); await proofWindow(await LRAudio.renderRange(d, clips, t, n), t, ctx, false); onP && onP(Math.min(1, (t + 30) / L)); }
    applyProofMarks(); renderSide(); renderTransport();
    return B.audio.markers.filter(m => m.proof && !m.done).length;
  }
  function applyProofMarks() {
    const ms = $("#ms"); if (!ms) return; ms.querySelectorAll(".w.proof").forEach(e => e.classList.remove("proof")); ms.querySelectorAll(".w.pk").forEach(e => e.classList.remove("pk"));
    for (const m of (B.audio.markers || [])) if (!m.done && !m.slot) { const sw = pkSentence(m); if (sw) for (let i = sw.s; i <= sw.e; i++) { const e = ms.querySelector('.w[data-i="' + i + '"]'); if (e) e.classList.add("pk"); } }
    for (const m of (B.audio.markers || [])) if (m.proof && !m.done) for (let i = m.proof.from; i <= m.proof.to; i++) { const e = ms.querySelector('.w[data-i="' + i + '"]'); if (e) { e.classList.add("proof"); e.title = m.note; } }
  }
  function proofIgnoreWord(id) {
    const m = B.audio.markers.find(z => z.id === id); if (!m || !m.proof) return;
    const words = (m.proof.text || "").split(" ").filter(Boolean); if (!words.length) { removeMarker(id); return; }
    const bk = B.book; Store.settings.proofIgnore = [...new Set([...(Store.settings.proofIgnore || []), ...words])]; Store.saveSettings();
    const ig = proofIgnore(bk), hit = z => z.proof && (z.proof.text || "").split(" ").every(w => ig.has(LRProof.norm(w)));
    let k = 0; pushUndo();
    for (const ch of bk.chapters || []) for (const au of Object.values(ch.audio || {})) if (au && au.markers) { const n = au.markers.length; au.markers = au.markers.filter(z => !hit(z)); k += n - au.markers.length; }
    { const n = B.audio.markers.length; B.audio.markers = B.audio.markers.filter(z => !hit(z)); k += n - B.audio.markers.length; }
    Store.saveBook(bk); renderSide(); renderTransport(); applyProofMarks(); drawWave();
    notice("🔎 “" + words.join(" ") + "” won't be flagged again in any of your books." + (k > 1 ? " " + k + " flags removed." : " Flag removed."));
  }

  function addMarker(note) {
    const t = B.rec ? B.rec.clip.at + B.rec.clip.dur : (B.playhead != null ? B.playhead : len());
    const ctx = B.toks.slice(Math.max(0, B.f.pos - 5), B.f.pos + 3).map(x => x.w).join(" ");
    B.audio.markers.push({ id: Prep.uid(), t, w: B.f.pos, ctx, note: note || "", done: false });
    B.audio.markers.sort((a, b) => a.t - b.t);
    Store.saveBook(B.book);
    notice("⚑ " + (note ? note + " · " : "Marker at ") + clock(t) + " — “…" + ctx + "…”");
    renderTransport();
  }

