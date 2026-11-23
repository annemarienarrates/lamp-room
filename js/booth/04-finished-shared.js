/* booth/04-finished-shared.js — Finished audio (corrections & assembly) and shared projects (send, lock, the editor's side).
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= finished audio: correct a book that's already recorded, or assemble on a narrator's audio =======================
  async function origDir(create) { const bd = await Store.studio.getDirectoryHandle(B.book.folder, { create: true }); return bd.getDirectoryHandle("originals", { create: !!create }); }
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  function pickAudioFiles() {
    return new Promise(res => { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "audio/*,.mp3,.m4a,.wav,.aif,.aiff,.flac"; inp.onchange = () => res([...inp.files]); inp.oncancel = () => res([]); inp.click(); });
  }
  // one file per chapter, in name order, onto the chapters in order; you confirm before anything is copied
  async function bringOriginals(one) {
    if (B.rec || B.busy || !(await ensureStudio())) return;
    const files = (await pickAudioFiles()).sort((a, b) => natural(a.name, b.name)); if (!files.length) return;
    const chs = one ? [B.ci] : B.book.chapters.map((c, i) => i).filter(i => B.book.chapters[i].included);
    const pairs = one ? [[B.ci, files[0]]] : files.slice(0, chs.length).map((f, k) => [chs[k], f]);
    if (!one && !confirm("Match these files to your chapters?\n\n" + pairs.map(([ci, f]) => B.book.chapters[ci].title + "  ←  " + f.name).join("\n") + (files.length > chs.length ? "\n\n" + (files.length - chs.length) + " extra file(s) left out." : files.length < chs.length ? "\n\n" + (chs.length - files.length) + " chapter(s) get no file." : "") + "\n\nIf a pair is wrong, rename the files so they sort in chapter order and try again.")) return;
    B.busy = "orig"; renderSide(); let k = 0;
    try {
      const od = await origDir(true);
      for (const [ci, f] of pairs) {
        busyNote("Copying finished audio… " + (++k) + " / " + pairs.length);
        const name = "ch" + String(ci + 1).padStart(3, "0") + "-" + f.name.replace(/[^\w.\- ]+/g, "");
        const w = await (await od.getFileHandle(name, { create: true })).createWritable(); await w.write(f); await w.close();
        const ch = B.book.chapters[ci]; ch.orig = { file: name, name: f.name, for: B.readingAs }; delete ch.origMap;
      }
      Store.saveBook(B.book, true);
    } finally { B.busy = null; busyNote(""); }
    notice("📼 " + pairs.length + " chapter" + (pairs.length === 1 ? "" : "s") + " of finished audio brought in. Each one opens on its timeline when you go to that chapter.");
    if (B.chap.orig && B.chap.orig.for === B.readingAs && !B.audio.tracks.some(t => t.clips.some(c => c.base))) await unpackOrig();
    renderSide();
  }
  // put this chapter's finished audio on the timeline (unpacked to WAV for this chapter only)
  async function unpackOrig() {
    if (!B.chap.orig || B.rec || B.busy) return;
    if (!(await ensureStudio())) return;
    B.busy = "orig"; busyNote("Opening this chapter's finished audio…");
    try {
      const f = await (await (await origDir(false)).getFileHandle(B.chap.orig.file)).getFile();
      const x = await decodeFile(f), name = "orig-" + B.chap.id + ".wav", d = await dir();
      const w = await LRAudio.WavWriter.create(d, name, LRAudio.RATE); w.push(x); await w.close();
      const dur = x.length / LRAudio.RATE;
      pushUndo();
      T().overwrite(B.audio, 0, [{ file: name, off: 0, dur, at: 0, base: true }], 0);
      if (B.chap.origMap && !(B.audio.anchors || []).length) B.audio.anchors = B.chap.origMap.map(p => p.slice());
      Store.saveBook(B.book, true); loadPeaks();
    } finally { B.busy = null; busyNote(""); renderEditBar(); renderTransport(); renderSide(); }
  }
  // map: listen through the finished audio and pin the text to it, so a word can be found in the audio
  async function mapChapter(ci, onP) {
    const ch = B.book.chapters[ci]; if (!ch.orig) return 0;
    const f = await (await (await origDir(false)).getFileHandle(ch.orig.file)).getFile();
    const ab = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await f.arrayBuffer()), x = ab.getChannelData(0), L = x.length / 16000;
    const toks = Prep.tokens(ch), mine = toks.map(t => isMine(t, ch)), out = []; let cur = 0;
    for (let a = 0; a < L - 0.5; a += 30) {
      const seg = x.subarray(Math.round(a * 16000), Math.round(Math.min(L, a + 30) * 16000));
      const chunks = await LRProof.hearTimed(seg, 16000);
      const words = [], when = [];
      for (const c of chunks) { const ws = LRProof.split(c.text || ""), t0 = (c.t && c.t[0]) || 0, t1 = (c.t && c.t[1] != null ? c.t[1] : t0 + 2); ws.forEach((w, k) => { words.push(w); when.push(a + t0 + (t1 - t0) * k / Math.max(1, ws.length)); }); }
      const text = []; for (let i = Math.max(0, cur - 15); i < toks.length && text.length < 260; i++) if (mine[i]) text.push({ w: toks[i].w, i });
      const m = LRProof.matches(text, words);
      let last = -9; for (const p of m) if (p.i > cur - 15 && when[p.h] - last >= 1.5) { out.push([+when[p.h].toFixed(2), p.i]); last = when[p.h]; }
      if (m.length) cur = Math.max(cur, m[m.length - 1].i);
      onP && onP(Math.min(1, (a + 30) / L));
    }
    // keep it in order (a stray match backwards is dropped)
    const clean = []; for (const p of out) if (!clean.length || (p[1] > clean[clean.length - 1][1] && p[0] > clean[clean.length - 1][0])) clean.push(p);
    ch.origMap = clean; ch.origMappedAt = new Date().toISOString();
    if (ci === B.ci && B.audio.tracks.some(t => t.clips.length === 1 && t.clips[0].base && t.clips[0].at === 0 && t.clips[0].off === 0) && B.audio.tracks.every(t => t.clips.every(c => c.base))) B.audio.anchors = clean.map(p => p.slice());
    Store.saveBook(B.book, true);
    return clean.length;
  }
  async function mapBook(onlyThis) {
    if (B.rec || B.busy) return;
    const todo = B.book.chapters.map((c, i) => i).filter(i => B.book.chapters[i].orig && (onlyThis ? i === B.ci : !B.book.chapters[i].origMap));
    if (!todo.length) { toast(onlyThis ? "This chapter has no finished audio yet." : "Every chapter with finished audio is mapped."); return; }
    B.busy = "map"; B.mapStop = false; renderSide(); let k = 0;
    try {
      for (const ci of todo) {
        if (B.mapStop || !B) break;
        await mapChapter(ci, p => busyNote("Mapping " + B.book.chapters[ci].title + " (" + (++k > 0 ? todo.indexOf(ci) + 1 : 1) + " of " + todo.length + ")… " + Math.round(p * 100) + "%"));
      }
    } catch (e) { toast("Mapping stopped: " + e.message); }
    finally { if (B) { B.busy = null; busyNote(""); renderSide(); } }
    if (B) notice("🗺 Mapped " + todo.filter(ci => B.book.chapters[ci].origMap).length + " chapter" + (todo.length === 1 ? "" : "s") + ". Find in the audio works on them now.");
  }
  // find a word or phrase everywhere in the book; each hit knows roughly where it is in the audio
  function findInBook(q) {
    const want = LRProof.split(q); if (!want.length) return [];
    const hits = [];
    B.book.chapters.forEach((ch, ci) => {
      if (!ch.included) return;
      const toks = ci === B.ci ? B.toks : Prep.tokens(ch), flat = [];
      toks.forEach((t, i) => LRProof.split(t.w).forEach(w => flat.push({ w, i })));
      for (let k = 0; k + want.length <= flat.length; k++) {
        if (!want.every((w, j) => flat[k + j].w === w || flat[k + j].w.replace(/'/g, "") === w.replace(/'/g, ""))) continue;
        const i = flat[k].i, an = ci === B.ci && (B.audio.anchors || []).length ? B.audio.anchors : ch.origMap || [];
        let t = null; for (const p of an) { if (p[1] > i) break; t = p[0]; }
        hits.push({ ci, i, t, ctx: toks.slice(Math.max(0, i - 5), i + want.length + 5).map(z => z.w).join(" ") });
      }
    });
    return hits;
  }
  async function goHit(ci, i) {
    if (B.rec) return;
    if (ci !== B.ci) { await openChapter(ci); await new Promise(r => setTimeout(r, 400)); }
    const t = T().timeOfWord(B.audio, i), an = B.audio.anchors || []; let tt = null; for (const p of an) { if (p[1] > i) break; tt = p[0]; }
    B.f.set(i); prog().pos = B.f.pos; markPos(true);
    if (tt != null || t != null) { B.playhead = Math.max(0, (tt != null ? tt : t) - 0.5); B.sel = null; }
    renderTransport(); drawWave();
  }
  // replace the selection with a new read: the selection goes, room opens, and it closes up to fit when you stop
  async function replaceSel() {
    if (B.rec || !B.sel) { toast("Select the part to replace first (drag across it on the waveform)."); return; }
    const { a, b } = B.sel, pre = snap();
    T().deleteRange(B.audio, a, b); T().insertGap(B.audio, a, 900);
    B.pendingGap = a + 900; B.pendingMatch = !B.pendingPickup && Store.lsGet("lr-matchlvl") !== "0";
    B.sel = null;
    await startRecording(a, true, pre);
  }
  // the new read at the loudness of the audio around it
  async function matchLevel(r, end) {
    const d = await dir(), rms = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };
    const others = B.audio.tracks.flatMap((tr, k) => tr.clips.filter(c => c.file !== r.file && !c.line));
    const before = await LRAudio.renderRange(d, others, Math.max(0, r.start - 8), Math.min(8, r.start)), after = await LRAudio.renderRange(d, others, end, 8);
    const voiced = x => { const out = []; const hop = 480; for (let i = 0; i + hop <= x.length; i += hop) { const v = rms(x.subarray(i, i + hop)); if (v > 0.01) out.push(v); } out.sort((p, q) => p - q); return out.length ? out[Math.floor(out.length * 0.6)] : 0; };
    const ref = Math.max(voiced(before), voiced(after)); if (!ref) return;
    for (const tr of B.audio.tracks) for (const c of tr.clips) if (c.file === r.file) {
      const mine = voiced(await LRAudio.renderRange(d, [Object.assign({}, c, { at: 0, g: 1 })], 0, c.dur)); if (!mine) continue;
      const g = Math.max(0.25, Math.min(4, ref / mine)); if (Math.abs(g - 1) > 0.06) c.g = +(g).toFixed(3);
    }
  }
  // assembling: the chapter's timeline is the narrator's (their finished audio), every cast line drops into it; your time is still yours
  async function assemble(on) {
    if (B.rec || B.busy) return;
    const narr = Prep.readerOf("n", B.chap, B.book), me = Store.me() || B.readingAs;
    if (on && (!narr || narr === me)) { toast("You narrate this chapter, so its timeline is already yours."); return; }
    B.assembling = !!on; await switchReader(on ? narr : me);
    B.side = null; B.tab = on ? "duet" : "orig"; act("tools");
    if (on) notice("🧩 Assembling " + B.chap.title + ": the timeline is " + narr + "'s narration. Bring in their chapter audio (📼 Finished audio), map it, then Splice all in Collaborate.");
  }
  function origTabHtml() {
    const dis = B.rec || B.busy ? "disabled" : "", ch = B.chap, withO = B.book.chapters.filter(c => c.orig).length, mapped = B.book.chapters.filter(c => c.origMap).length;
    const q = B.findQ || "", hits = B.findHits || [];
    const narr = Prep.readerOf("n", ch, B.book), me = Store.me() || B.readingAs;
    const asm = B.assembling ? `<div class="bd-sec recut"><b>🧩 Assembling ${esc(ch.title)}</b><div class="stu-note">This timeline is ${esc(B.readingAs)}'s narration. Cast lines (yours too, once you've sent them) drop into it with Splice all in 🤝 Collaborate.</div><div class="fx-chips"><button class="stu-btn" data-p="asmoff" ${dis}>← Back to my lines</button></div></div>`
      : narr && narr !== me ? `<div class="bd-sec"><b>🧩 Assemble this chapter</b><div class="stu-note">${esc(narr)} narrates it. 1) Read your own lines here as ${esc(me)} and press 📤 Send my lines. 2) Assemble: the timeline becomes ${esc(narr)}'s audio, and every cast member's lines, yours included, splice into it. Your booth time still counts as yours; no words count while assembling.</div><div class="fx-chips"><button class="stu-btn stu-rec" data-p="asmon" ${dis}>🧩 Assemble this chapter</button></div></div>` : "";
    return asm + `<div class="bd-sec"><b>Finished audio</b><div class="stu-note">For a book that's already recorded (corrections and pickups), or a chapter someone else narrated (cast assembly). The audio goes on the timeline and you edit it like any take. ${B.book.corrections ? "<b>This is a corrections book:</b> your pickups count as booth time, not words." : ""}</div>
        <div class="co-chips"><span>${withO ? withO + " chapter" + (withO === 1 ? "" : "s") + " brought in" : "None yet"}</span>${withO ? `<span class="${mapped === withO ? "ok" : ""}">${mapped} mapped</span>` : ""}${ch.orig ? `<span class="ok">This chapter: ${esc(ch.orig.name)}</span>` : ""}</div>
        <div class="fx-chips"><button class="stu-btn stu-rec" data-p="oall" ${dis}>📼 Bring in the whole book…</button><button class="stu-btn" data-p="oone" ${dis}>Just this chapter…</button></div>
        <label class="check"><input type="checkbox" data-p2="ocorr" ${B.book.corrections ? "checked" : ""} ${dis}> Corrections book (don't count words)</label></div>
      <div class="bd-sec"><b>Map it to the text</b><div class="stu-note">Listens through the finished audio (on this computer) and pins the text to it, so you can find any word in the audio. Roughly 1–3 hours for a 40-hour book; it can run while you do other things, and picks up where it stopped.</div>
        <div class="fx-chips">${B.busy === "map" ? `<button class="stu-btn" data-p="ostop">Stop after this chapter</button>` : `<button class="stu-btn stu-rec" data-p="omap" ${dis} ${withO > mapped ? "" : "disabled"}>🗺 Map the book (${withO - mapped} to go)</button><button class="stu-btn" data-p="omap1" ${dis} ${ch.orig ? "" : "disabled"}>Map this chapter${ch.origMap ? " again" : ""}</button>`}</div></div>
      <div class="bd-sec"><b>Find in the audio</b><div class="stu-note">Every place a word or name appears in the book: the Japanese words, a character's name. Click one to jump there.</div>
        <div class="fx-chips"><input class="stu-in" id="ofind" placeholder="e.g. ojisan" value="${esc(q)}" style="flex:1;min-width:0" onkeydown="if(event.key==='Enter'){event.preventDefault();this.nextElementSibling.click()}"><button class="stu-btn" data-p="ofind">Find</button></div>
        ${q ? `<div class="stu-note">${hits.length} place${hits.length === 1 ? "" : "s"}${hits.some(h => h.t == null) ? " · times show once a chapter is mapped" : ""}</div>` : ""}
        ${hits.slice(0, 200).map((h, k) => `<div class="co-line"><span class="n">${k + 1}</span><span><b data-p="ohit:${h.ci}:${h.i}" class="lnk">${esc(B.book.chapters[h.ci].title)}${h.t != null ? " · " + clock(h.t) : ""}</b><br><i>“…${esc(h.ctx)}…”</i></span><span></span></div>`).join("")}</div>
      <div class="bd-sec"><b>Replace a bit</b><div class="stu-note">Drag across what's wrong on the waveform, then <b>Replace the selection</b>: it goes, you read the fix, and the chapter closes up to fit when you stop. Record on another track (with its own effects) for a character's new voice.</div>
        <div class="fx-chips"><button class="stu-btn stu-rec" data-p="orepl" ${dis}>🎙 Replace the selection</button></div>
        <label class="check"><input type="checkbox" data-p2="omatch" ${Store.lsGet("lr-matchlvl") !== "0" ? "checked" : ""}> Match the loudness of the audio around it</label></div>`;
  }

  function pacerManual() { return Store.settings.pacer === "manual"; }

  // ======================= shared projects: share your takes, and bring in everyone's =======================
  // Everyone on a shared book shares their takes (whole tracks, with where every line sits) to the book's Drive folder,
  // as often as they like: a new share replaces the last, and nothing locks. Anyone can bring in everyone's shares to
  // listen or splice: that timeline is then marked assembled (it's built from shares, so it isn't shared on as yours).
  const nm = r => Store.castName(B.book, r);
  // in a shared book, anyone not on its people list reads outside the Lamp Room: they send a file, and it's dropped in 🤝 Collaborate
  const outsideCast = r => { if (!r || !B.book.shared) return false; const p = (B.book.sharedPeople || []).find(x => Store.samePerson(x.name, r)); return !p || p.role === "outside" || p.role === "editor"; };
  const assembled = () => !!(B && B.book.shared && B.audio && B.audio.assembled);
  async function sharedH(ask) { return B.book.shared ? Store.sharedHandle(B.book, ask) : null; }
  async function connectShared() { let h = await Store.sharedHandle(B.book, true); if (!h) { try { h = await Store.pickSharedFolder(); } catch (e) { return; } const pj = await Store.readProject(h).catch(() => null); if (!pj || pj.id !== B.book.id) { toast("That's not this book's shared folder."); return; } await Store.rememberShared(B.book, h); } B.shReady = true; renderSide(); }
  // who has lines in this chapter: the narrator, and everyone with lines here who reads in the Lamp Room
  function sharedNeeds() {
    const narr = Prep.readerOf("n", B.chap, B.book), out = new Set(narr ? [narr] : []);
    for (const x of everyoneRuns()) if (x.r && !outsideCast(x.r)) out.add(x.r);
    return [...out];
  }
  async function sharedStatus() {
    const sends = await Store.sharedSends(B.book, B.chap), covered = new Set();
    for (const sd of Object.values(sends)) for (const t of sd.tracks || []) covered.add(t.actor || sd.person);
    const need = sharedNeeds(), waiting = need.filter(n => !covered.has(n));
    return { sends, need, waiting, ready: Object.keys(sends).length > 0 };
  }
  function outsideNote() {
    const runs = everyoneRuns().filter(x => outsideCast(x.r));
    const out = [...new Set(runs.map(x => x.r))];
    if (!out.length) return "";
    const rows = out.map(r => { const mine = runs.filter(x => x.r === r), inn = mine.filter(x => placedClip(x)).length;
      return `<div class="co-line ${inn === mine.length ? "placed" : ""}"><span class="n">${inn === mine.length ? "✓" : "…"}</span><span><b>${esc(nm(r))}</b>${nm(r) !== r ? ` <span class="muted small">(${esc(r)})</span>` : ""}<br><i>${inn === mine.length ? "all " + mine.length + " lines in" : inn + " of " + mine.length + " lines in · " + (mine.length - inn) + " still missing"}</i></span></div>`; }).join("");
    return `<div class="bd-sec"><b>Outside the Lamp Room</b>${rows}<div class="stu-note">Their lines come as files. Once everyone's takes are in, drop the file they sent you in <b>🤝 Collaborate</b> ▸ 🎧 <i>name</i>'s file… and Splice all.${out.some(r => nm(r) === r && /^Cast \d$/.test(r)) ? " Give Cast 1–4 their real names on the book page (Who reads what)." : ""}</div></div>`;
  }
  async function sharedTabHtmlAsync() {
    const h = await sharedH(false), me = Store.me() || B.readingAs;
    if (!B.book.shared) return `<div class="bd-sec"><b>📦 Shared</b><div class="stu-note">This book isn't shared. Book page ▸ Shared project sets up a Drive folder for co-narrators and cast.</div></div>`;
    if (!h) return `<div class="bd-sec"><b>📦 Shared</b><div class="stu-note">This computer isn't connected to the book's shared folder yet.</div><div class="fx-chips"><button class="stu-btn stu-rec" data-p="shconn">Connect the shared folder…</button></div></div>`;
    const st = await sharedStatus(), dis = B.rec || B.busy ? "disabled" : "", has = T().hasAudio(B.audio), asm = assembled();
    const mineShared = st.sends[me], when = d => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const newer = asm ? Object.values(st.sends).filter(sd => sd.sentAt > B.audio.assembled && !Store.samePerson(sd.person, me)).map(sd => sd.person) : [];
    const rows = [...new Set(st.need.concat(Object.keys(st.sends)))].map(n => { const sd = st.sends[n], inOther = !sd && !st.waiting.includes(n);
      return `<div class="co-line ${sd || inOther ? "placed" : ""}"><span class="n">${sd || inOther ? "✓" : "…"}</span><span><b>${esc(nm(n))}</b><br><i>${sd ? "shared " + esc(when(sd.sentAt)) : inOther ? "in someone else's takes" : "not shared yet"}</i></span><span></span></div>`; }).join("");
    return `<div class="bd-sec"><b>📦 ${esc(B.chap.title)}</b>
        ${asm ? `<div class="stu-note">🧩 This timeline is built from everyone's shared takes (${esc(when(B.audio.assembled))}). Edit and splice it freely; it stays yours, and isn't shared on as your takes.</div>`
          : `<div class="stu-note">Share your takes whenever you like: your tracks (with their FX settings), your markers and where every line sits. Sharing again replaces what you shared before. Nothing locks.</div>
            <div class="fx-chips"><button class="stu-btn ${mineShared ? "" : "stu-rec"}" data-p="shsend" ${dis} ${has ? "" : "disabled"}>📤 ${mineShared ? "Share again" : "Share my takes"}</button></div>${mineShared ? `<div class="stu-note">You shared ${esc(when(mineShared.sentAt))}.</div>` : ""}`}</div>
      <div class="bd-sec"><b>Everyone's takes</b>${rows}
        ${newer.length ? `<div class="stu-note"><b>${esc(newer.map(nm).join(", "))}</b> shared newer takes since you brought them in.</div>` : ""}
        <div class="stu-note">Bring them in to listen or splice: they become one timeline here, each person's lines in place.${!asm && has ? " Yours are shared first, so nothing of yours is lost; Undo brings back what you had." : ""}</div>
        <div class="fx-chips"><button class="stu-btn ${asm ? "" : "stu-rec"}" data-p="${asm ? "shre" : "shin"}" ${dis} ${st.ready ? "" : "disabled"}>${asm ? "↻ Bring in again" : "Bring in everyone's takes"}</button></div></div>
      ${outsideNote()}
      ${amLead() || asm ? `<div class="bd-sec"><b>Finished</b><div class="stu-note">Exports with your spacing and the delivery name (e.g. 003_Chapter_01) into the shared Finished folder.</div><div class="fx-chips"><button class="stu-btn" data-p="shfin" ${dis} ${has ? "" : "disabled"}>⤓ Export to Finished</button></div></div>` : ""}`;
  }
  function sharedTabHtml() { setTimeout(async () => { const el = document.getElementById("sh-body"); if (el && B) el.innerHTML = await sharedTabHtmlAsync(); }, 0); return `<div id="sh-body"><div class="stu-note">Checking the shared folder…</div></div>`; }
  // send: one WAV per track, the whole chapter long (so positions line up), written before send.json so a half-sent chapter never looks finished
  async function sendToShared(fromDialog) {
    if (B.rec || B.busy) return false;
    const me = Store.me() || B.readingAs;
    if (!(await sharedH(true))) { toast("Connect this computer to the shared folder first (📦 Shared)."); return false; }
    if (assembled()) { toast("This timeline is built from everyone's shares, so it isn't shared on as your takes."); return false; }
    B.busy = "send"; renderSide();
    try {
      const out = await Store.sharedChapterDir(B.book, B.chap, me, true), d = await dir(), L = len(), ts = trackSet(), tracks = [];
      for (let ti = 0; ti < B.audio.tracks.length; ti++) {
        const clips = B.audio.tracks[ti].clips; if (!clips.length) continue;
        const lines = clips.filter(c => c.line), actor = lines.length && lines.length === clips.length ? lines[0].line.r : me;
        const st = ts[ti] || {}, file = LRCredits.cleanName(B.chap.title) + "-" + me.replace(/[^\w]+/g, "") + "-T" + (ti + 1) + ".wav";
        const w = await LRAudio.WavWriter.create(out, file, LRAudio.RATE);
        for (let t = 0; t < L; t += 30) { busyNote("Sending " + B.chap.title + ": track " + (ti + 1) + "… " + Math.round(100 * t / L) + "%"); w.push(await LRAudio.renderRange(d, clips, t, Math.min(30, L - t))); }
        await w.close();
        tracks.push({ file, name: st.name || "Track " + (ti + 1), actor, samples: Math.round(L * LRAudio.RATE), fx: { armed: st.armed || [], chain: LRFx.chainOf(st), vol: st.vol || 0 } });
      }
      // markers go along (flubs, named markers, ✂ line ends, warnings): whoever brings them in splices by them. Slots don't.
      const markers = (B.audio.markers || []).filter(m => !m.slot).map(m => ({ t: m.t, w: m.w, note: m.note || "", ctx: m.ctx || "", cut: !!m.cut, done: !!m.done, auto: !!m.auto }));
      const send = { v: 1, person: me, chapterId: B.chap.id, chapter: B.chap.title, sentAt: new Date().toISOString(), length: L, rate: LRAudio.RATE, tracks, anchors: B.audio.anchors || [], markers, complete: true };
      const fh = await out.getFileHandle("send.json", { create: true }), wr = await fh.createWritable(); await wr.write(JSON.stringify(send, null, 1)); await wr.close();
      B.chap.sent = Object.assign({}, B.chap.sent, { [me]: send.sentAt }); Store.saveBook(B.book, true);
      if (!fromDialog) notice("📤 " + B.chap.title + ": your takes are shared (" + tracks.length + " track" + (tracks.length === 1 ? "" : "s") + "). Share again any time.");
      return true;
    } catch (e) { toast("Couldn't send: " + e.message); return false; }
    finally { B.busy = null; busyNote(""); renderSide(); renderTransport(); }
  }
  // Follow-along sometimes misses a line (short ones: "Yes.") or catches it late, when a reader reads ahead of it.
  // Each reader reads only their own lines, with a pause before each, so the start of such a line can be found in their
  // audio: the first speech after the previous line ends. That start becomes a word timing, so the lines around it splice
  // in the right place, and a flag asks whoever brings it in to give it a listen. Returns the flags as markers on that timeline.
  async function timeLinesByPauses(who, runs, anchors, render, L) {
    const has = r => anchors.find(q => q[1] >= r.from && q[1] <= r.to);
    const todo = runs.filter(r => { const q = has(r); return !q || q[1] - r.from > 3; });
    if (!todo.length || !L) return [];
    const E = await envelope(render, L), flags = [];
    { const all = Array.from(E.env).sort((a, b) => a - b); E.thr = Math.max(all[Math.floor(all.length * 0.1)] * 3.5, 0.0035); }   // the quiet between lines counts, even if it's digital silence
    const thr = E.thr;
    const loudAt = t => (E.env[Math.round(t / 0.01)] || 0) >= thr;
    for (const r of todo) {
      anchors.sort((a, b) => a[0] - b[0]);
      const prev = anchors.filter(q => q[1] < r.from).pop(), next = anchors.find(q => q[1] > r.to), first = has(r);
      const lo = prev ? prev[0] : 0, hi = first ? first[0] : next ? next[0] : L;
      let on = null;
      if (first) on = quietBack(E, first[0], 0.3, lo);                         // late: back to where that stretch of speech began
      else { const end = quietFwd(E, lo + 0.05, 0.35, hi); for (let t = end; t < hi - 0.15; t += 0.01) if (loudAt(t)) { on = t; break; } }   // missed: the next speech after a pause
      if (on == null || on < lo || on >= hi) continue;
      anchors.push([Math.max(0, on - 0.02), r.from]);
      const words = B.toks.slice(r.from, Math.min(r.to + 1, r.from + 6)).map(t => t.w).join(" ");
      flags.push({ t: on, w: r.from, ctx: words, note: who + "'s line “" + words + (r.to - r.from > 5 ? "…" : "") + "” " + (first ? "was caught late" : "wasn't heard") + " by follow-along: placed by its pause. Give it a listen.", auto: true, done: false });
    }
    anchors.sort((a, b) => a[0] - b[0]);
    return flags;
  }
  // bring in: everyone's shares become one timeline, one track per sent track, grouped by actor; separate reads splice in by their words' positions
  async function bringInSends(replace) {
    if (B.rec || B.busy) return;
    const meNow = Store.me() || B.readingAs;
    // my own takes go first, so bringing in never loses them
    if (!assembled() && T().hasAudio(B.audio) && myRuns().length) { if (!(await sendToShared(true))) return; }
    const st = await sharedStatus(); if (!st.ready) { toast("Nobody has shared takes for this chapter yet."); return; }
    if (assembled() && !confirm("Bring everyone's takes in again? This rebuilds the timeline from the latest shares; Undo brings back your edits.")) return;
    B.busy = "bring"; renderSide(); pushUndo();
    try {
      const narr = Prep.readerOf("n", B.chap, B.book), people = Object.keys(st.sends), base = st.sends[narr] ? narr : people[0];
      const ld = await Store.chapterAudioDir(B.book, B.chap), copy = async (sd, t) => {
        const src = await (await sd._dir.getFileHandle(t.file)).getFile();
        if (t.samples && src.size < 44 + t.samples * 3 - 4096) throw new Error(t.file + " is still syncing from Drive. Try again in a minute.");
        const name = "in-" + Prep.uid() + "-" + t.file, w = await (await ld.getFileHandle(name, { create: true })).createWritable(); await w.write(src); await w.close(); return name;
      };
      const tracks = [], ts = []; let anchors = [];
      const addTrack = (actor, t, clips) => { tracks.push({ clips }); ts.push({ name: t.name === actor ? actor : actor + " · " + t.name, group: actor, armed: (t.fx || {}).armed || [], chain: (t.fx || {}).chain, vol: (t.fx || {}).vol || 0 }); return tracks.length - 1; };
      // the base send keeps its timeline
      const bs = st.sends[base]; busyNote("Bringing in " + base + "'s send…");
      for (const t of bs.tracks) { const f = await copy(bs, t); addTrack(t.actor || base, t, [{ file: f, off: 0, dur: bs.length, at: 0 }]); }
      anchors = (bs.anchors || []).map(p => p.slice());
      // everyone's markers come in, tagged with whose they were; the base send's keep their times
      const theirMark = (m, who, t) => Object.assign({}, m, { id: Prep.uid(), t, by: who, note: who + " · " + (m.note || "flub") });
      B.audio.tracks = tracks; B.audio.anchors = anchors; B.audio.markers = (bs.markers || []).map(m => theirMark(m, base, m.t)); B.book.trackSet = B.book.trackSet || {}; B.book.trackSet[B.readingAs] = ts;
      // others' lines (sent, or spliced later from outside cast) go in at the base reader's timings: repair them first
      if (everyoneRuns().some(x => x.r !== base)) { busyNote("Checking " + base + "'s timing…"); const fl = await timeLinesByPauses(base, everyoneRuns().filter(x => x.r === base), B.audio.anchors, await mix(), bs.length); fl.forEach(m => B.audio.markers.push(Object.assign({ id: Prep.uid(), by: base }, m))); }
      // anyone else: cut each of their lines from their read and open room for it before the next word of the narration
      const inBase = p => bs.tracks.some(t => t.actor && t.actor !== base && Store.samePerson(t.actor, p));
      for (const p of people.filter(n => n !== base && !inBase(n))) {
        const sd = st.sends[p], files = []; busyNote("Splicing " + p + "'s lines…");
        for (const t of sd.tracks) files.push(await copy(sd, t));
        const tis = sd.tracks.map(t => addTrack(t.actor || p, t, []));
        while (B.audio.tracks.length < tracks.length) B.audio.tracks.push({ clips: [] });
        const their = (sd.anchors || []).slice().sort((a, b) => a[0] - b[0]);
        { const rr = async (t, d) => { let acc = null; for (const f of files) { const x = await LRAudio.renderRange(ld, [{ file: f, off: 0, dur: sd.length, at: 0 }], t, d); if (!acc) acc = x; else for (let i = 0; i < x.length && i < acc.length; i++) acc[i] += x[i]; } return acc || new Float32Array(0); };
          const fl = await timeLinesByPauses(p, everyoneRuns().filter(x => x.r === p), their, rr, sd.length); sd.markers = (sd.markers || []).concat(fl.map(m => Object.assign({}, m, { note: m.note.replace(/^.*?'s line/, "Line") }))); }
        const timeOf = w => { let x = null; for (const q of their) { if (q[1] >= w) { x = q[0]; break; } } return x; };
        // ✂ line-end marks (C) are the reader's own cut points: a line ends at its mark, not when their next line starts.
        // If follow-along missed a line, the marks between lines place it in order, when there's one mark per gap.
        const cuts = (sd.markers || []).filter(m => m.cut).map(m => m.t).sort((x, y) => x - y), pRuns = everyoneRuns().filter(x => x.r === p);
        const bounds = cuts.length === pRuns.length - 1 || cuts.length === pRuns.length ? [0].concat(cuts.slice(0, pRuns.length - 1), [sd.length]) : null;
        for (const [ri, run] of pRuns.entries()) {
          const a = timeOf(run.from), nx = their.find(q => q[1] > run.to);
          let t0, t1;
          if (a == null) { if (!bounds) continue; t0 = bounds[ri] + 0.05; t1 = bounds[ri + 1] - 0.03; }
          else {
            t0 = Math.max(0, a - 0.15); t1 = Math.min(sd.length, (nx ? nx[0] : a + 3) - 0.05);
            const hi = cuts.find(c => c > a + 0.2), lo = cuts.filter(c => c <= a).pop();
            if (hi != null && (hi < t1 + 0.05 || !nx)) t1 = hi - 0.03;
            if (lo != null) t0 = Math.max(t0, lo + 0.05);
          }
          const dur = Math.max(0.2, t1 - t0);
          // which of their tracks has this line
          let best = 0, most = -1; for (let k = 0; k < sd.tracks.length; k++) { const x = await LRAudio.renderRange(ld, [{ file: files[k], off: 0, dur: sd.length, at: 0 }], t0, dur); let e = 0; for (let i = 0; i < x.length; i += 16) e += x[i] * x[i]; if (e > most) { most = e; best = k; } }
          const ba = (B.audio.anchors || []).find(q => q[1] > run.to), at0 = ba ? ba[0] : len();
          const at = await LRAudio.quietPoint(await mix(), Math.max(0, at0 - 0.05), 0.4, 0.6).catch(() => at0);
          T().insertGap(B.audio, at, dur + 0.3);
          T().overwrite(B.audio, tis[best], [{ file: files[best], off: t0, dur, at: 0, line: { r: p, from: run.from } }], at + 0.15);
          for (const m of (sd.markers || [])) if (m.t >= t0 - 0.05 && m.t <= t1 + 0.05) B.audio.markers.push(theirMark(m, p, at + 0.15 + Math.max(0, m.t - t0)));   // their markers ride with their line
        }
      }
      B.audio.markers.sort((a, b) => a.t - b.t);
      B.audio.assembled = new Date().toISOString();
      edited(); loadPeaks();
      notice("📦 Brought in " + people.length + " " + (people.length === 1 ? "person's takes" : "people's takes") + ": " + B.audio.tracks.length + " tracks, grouped by actor. ⊟ collapses them.");
    } catch (e) { toast("Couldn't bring them in: " + e.message); }
    finally { B.busy = null; busyNote(""); renderSide(); renderTransport(); }
  }

