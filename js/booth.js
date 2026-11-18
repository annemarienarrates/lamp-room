/* The Lamp Room — the Booth & Studio: follow-along manuscript, multitrack recorder, punch-and-roll, editing, export.
   Laid out like Finished Hour's Booth. */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = n => Math.round(n || 0).toLocaleString();
  const clock = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const hm = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m"; };
  const money = n => "$" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const num0 = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
  const T = () => window.LRTimeline;
  const SYNC_LAT = 0.7;            // speech recognition reports a word a little after it was said
  const IDLE_MIN = 5;              // Finished Hour: the chapter clock pauses after 5 idle minutes
  const MAX_TRACKS = 6;
  const RULER = 14;
  const BASE_TEXT = 1.25;          // rem, before A− / A+

  let B = null;

  // ======================= open / close =======================
  async function open(bookId, ci, tab) {
    const book = Store.byId(bookId);
    if (!book) { location.hash = "#/library"; return; }
    if (B && B.book !== book) await close();
    const me = Store.me() || (Store.settings.narrators[0] || {}).name || "Me";
    if (!B) {
      B = { book, readingAs: me, mic: new LRAudio.Mic(), player: new LRAudio.Player(), listening: false, rec: null, playhead: null,
        prerollSec: num0(Store.lsGet("lr-preroll"), 3), follow: Store.lsGet("lr-follow") !== "0",
        edit: false, sessions: [], session: null, peaks: {}, bRun: {}, clockPaused: false, lastAct: Date.now(),
        track: 0, sel: null, laneH: num0(Store.lsGet("lr-laneh"), 72), undo: [], redo: [], fxOpen: {}, fxp: {} };
      let fp = {}; try { fp = JSON.parse(Store.lsGet("lr-fxp") || "{}") || {}; } catch (e) {}
      for (const k in LRFx.KINDS) B.fxp[k] = Object.assign({}, LRFx.KINDS[k].def, fp[k] || {});
      try { B.sessions = await Store.sessions(B.readingAs, 2); } catch (e) { B.sessions = []; }
      B.tick = setInterval(() => { tick(); if (B && ++B.tickN % 30 === 0) checkGoals(); }, 1000); B.tickN = 0;
      B.anchorTimer = setInterval(sampleAnchor, 200);
      document.addEventListener("keydown", onKey);
      ["pointerdown", "keydown", "wheel"].forEach(ev => document.addEventListener(ev, markActive, true));
      window.addEventListener("beforeunload", flushSession);
      window.addEventListener("hashchange", onLeave);
    }
    try { Store.lsSet("lr-last-book", book.id); const o = JSON.parse(Store.lsGet("lr-opened") || "{}"); o[book.id] = Date.now(); Store.lsSet("lr-opened", JSON.stringify(o)); } catch (e) {}
    if (ci == null || isNaN(ci)) ci = firstUnfinished(book);
    if (tab) { B.side = "tools"; B.tab = tab; }
    await openChapter(Math.max(0, Math.min(book.chapters.length - 1, ci)));
  }
  const markActive = () => { if (B) B.lastAct = Date.now(); };
  function firstUnfinished(book) {
    const i = book.chapters.findIndex(c => c.included && !((c.prog || {})[B ? B.readingAs : Store.me()] || {}).done && myCount(book, c).mine > 0);
    return i >= 0 ? i : book.chapters.findIndex(c => c.included);
  }
  function onLeave() { if (!/^#\/booth\//.test(location.hash)) close(); }
  async function close() { { const le = document.getElementById("line-ed"); if (le) le.remove(); const fn = document.getElementById("fnext"); if (fn) fn.remove(); }
    if (!B) return;
    if (B.rec) await stopRecording();
    stopListening(); B.player.stop(); stopPreview(); hidePartPop(); B.mic.close();
    clearInterval(B.tick); clearInterval(B.anchorTimer);
    document.removeEventListener("keydown", onKey);
    ["pointerdown", "keydown", "wheel"].forEach(ev => document.removeEventListener(ev, markActive, true));
    window.removeEventListener("beforeunload", flushSession);
    window.removeEventListener("hashchange", onLeave);
    await flushSession();
    document.body.classList.remove("booth-on", "booth-recording");
    stopLine(); if (window.LRCele) { LRCele.comboEnd(); LRCele.drawCombo(); }
    B = null;
  }

  // ======================= chapter & tracks model =======================
  const isMine = (tok, c) => { const r = Prep.readerOf(tok.part, c, B.book); return !r || r === B.readingAs; };
  function myCount(book, c) {
    const reader = B ? B.readingAs : Store.me();
    const toks = Prep.tokens(c); let mine = 0, done = 0;
    const p = (c.prog || {})[reader] || {}, readTo = p.readTo || 0;
    toks.forEach((t, i) => { const r = Prep.readerOf(t.part, c, book); if (!r || r === reader) { mine++; if (i < readTo) done++; } });
    if (p.done) done = mine;
    return { mine, done };
  }
  function bookCounts() {
    let mine = 0, done = 0;
    B.counts = B.book.chapters.map(c => { const x = c.included ? myCount(B.book, c) : { mine: 0, done: 0 }; mine += x.mine; done += x.done; return x; });
    B.bookMine = mine; B.bookDone = done;
  }
  const progOf = (c, r) => { c.prog = c.prog || {}; return c.prog[r] = c.prog[r] || { pos: 0, readTo: 0, done: false, boothSec: 0 }; };
  const prog = () => progOf(B.chap, B.readingAs);
  // tracks belong to the book (per reader): name, volume (dB), mute, solo
  function trackSet() {
    B.book.trackSet = B.book.trackSet || {};
    const ts = B.book.trackSet[B.readingAs] = B.book.trackSet[B.readingAs] || [{ name: B.readingAs, vol: 0, mute: false, solo: false }];
    return ts;
  }
  function audioOf(c) {
    c.audio = c.audio || {};
    const a = c.audio[B.readingAs] = T().normalize(c.audio[B.readingAs]);
    while (a.tracks.length < trackSet().length) a.tracks.push({ clips: [] });
    return a;
  }
  const len = () => T().length(B.audio);
  async function dir() { return Store.chapterAudioDir(B.book, B.chap); }
  async function mix() { return LRAudio.mixer(await dir(), B.audio, trackSet(), { tone: await toneBuf() }); }

  async function openChapter(ci) {
    if (B.rec) await stopRecording();
    B.player.stop();
    B.ci = ci; B.chap = B.book.chapters[ci];
    B.toks = Prep.tokens(B.chap);
    B.mine = B.toks.map(t => isMine(t, B.chap));
    B.f = Prep.makeFollower(B.toks, B.mine, prog().pos || 0); B.f.setManual(pacerManual());
    B.audio = audioOf(B.chap);
    B.playhead = null; B.sel = null; B.selTake = null; B.view = null; B.undo = []; B.redo = []; hidePartPop();
    B.track = Math.min(B.track, B.audio.tracks.length - 1);
    bookCounts();
    B.peaks = {};
    { const n = B.audio.markers.length; B.audio.markers = B.audio.markers.filter(m => !m.done || m.slot); if (B.audio.markers.length !== n) Store.saveBook(B.book); }   // flags already dealt with don't linger
    render();
    loadPeaks();
    if (B.chap.orig && (!B.chap.orig.for || B.chap.orig.for === B.readingAs) && !B.audio.tracks.some(t => t.clips.some(c => c.base))) setTimeout(() => { if (B && B.ci === ci) unpackOrig().catch(e => toast("Couldn't open this chapter's finished audio: " + e.message)); }, 300);
    setTimeout(() => B && checkGoals(true), 1500);
    if (amLead() && theirRuns().length) setTimeout(async () => { if (B && B.ci === ci) { await bringLines(null, true).catch(() => {}); if (B && B.ci === ci) applyPickups(true).catch(() => {}); } }, 400);
    if (pkForMe().some(q => !Store.pickupReply(B.book, q)) && !B.pkTold) { B.pkTold = true; const n = pkForMe().filter(q => !Store.pickupReply(B.book, q)).length; const who = pkForMe()[0].asker; setTimeout(() => { if (B) toast("🔁 " + who + " asked you for " + n + " pickup" + (n === 1 ? "" : "s") + " in this book. Tools ▸ Pickups."); }, 900); }
    if (B.mine.every(m => !m)) toast("Nothing in this chapter is yours to read as " + B.readingAs + ".");
  }

  // ======================= render (Finished Hour layout) =======================
  const ICON = { rec: "●", stop: "■", play: "▶", pause: "❚❚", punch: "⤓", flag: "⚑", pin: "⌖", users: "👥", undo: "↶", redo: "↷", split: "✂", home: "⏮", end: "⏭", chevL: "‹", chevR: "›", kbd: "⌨", check: "✓", menu: "☰", dl: "⤓", reset: "↺", rows: "☰", sliders: "⚙" };
  const zoom = () => num0(Store.lsGet("lr-tzoom"), 1);
  function render() {
    document.body.classList.add("booth-on");
    const c = B.chap;
    $("#main").innerHTML = `
      <div id="booth-editbar" class="bbar"></div>
      <div id="stats-bar" class="bbar"></div>
      <div id="ms-wrap"><div id="ms-page"><div class="ms-head"><span class="ms-book">${esc(B.book.title)}</span>${c.pov ? `<span class="ms-pov">${esc(c.pov)}'s POV</span>` : ""}</div>
        <div id="ms" class="ms ${B.edit ? "editing" : ""}" style="font-size:${(BASE_TEXT * zoom()).toFixed(2)}rem"></div></div></div>
      <canvas id="voice-wave"></canvas>
      <div id="booth-dock"><div class="bd-grip" id="bd-grip" title="Drag to make the waveform taller or shorter"></div><div class="bd-main" id="bd-main"></div>
        <div class="bd-wavewrap"><div class="trk-heads" id="booth-heads"></div><div class="bd-wave"><canvas id="wave"></canvas></div></div>
      </div>
      <div id="bd-side"></div><div id="bd-chars"></div>`;
    applyReadFont();
    if (window.LRCele) LRCele.drawCombo();
    renderEditBar(); renderManuscript(); renderTransport(); renderStats(); renderSide(); layout(); renderChars();
    const ms = $("#ms"), wrap = $("#ms-wrap");
    ms.addEventListener("mouseup", () => setTimeout(showPartPop, 0));
    wrap.addEventListener("scroll", hidePartPop);
    wrap.addEventListener("wheel", e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); textZoom(Math.max(-0.1, Math.min(0.1, -e.deltaY * 0.004))); }, { passive: false });
    bindGrip();
  }
  function applyReadFont() { document.body.classList.toggle("read-serif", Store.settings.readFont === "serif"); }
  // drag the top edge of the dock to resize the track lanes (like Finished Hour's split)
  function bindGrip() {
    const g = $("#bd-grip"); if (!g) return;
    g.onpointerdown = e => {
      g.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = B.laneH, n = B.audio.tracks.length;
      g.onpointermove = ev => { const h = Math.max(34, Math.min(220, Math.round(h0 + (y0 - ev.clientY) / n))); if (h !== B.laneH) { B.laneH = h; renderTransport(); } };
      g.onpointerup = () => { g.onpointermove = null; g.onpointerup = null; Store.lsSet("lr-laneh", B.laneH); };
    };
  }
  function renderEditBar() {
    const el = $("#booth-editbar"); if (!el) return;
    const n = B.ci + 1, done = !!prog().done, rec = !!B.rec, sel = !!B.sel && !rec, nt = B.audio.tracks.length;
    const bt = (a, label, o) => { o = o || {}; return `<button class="stu-btn ${o.cls || ""}" data-b="${a}" title="${esc(o.tip || "")}" ${o.dis ? "disabled" : ""}>${label}</button>`; };
    el.innerHTML = `
      <div class="bd-grp">${bt("menu", ICON.menu + " Menu ▾", { dis: rec })}</div>
      <div class="bd-grp">${bt("edit", "✎ " + (B.edit ? "Editing text" : "Text editor"), { cls: B.edit ? "on" : "", tip: "Edit the manuscript text", dis: rec })}</div>
      <div class="bd-grp">${bt("cut", "✂ Cut", { dis: !sel, tip: "Cut the selection (⌘X)" })}${bt("copy", "⧉ Copy", { dis: !sel, tip: "Copy the selection (⌘C)" })}${bt("paste", "📋 Paste", { dis: rec || !B.clip, tip: "Paste at the playhead, pushing the rest along (⌘V)" })}${bt("pasteOver", "Paste over", { dis: rec || !B.clip, tip: "Paste over, replacing what's there (⌘⇧V)" })}${bt("del", "Delete", { dis: !sel, tip: "Delete the selection and close the gap (" + kl("del") + ")" })}${B.selTake && !rec ? bt("delTake", "🗑 Delete take", { tip: "Delete the selected take (" + kl("del") + ")" }) : ""}</div>
      <div class="bd-grp">${bt("track", ICON.rows + " Track " + (B.track + 1) + "/" + nt, { dis: rec, tip: "Next track (T)" })}${bt("addTrack", "+ Track", { dis: rec || nt >= MAX_TRACKS, tip: "Add a track to every chapter (Shift+T)" })}</div>
      <div class="bd-grp bd-textzoom">${bt("tsm", "A−", { tip: "Smaller text (" + kl("textSmaller") + ", or ⌘ + scroll over the text)" })}<span class="bd-zl">${Math.round(zoom() * 100)}%</span>${bt("tbg", "A+", { tip: "Larger text (" + kl("textBigger") + ")" })}</div>
      <div class="bd-grp">${bt("smaller", "▾", { tip: "Shorter tracks ([)" })}${bt("bigger", "▴", { tip: "Taller tracks (])" })}${bt("zout", "−", { tip: "Zoom out (−)" })}${bt("zin", "＋", { tip: "Zoom in (=)" })}</div>
      <div class="bd-grp">${bt("readHere", ICON.dl + " Read from here", { dis: rec, tip: "Move your reading position to the start of this chapter" })}${bt("resetCh", ICON.reset + " Reset Ch " + n, { dis: rec, tip: "Clear read marks, booth time and completion on this chapter (recordings are kept)" })}</div>
      <label class="bd-fld" title="How much of the lead-in plays before a punch-in starts recording"><span>Pre-roll</span><select class="stu-sel" data-b="pre">${[0, 1, 2, 3, 4, 5, 8, 10, 15, 20, 30].map(v => `<option value="${v}" ${v === B.prerollSec ? "selected" : ""}>${v ? v + " s" : "Off"}</option>`).join("")}</select></label>
      <span style="flex:1"></span>
      ${bt("chDone", ICON.check + " " + (done ? "Completed · reopen" : "Mark Ch " + n + " complete"), { cls: done ? "" : "bd-done", dis: rec, tip: done ? "This chapter is marked complete. Click to reopen it." : "Mark this chapter complete: stops its booth clock and offers to export it" })}
      ${bt("export", ICON.dl + " Export chapter", { cls: "stu-rec", dis: rec || !T().hasAudio(B.audio), tip: "Export as WAV, MP3, or raw for Auphonic" })}
      <span class="stu-note" id="bd-busy">${esc(B.busyTxt || "")}</span>
      ${bt("keys", ICON.kbd + " Hotkeys", { cls: "bd-quiet" })}`;
    el.onclick = barClick; el.onchange = barChange;
    renderLineEd();
  }
  // ---- the line editor: a partner line that's selected gets a small panel to fix its edges ----
  function selLine() { const st = B && B.selTake; if (!st || B.rec) return null; const c = B.audio.tracks[st.ti] && B.audio.tracks[st.ti].clips[st.ci]; return c && c.line ? { ti: st.ti, ci: st.ci, c } : null; }
  function lineSrc(c) { const rec = duetData()[c.line.r], l = rec && rec.lines.find(z => z.file === c.file); return { l, srcDur: srcDurOf(c.file) || (l ? (l.hin || 0) + l.dur + (l.hout || 0) : null) }; }
  function renderLineEd() {
    let el = $("#line-ed"); const s = selLine();
    if (!s) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "line-ed"; el.className = "line-ed"; document.body.appendChild(el); el.onclick = lineEdClick; }
    const { c } = s, { l, srcDur } = lineSrc(c), runTxt = (theirRuns().find(x => x.r === c.line.r && x.from === c.line.from) || {}).text || "";
    const canOut = srcDur != null && c.off + c.dur < srcDur - 0.01, canIn = c.off > 0.01;
    const b = (a, t, tip, dis) => `<button class="stu-btn" data-le="${a}" title="${esc(tip)}" ${dis ? "disabled" : ""}>${t}</button>`;
    el.innerHTML = `<div class="le-h"><b>${esc(c.line.r)}'s line</b> <i>${esc(qt(short(runTxt, 12)))}</i> <span class="stu-note">${clock(c.at)} · ${c.dur.toFixed(2)} s</span><button class="le-x" data-le="close" aria-label="Close">×</button></div>
      <div class="le-row">${b("hear", "▶ Hear it in place", "Play from just before to just after")}
        <span class="le-g"><span class="stu-note">Start</span>${b("s-", "◀ 50 ms", "Start earlier: brings back audio before the cut", !canIn)}${b("s+", "50 ms ▶", "Start later: trims the front")}</span>
        <span class="le-g"><span class="stu-note">End</span>${b("e-", "◀ 50 ms", "End sooner: trims the tail")}${b("e+", "50 ms ▶", "End later: brings back audio after the cut", !canOut)}</span>
        <span class="le-g"><span class="stu-note">Move</span>${b("m-", "◀", "Nudge 50 ms earlier")}${b("m+", "▶", "Nudge 50 ms later")}</span>
        ${b("reset", "Re-cut from their recording", "Back to the cut they sent", !l || (Math.abs(c.off - (l.hin || 0)) < 0.002 && Math.abs(c.dur - l.dur) < 0.002))}${b("out", "Remove", "Take this line back out")}</div>
      ${srcDur != null && !canOut && !canIn ? `<div class="stu-note">This line was sent before lines carried spare audio at the edges, so it can be trimmed but not extended. Ask for it again (🔁) if a word is clipped.</div>` : ""}
      <div class="stu-note">The rest of the chapter moves along with every change.</div>`;
  }
  async function lineEdClick(e) {
    const bt = e.target.closest("[data-le]"); if (!bt || bt.disabled) return; const a = bt.dataset.le; bt.blur();
    const s = selLine(); if (!s) { renderLineEd(); return; }
    if (a === "close") { B.selTake = null; renderEditBar(); renderTransport(); return; }
    const { ti, ci, c } = s, { l, srcDur } = lineSrc(c);
    if (a === "hear") { B.sel = { a: Math.max(0, c.at - 1.5), b: Math.min(len(), c.at + c.dur + 1.5) }; await togglePlay(true); B.sel = null; return; }
    if (a === "out") { B.selTake = null; deleteTake(ti, ci); return; }
    pushUndo();
    if (a === "s-") T().trimEdge(B.audio, ti, ci, "start", -0.05, true, srcDur);
    else if (a === "s+") T().trimEdge(B.audio, ti, ci, "start", 0.05, true, srcDur);
    else if (a === "e-") T().trimEdge(B.audio, ti, ci, "end", -0.05, true, srcDur);
    else if (a === "e+") T().trimEdge(B.audio, ti, ci, "end", 0.05, true, srcDur);
    else if (a === "m-" || a === "m+") { const d = a === "m+" ? 0.05 : -0.05, tr = B.audio.tracks[ti], prev = tr.clips.filter(z => z !== c && z.at + z.dur <= c.at + 1e-3).reduce((m, z) => Math.max(m, z.at + z.dur), 0), next = tr.clips.filter(z => z !== c && z.at >= c.at + c.dur - 1e-3).reduce((m, z) => Math.min(m, z.at), Infinity);
      c.at = Math.max(prev, Math.min(next - c.dur, c.at + d)); }
    else if (a === "reset" && l) swapClip(ti, ci, l);
    const k = B.audio.tracks[ti].clips.findIndex(z => z.line && z.line.r === c.line.r && z.line.from === c.line.from);
    edited(); B.selTake = k >= 0 ? { ti, ci: k } : null; renderEditBar(); renderTransport();
  }
  function layout() {
    const eb = $("#booth-editbar"), sb = $("#stats-bar"), dk = $("#booth-dock"); if (!eb || !dk) return;
    const st = document.documentElement.style;
    st.setProperty("--bar-h", (eb.offsetHeight + sb.offsetHeight) + "px"); st.setProperty("--dock-h", dk.offsetHeight + "px");
    drawWave();
  }
  window.addEventListener("resize", () => B && layout());
  async function barClick(e) {
    const b = e.target.closest("[data-b]"); if (!b || b.disabled || b.tagName === "SELECT") return;
    const a = b.dataset.b; b.blur();
    if (a === "menu") return navMenu(b);
    if (a === "edit") { B.edit = !B.edit; render(); return; }
    if (a === "tsm" || a === "tbg") return textZoom(a === "tbg" ? 0.1 : -0.1);
    if (a === "delTake") return B.selTake && deleteTake(B.selTake.ti, B.selTake.ci);
    if (a === "zin" || a === "zout") return setZoom(a === "zin" ? 1.5 : 1 / 1.5);
    if (a === "bigger" || a === "smaller") return laneSize(a === "bigger" ? 1.3 : 1 / 1.3);
    if (a === "readHere") { B.f.set(0); prog().pos = B.f.pos; Store.saveBook(B.book); markPos(true); return; }
    if (a === "resetCh") { if (!confirm(`Clear read marks, booth time and completion on chapter ${B.ci + 1} for ${B.readingAs}? Recordings are kept.`)) return; B.chap.prog[B.readingAs] = { pos: 0, readTo: 0, done: false, boothSec: 0 }; delete B.bRun[B.ci]; Store.saveBook(B.book); openChapter(B.ci); return; }
    if (a === "chDone") { if (prog().done) { prog().done = false; Store.saveBook(B.book); bookCounts(); renderEditBar(); renderSide(); } else chapterComplete(true); return; }
    if (a === "keys") return hotkeys();
    if (a === "export") return exportDialog();
    ({ cut, copy, paste: () => paste(false), pasteOver: () => paste(true), del: deleteSel, track: nextTrack, addTrack, addSpace: () => addSpace() }[a] || (() => {}))();
  }
  function barChange(e) { const t = e.target; if (t.dataset.b === "pre") { B.prerollSec = +t.value; Store.lsSet("lr-preroll", B.prerollSec); } t.blur(); }

  function navMenu(btn) {
    const r = btn.getBoundingClientRect(), m = document.createElement("div"); m.className = "pop";
    m.style.left = r.left + "px"; m.style.top = (r.bottom + 4) + "px";
    m.innerHTML = [["#/library", "Dashboard"], ["#/book/" + B.book.id, "This book's page"], ["#/import", "+ New Project"], ["#/calc", "Tools"], ["#/settings", "Settings"], ["#/help", "? Help"]].map(([h, l]) => `<a href="${h}">${l}</a>`).join("") +
      (B.rec ? "" : Store.settings.narrators.filter(n => n.name !== Store.me()).map(n => `<a href="#" data-sw="${esc(n.name)}">👤 Switch to ${esc(n.name)}</a>`).join(""));
    m.querySelectorAll("[data-sw]").forEach(a => a.onclick = e => { e.preventDefault(); Store.setMe(a.dataset.sw); });
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("click", function off() { m.remove(); document.removeEventListener("click", off); }), 0);
  }
  // Every hotkey, like Finished Hour's: one table of actions, each with a default key you can change (stored per computer).
  const ACTIONS = {
    rec: ["Record from the end of the last clip, on the selected track · pause / resume", "R"], stop: ["Stop (finish take / stop playback)", "S"], play: ["Play / stop playback (plays the selection if there is one)", "Space"],
    punch: ["Punch in at the playhead", "Shift+R"], flub: ["Flub: back to the start of the sentence, pre-roll, record", "F"],
    fxLast: ["Apply the last effect you used (to the selection, or the take at the playhead)", "E"],
    marker: ["Drop a flub marker", "M"], custom: ["Drop a named marker (goes into your WAV export)", "N"], click: ["Co-narrator: drop their next line in now (or mark a slot if it hasn't arrived; not recording: at the playhead)", "C"],
    undo: ["Undo", "Ctrl+Z"], redo: ["Redo", "Ctrl+Shift+Z"], cut: ["Cut selection", "Ctrl+X"], copy: ["Copy selection", "Ctrl+C"], paste: ["Paste at the playhead (insert)", "Ctrl+V"],
    pasteOver: ["Paste over (replace)", "Ctrl+Shift+V"], del: ["Delete the selection, or the selected take", "Delete"], selAll: ["Select the whole chapter", "Ctrl+A"],
    selToStart: ["Select from the playhead to the start", "Shift+Home"], selToEnd: ["Select from the playhead to the end", "Shift+End"],
    split: ["Split the take at the playhead", "B"], addSpace: ["Add space at the playhead (room tone if learned)", "G"], track: ["Next track", "T"], addTrack: ["Add a track", "Shift+T"],
    smaller: ["Shorter tracks", "["], bigger: ["Taller tracks", "]"], zoomOut: ["Zoom out (time)", "-"], zoomIn: ["Zoom in (time)", "="],
    textSmaller: ["Smaller manuscript text", "Ctrl+-"], textBigger: ["Larger manuscript text", "Ctrl+="],
    nextLine: ["Jump to your next line", "ArrowDown"], prevLine: ["Back to your previous line", "ArrowUp"],
    nudgeL: ["Nudge the selected take earlier (50 ms)", "Alt+ArrowLeft"], nudgeR: ["Nudge the selected take later (50 ms)", "Alt+ArrowRight"],
    home: ["Playhead to the start", "Home"], end: ["Playhead to the end", "End"], prevFlag: ["Previous flag", ","], nextFlag: ["Next flag", "."],
    tools: ["Open / close the Tools panel", "Shift+P"], escape: ["Stop playback, clear the selection", "Escape"]
  };
  const KEY_ALIAS = { Equal: "=", Minus: "-", Comma: ",", Period: ".", BracketLeft: "[", BracketRight: "]", Space: "Space", Slash: "/", Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\" };
  let KEYS = null;
  function keys() {
    if (KEYS) return KEYS;
    let saved = {}; try { saved = JSON.parse(Store.lsGet("lr-keys") || "{}") || {}; } catch (e) {}
    KEYS = {}; for (const a in ACTIONS) KEYS[a] = saved[a] != null ? saved[a] : ACTIONS[a][1];
    return KEYS;
  }
  const saveKeys = () => { try { Store.lsSet("lr-keys", JSON.stringify(KEYS)); } catch (e) {} };
  const kl = a => { const k = keys()[a]; return k ? k.replace("Ctrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥") : "—"; };
  function comboOf(e) {
    let k = e.code || "";
    if (/^Key[A-Z]$/.test(k)) k = k.slice(3); else if (/^Digit\d$/.test(k)) k = k.slice(5); else if (KEY_ALIAS[k]) k = KEY_ALIAS[k]; else if (k === "Backspace") k = "Delete"; else k = e.key;
    if (["Control", "Shift", "Alt", "Meta"].includes(k)) return null;
    return (e.ctrlKey || e.metaKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + k;
  }
  function hotkeys() {
    const ov = document.createElement("div"); ov.className = "overlay"; let capturing = null;
    const draw = () => { const K = keys();
      ov.innerHTML = `<div class="card reader" style="max-width:640px"><h2>⌨ Booth hotkeys</h2>
        <p class="small muted">Click a key, then press the new combination (Esc cancels). Giving a key to a second action takes it off the first. Fixed: <b>1–6</b> select a track (while recording: carry the take onto it), <b>⌥1–6</b> record on that track (from the end of the last clip).</p>
        <div class="kg">${Object.keys(ACTIONS).map(a => `<div>${esc(ACTIONS[a][0])}</div><div><button class="stu-btn ${capturing === a ? "stu-rec" : ""}" data-k="${a}">${capturing === a ? "Press a key…" : esc(kl(a))}</button>${K[a] ? `<button class="stu-btn" data-clear="${a}" title="No key">✕</button>` : ""}</div>`).join("")}</div>
        <p class="small muted">On the waveform: drag to select, click to place the playhead, click a take's label strip to select the take, drag the strip (or hold ⌥) to move it.</p>
        <div class="row"><button class="btn quiet" data-reset>Reset to defaults</button><div class="spacer"></div><button class="btn primary" data-x>Done</button></div></div>`; };
    const cap = e => {
      if (!capturing) { if (e.key === "Escape") { ov.remove(); document.removeEventListener("keydown", cap, true); } return; }
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === "Escape") { capturing = null; draw(); return; }
      const c = comboOf(e); if (!c) return; const K = keys();
      for (const a in K) if (K[a] === c && a !== capturing) K[a] = "";
      K[capturing] = c; capturing = null; saveKeys(); draw();
    };
    document.addEventListener("keydown", cap, true);
    ov.onclick = e => {
      if (e.target.closest("[data-x]") || e.target === ov) { ov.remove(); document.removeEventListener("keydown", cap, true); renderEditBar(); renderTransport(); return; }
      if (e.target.closest("[data-reset]")) { KEYS = null; Store.lsDel("lr-keys"); draw(); return; }
      const c = e.target.closest("[data-clear]"); if (c) { keys()[c.dataset.clear] = ""; saveKeys(); draw(); return; }
      const k = e.target.closest("[data-k]"); if (k) { capturing = k.dataset.k; draw(); }
    };
    draw(); document.body.appendChild(ov);
  }
  function act(name) {
    const playhead = () => B.playhead != null ? B.playhead : len();
    switch (name) {
      case "rec": return recordToggle();
      case "stop": return B.rec ? stopRecording() : (B.player.stop(), stopPreview(), renderTransport());
      case "play": if (B.rec) { skipLine(); return; } return togglePlay();
      case "punch": return punchAt(playhead());
      case "flub": return flub();
      case "fxLast": return fxLast();
      case "marker": return addMarker();
      case "custom": return customMarker();
      case "click": return duetClick();
      case "undo": return undo();
      case "redo": return redo();
      case "cut": return cut();
      case "copy": return copy();
      case "paste": return paste(false);
      case "pasteOver": return paste(true);
      case "del": return B.selTake ? deleteTake(B.selTake.ti, B.selTake.ci) : deleteSel();
      case "selAll": return selectAll();
      case "selToStart": if (!B.rec && len()) { B.sel = { a: 0, b: playhead() }; B.selTake = null; renderEditBar(); renderTransport(); } return;
      case "selToEnd": if (!B.rec && len()) { B.sel = { a: playhead(), b: len() }; B.selTake = null; renderEditBar(); renderTransport(); } return;
      case "split": return splitHere();
      case "addSpace": return addSpace();
      case "track": return nextTrack();
      case "addTrack": return addTrack();
      case "smaller": return laneSize(1 / 1.3);
      case "bigger": return laneSize(1.3);
      case "zoomOut": return setZoom(1 / 1.5);
      case "zoomIn": return setZoom(1.5);
      case "textSmaller": return textZoom(-0.1);
      case "textBigger": return textZoom(0.1);
      case "nextLine": return pacerManual() ? nextSentence() : jumpLine(1);
      case "prevLine": return jumpLine(-1);
      case "nudgeL": return nudge(-0.05);
      case "nudgeR": return nudge(0.05);
      case "home": return seek(0);
      case "end": return seek(len());
      case "prevFlag": return jumpFlag(-1);
      case "nextFlag": return jumpFlag(1);
      case "tools": B.side = B.side === "tools" ? null : "tools"; return renderSide();
      case "escape": B.player.stop(); stopPreview(); B.sel = null; B.selTake = null; hidePartPop(); renderEditBar(); renderTransport(); return;
    }
  }
  function textZoom(d) {
    const z = Math.max(0.7, Math.min(2.2, zoom() + d)); Store.lsSet("lr-tzoom", z.toFixed(2));
    const ms = $("#ms"); if (ms) ms.style.fontSize = (BASE_TEXT * z).toFixed(2) + "rem";
    $$(".bd-zl").forEach(x => x.textContent = Math.round(z * 100) + "%");
    markPos(true);
  }

  // ---------------- side panels: Chapters & Tools ----------------
  const TOOL_TABS = [["orig", "📼 Finished audio"], ["duet", "👥 Co-narrator"], ["pickups", "🚩 Pickups"], ["fx", "🎛 Effects"], ["chain", "🎚 Track sound"], ["takes", "🎞 Takes"], ["levels", "📏 Levels, fades & spacing"], ["mic", "🎙 Mic & reading"]];
  function renderSide() { if (B && !B.rec) setTimeout(() => B && applyProofMarks(), 0);
    const el = $("#bd-side"); if (!el) return;
    const which = B.side || null;
    document.body.classList.toggle("booth-side-open", !!which);
    if (!which) el.innerHTML = `<button class="bd-tools-tab" data-s="tools">${ICON.sliders} Tools ${ICON.chevR}</button><button class="bd-tools-tab bd-ch-tab" data-s="chapters">${ICON.rows} Chapters ${ICON.chevR}</button>`;
    else {
      const keep = $(".bd-tools", el), top = keep ? keep.scrollTop : 0;
      const head = `<div class="bd-tools-head"><div class="bd-lt"><button class="${which === "tools" ? "on" : ""}" data-s="tools">Tools</button><button class="${which === "chapters" ? "on" : ""}" data-s="chapters">Chapters</button></div><button class="stu-btn" data-s="close" title="Close (${esc(kl("tools"))})">‹</button></div>`;
      let body;
      if (which === "chapters") body = `<div class="bch">${B.book.chapters.map((x, i) => { if (!x.included) return ""; const k = B.counts[i], fin = k.mine && k.done >= k.mine, bs = progOf(x, B.readingAs).boothSec || 0;
            return `<button class="bd-ch ${i === B.ci ? "on" : ""} ${k.mine ? "" : "none"}" data-ci="${i}"><span>${fin ? "✓ " : ""}${esc(x.title)}${x.pov ? `<i class="pov">${esc(x.pov)}'s POV</i>` : ""}</span><em>${k.mine ? num(k.mine - k.done) : "—"}${bs ? " · " + hm(bs) : ""}</em></button>`; }).join("")}</div>`;
      else {
        const tab = B.tab = B.tab || "fx";
        body = `<select class="stu-sel bd-tabsel" data-tab>${TOOL_TABS.map(([k, l]) => `<option value="${k}" ${tab === k ? "selected" : ""}>${l}${k === "takes" && (B.audio.alts || []).length ? " (" + B.audio.alts.length + " kept)" : ""}${k === "pickups" ? (n => n ? " (" + n + ")" : "")(B.audio.markers.filter(m => !m.done && !m.slot).length + pkForMe().filter(q => !Store.pickupReply(B.book, q)).length) : ""}</option>`).join("")}</select>
          <div class="bd-toolbody">${({ orig: origTabHtml, duet: duetTabHtml, pickups: pickupsTabHtml, fx: fxTabHtml, chain: chainTabHtml, takes: takesTabHtml, levels: levelsTabHtml, mic: micTabHtml }[tab] || fxTabHtml)()}</div>`;
      }
      el.innerHTML = `<div class="bd-tools">${head}${body}</div>`;
      const nt = $(".bd-tools", el); if (nt && keep && which === "tools") nt.scrollTop = top;
      if (which === "chapters") { const on = $(".bd-ch.on", el); if (on) on.scrollIntoView({ block: "center" }); }
    }
    el.onclick = sideClick; el.onchange = sideChange; el.oninput = sideInput;
  }
  async function sideClick(e) {
    const b = e.target.closest("[data-s],[data-ci],[data-p]"); if (!b || b.disabled) return;
    if (b.blur && b.tagName === "BUTTON") b.blur();
    if (b.dataset.ci != null) { if (!B.rec) openChapter(+b.dataset.ci); return; }
    if (b.dataset.s) { if (b.dataset.s === "close") B.side = null; else B.side = b.dataset.s; renderSide(); layout(); return; }
    const [cmd, x, y] = b.dataset.p.split(":");
    const P = B.fxp, kind = x;
    switch (cmd) {
      case "open": B.fxOpen[x] = !B.fxOpen[x]; return renderSide();
      case "preset": Object.assign(P[kind], LRFx.KINDS[kind].presets[y]); saveFxp(); return renderSide();
      case "preview": return previewFx(kind);
      case "apply": return applyFx([{ k: kind, p: Object.assign({}, P[kind]) }]);
      case "arm": return armFx(kind, true);
      case "disarm": return armFx(kind, false);
      case "fxtrack": B.fxTrack = +x; return renderSide();
      case "chainpreset": { const st = trackSet()[B.fxTrack]; st.chain = x === "voice" ? LRFx.CHAIN_VOICE() : LRFx.CHAIN_DEFAULT(); Store.saveBook(B.book); chainChanged(); return renderSide(); }
      case "savepreset": return savePreset();
      case "loadpreset": return loadPreset(x);
      case "delpreset": { const ps = Store.settings.fxPresets || {}; if (!confirm("Delete the preset “" + x + "”?")) return; delete ps[x]; Store.saveSettings(); return renderSide(); }
      case "altswap": return swapAlt(x);
      case "altdel": { pushUndo(); B.audio.alts = B.audio.alts.filter(a => a.id !== x); Store.saveBook(B.book); toast("That kept take is gone (Undo brings it back)."); return renderSide(); }
      case "takego": { const tr = B.audio.tracks[+x], c = tr && tr.clips[+y]; if (!c) return; selectTake(+x, +y); return seek(c.at); }
      case "takeplay": { const c = B.audio.tracks[+x].clips[+y]; B.sel = { a: c.at, b: c.at + c.dur }; B.track = +x; return togglePlay(true); }
      case "takedel": return deleteTake(+x, +y);
      case "gain": return gainSel(+x);
      case "gainReset": return gainSel(null);
      case "acx": return acxCheck();
      case "mic": return chooseMic();
      case "send": return sendLines();
      case "sendcopy": return pickCopyFolder();
      case "bring": return bringLines();
      case "bringfrom": return pickLinesFolder();
      case "spliceall": return spliceAll();
      case "oall": return bringOriginals(false);
      case "oone": return bringOriginals(true);
      case "omap": return mapBook(false);
      case "omap1": return mapBook(true);
      case "ostop": B.mapStop = true; toast("Stopping after this chapter."); return;
      case "ofind": { B.findQ = (($("#ofind") || {}).value || "").trim(); B.findHits = findInBook(B.findQ); return renderSide(); }
      case "ohit": return goHit(+x, +y);
      case "orepl": return replaceSel();
      case "asmon": return assemble(true);
      case "asmoff": return assemble(false);
      case "recut": return swapRecut(x);
      case "lplay": { const l = lineFor(theirRuns()[+x]); if (l) playLine(l); return; }
      case "lgo": { const p = placedClip(theirRuns()[+x]); if (p) seek(B.audio.tracks[p.ti].clips[p.ci].at); return; }
      case "lout": return unplace(theirRuns()[+x]);
      case "lin": { const xr = theirRuns()[+x], l = lineFor(xr); if (!l || B.rec) return; pushUndo(); const t = await spliceAt(xr, l, B.playhead != null ? B.playhead : len(), true); B.playhead = t + l.dur + 0.3; edited(); renderSide(); return; }
      case "castdrop": return castDropPick(x);
      case "fzset": return setFades(+($("#fz-in") || {}).value || 0, +($("#fz-out") || {}).value || 0);
      case "fzreset": return resetGainFades();
      case "addspace": return addSpace();
      case "tonelearn": return learnTone();
      case "toneplay": return playTone();
      case "pzprev": await evenPauses(true); return renderSide();
      case "pzapply": return evenPauses(false);
      case "pkrec": { const q = pkForMe().find(z => z.id === x); if (q) pickupRecorder(q); return; }
      case "pkcopy": return copyCastList(x);
      case "pkdrop": { const f = await pickAudioFile(); if (f) return castPickupDrop(x, f); return; }
      case "pkplay": { const q = pkAll().find(z => z.id === x); if (q) playPickupReply(q); return; }
      case "pkin": return applyPickups();
      case "pkcancel": return cancelPickup(x);
      case "lask": return askPickupPrompt(theirRuns()[+x]);
      case "miss": return markMissing(x);
      case "pgo": return pickupPlay(x);
      case "pfix": return pickupFix(x);
      case "pign": return proofIgnoreWord(x);
      case "pdone": return removeMarker(x);
    }
  }
  function sideChange(e) {
    const t = e.target;
    if (t.dataset.tab != null) { B.tab = t.value; renderSide(); t.blur(); return; }
    if (t.dataset.duet) { setDuetOpt(t.dataset.duet, t.checked); renderSide(); return; }
    if (t.dataset.p2 === "ocorr") { B.book.corrections = t.checked; Store.saveBook(B.book, true); renderSide(); return; }
    if (t.dataset.p2 === "castwords") { Store.lsSet("lr-castwords", t.checked ? "1" : "0"); return; }
    if (t.dataset.p2 === "omatch") { Store.lsSet("lr-matchlvl", t.checked ? "1" : "0"); return; }
    if (t.dataset.dv) { const k = t.dataset.dv, d = Store.settings.duet = Object.assign({}, Store.settings.duet || {}); d[k] = k === "clean" ? t.checked : k === "vol" ? (+t.value || 0) / 100 : Math.max(0.3, +t.value || 0.8); Store.saveSettings(); if (k !== "vol" || e.type === "change") renderSide(); return; }
    if (t.dataset.pz) { const v = Math.max(0, parseFloat(t.value) || 0); setPause(t.dataset.pz, v); B.pausePreview = null; renderSide(); return; }
    if (t.dataset.pzc === "fill") { B.book.toneFill = t.checked; Store.saveBook(B.book); return; }
    if (t.dataset.pzc === "onComplete") { setPause("onComplete", t.checked); return; }
    if (t.id === "b-as") { if (Store.settings.narrators.some(n => n.name === t.value)) return Store.setMe(t.value); return switchReader(t.value); }
    if (t.dataset.pk) { const [k, f] = t.dataset.pk.split("."); B.fxp[k][f] = t.value; saveFxp(); renderSide(); return; }
    if (t.dataset.ch) { const st = trackSet()[B.fxTrack]; st.chain = LRFx.chainOf(st); const [g, f] = t.dataset.ch.split("."); if (f) st.chain[g][f] = t.type === "checkbox" ? t.checked : +t.value; else st.chain[g] = t.checked; Store.saveBook(B.book); chainChanged(); renderSide(); return; }
    if (t.dataset.pref) { Store.settings[t.dataset.pref] = t.value; Store.saveSettings(); applyReadFont(); if (t.dataset.pref === "pacer") { B.f.setManual(t.value === "manual"); markPos(false); } if (t.dataset.pref === "theme") { document.documentElement.dataset.theme = t.value; B.col = null; drawWave(); } return; }
  }
  function sideInput(e) {
    const t = e.target;
    if (t.dataset.pv) { const [k, f] = t.dataset.pv.split("."); B.fxp[k][f] = +t.value; const o = t.parentNode.querySelector(".fxv"); if (o) o.textContent = fmtV(+t.value, +t.step) + (t.dataset.u || ""); saveFxp(); return; }
    if (t.dataset.ch && t.type === "range") { const o = t.parentNode.querySelector(".fxv"); if (o) o.textContent = fmtV(+t.value, +t.step) + (t.dataset.u || ""); }
  }
  const fmtV = (v, step) => (+v).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  const rng = (attr, label, min, max, step, val, unit) => `<label class="fxr"><span>${label}</span><input type="range" ${attr} min="${min}" max="${max}" step="${step}" value="${val}" data-u="${esc(unit || "")}"><b class="fxv">${fmtV(val, step)}${esc(unit || "")}</b></label>`;
  function saveFxp() { try { Store.lsSet("lr-fxp", JSON.stringify(B.fxp)); } catch (e) {} }
  function trackPicker() {
    const ts = trackSet(); B.fxTrack = Math.min(B.fxTrack != null ? B.fxTrack : B.track, B.audio.tracks.length - 1);
    return `<div class="fx-tracks">${B.audio.tracks.map((_, i) => `<button class="stu-btn ${i === B.fxTrack ? "on" : ""}" data-p="fxtrack:${i}" title="${esc((ts[i] || {}).name || "")}">${i + 1}${(ts[i] || {}).armed && ts[i].armed.length ? " ●" : ""}</button>`).join("")}<span class="stu-note">${esc((ts[B.fxTrack] || {}).name || "Track " + (B.fxTrack + 1))}</span></div>`;
  }
  function fxTabHtml() {
    const st = trackSet()[B.fxTrack != null ? Math.min(B.fxTrack, B.audio.tracks.length - 1) : B.track] || {}, busy = B.rec || B.busy ? "disabled" : "";
    const armed = st.armed || [], target = B.sel ? "your selection (" + clock(B.sel.b - B.sel.a) + ")" : B.selTake ? "the selected take" : "the whole track";
    let h = `<div class="bd-sec"><b>Effects on a track</b>${trackPicker()}
      <div class="stu-note"><b>Apply</b> changes audio already here (Undo brings the original back). <b>Arm</b> keeps an effect on the track so every new take recorded there gets it when you press Stop, in every chapter.</div>
      ${armed.length ? `<div class="fx-armed"><b>Armed:</b> ${armed.map(e => esc(LRFx.KINDS[e.k].name) + " <i>" + esc(LRFx.KINDS[e.k].sum(e.p)) + "</i>").join(" → ")}</div>` : ""}
      <div class="stu-note">Preview and Apply act on <b>${target}</b>.${B.lastFx ? ` <b>${esc(kl("fxLast"))}</b> repeats ${esc(LRFx.KINDS[B.lastFx[0].k].name.toLowerCase())}.` : ""}</div></div>`;
    h += Object.keys(LRFx.KINDS).map(k => {
      const K = LRFx.KINDS[k], p = B.fxp[k], o = B.fxOpen[k], on = armed.find(e => e.k === k);
      const ctl = K.ctl.map(c => typeof c[2] === "object"
        ? `<label class="fxr"><span>${c[1]}</span><select class="stu-sel" data-pk="${k}.${c[0]}">${Object.keys(c[2]).map(v => `<option value="${v}" ${p[c[0]] === v ? "selected" : ""}>${esc(c[2][v][0])}</option>`).join("")}</select></label>`
        : rng(`data-pv="${k}.${c[0]}"`, c[1], c[2], c[3], c[4], p[c[0]], c[5])).join("");
      return `<div class="fx-card ${on ? "armed" : ""}"><button class="fx-name" data-p="open:${k}"><span>${o ? "▾" : "▸"}</span><b>${K.name}</b><small>${on ? "● armed · " + esc(K.sum(on.p)) : esc(K.note)}</small></button>
        ${o ? `<div class="fx-body">${Object.keys(K.presets).length ? `<div class="fx-chips">${Object.keys(K.presets).map(n => `<button class="stu-btn" data-p="preset:${k}:${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}${ctl}
          <div class="fx-chips"><button class="stu-btn" data-p="preview:${k}" ${busy}>${B.preview && B.preview.k === k ? "■ Stop preview" : "▶ Preview"}</button><button class="stu-btn stu-rec" data-p="apply:${k}" ${busy}>Apply</button>
          <button class="stu-btn" data-p="arm:${k}" ${B.rec ? "disabled" : ""}>${on ? "↻ Update armed" : "⏻ Arm for new takes"}</button>${on ? `<button class="stu-btn" data-p="disarm:${k}">Disarm</button>` : ""}</div></div>` : ""}</div>`;
    }).join("");
    const ps = Store.settings.fxPresets || {};
    h += `<div class="bd-sec"><b>Voice presets</b><div class="stu-note">Save this track's armed effects and track sound as a named voice, then put it on any track or book.</div>
      <div class="fx-chips">${Object.keys(ps).map(n => `<span class="fx-pre"><button class="stu-btn" data-p="loadpreset:${esc(n)}" title="Put this voice on the track">${esc(n)}</button><button class="stu-btn" data-p="delpreset:${esc(n)}" title="Delete">✕</button></span>`).join("")}<button class="stu-btn" data-p="savepreset">＋ Save as preset</button></div></div>`;
    return h;
  }
  function chainTabHtml() {
    const ti = B.fxTrack != null ? Math.min(B.fxTrack, B.audio.tracks.length - 1) : B.track, st = trackSet()[ti] || {}, c = LRFx.chainOf(st);
    const chk = (path, on) => `<label class="check"><input type="checkbox" data-ch="${path}" ${on ? "checked" : ""}> On</label>`;
    const r = (path, l, a, b, s, v, u) => rng(`data-ch="${path}"`, l, a, b, s, v, u);
    return `<div class="bd-sec"><b>Track sound</b>${trackPicker()}
        <div class="stu-note">Plays live and goes into your exports. Your recordings are never altered. Since Auphonic masters for you, leave this off unless you want a voice shaped differently, like a character track.</div>
        <div class="fx-chips"><label class="check"><input type="checkbox" data-ch="on" ${c.on ? "checked" : ""}> <b>Chain on</b></label><button class="stu-btn" data-p="chainpreset:voice">Voice preset</button><button class="stu-btn" data-p="chainpreset:reset">Reset</button></div></div>
      <div class="fx-card"><div class="fx-body"><b>High-pass</b> <small class="muted">rumble below the voice</small>${chk("hpf.on", c.hpf.on)}${r("hpf.f", "Cutoff", 40, 160, 5, c.hpf.f, " Hz")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>Tone EQ</b>${chk("eq.on", c.eq.on)}${r("eq.lo", "Warmth", -6, 6, 0.5, c.eq.lo, " dB")}${r("eq.mud", "Body (300 Hz)", -6, 6, 0.5, c.eq.mud, " dB")}${r("eq.mid", "Presence", -6, 6, 0.5, c.eq.mid, " dB")}${r("eq.hi", "Air", -6, 6, 0.5, c.eq.hi, " dB")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>De-esser</b> <small class="muted">tames harsh “s” sounds</small>${chk("ds.on", c.ds.on)}${r("ds.amt", "Strength", 0, 1, 0.05, c.ds.amt, "")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>Compressor</b>${chk("comp.on", c.comp.on)}${r("comp.thr", "Threshold", -40, -6, 1, c.comp.thr, " dB")}${r("comp.ratio", "Ratio", 1.5, 8, 0.5, c.comp.ratio, ":1")}${r("comp.att", "Attack", 1, 50, 1, c.comp.att, " ms")}${r("comp.rel", "Release", 40, 500, 10, c.comp.rel, " ms")}${r("comp.mk", "Make-up", 0, 12, 0.5, c.comp.mk, " dB")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>Peak limiter</b>${chk("lim.on", c.lim.on)}${r("lim.ceil", "Ceiling", -6, -1, 0.1, c.lim.ceil, " dB")}<div class="stu-note">ACX wants peaks at or under −3 dB.</div></div></div>`;
  }
  function takesTabHtml() {
    const dis = B.rec ? "disabled" : "", ts = trackSet();
    let h = `<div class="bd-sec"><b>Takes in this chapter</b><div class="stu-note">Every take on the timeline. Delete removes just that take: if nothing else is playing under it, the gap closes; otherwise it leaves silence so the other tracks stay in sync. Undo brings it back.</div>`;
    let any = false;
    B.audio.tracks.forEach((tr, ti) => tr.clips.forEach((c, ci) => { any = true; const w = T().wordAt(B.audio, c.at + 0.2), txt = w != null ? B.toks.slice(w, w + 6).map(x => x.w).join(" ") : "";
      h += `<div class="alt-row ${B.selTake && B.selTake.ti === ti && B.selTake.ci === ci ? "on" : ""}"><span><b data-p="takego:${ti}:${ci}" class="lnk">${clock(c.at)}</b> · T${ti + 1} ${esc((ts[ti] || {}).name || "")} · ${clock(c.dur)}${c.fx ? " · 🎛" : ""}${c.g ? " · " + (c.g > 0 ? "+" : "") + c.g + " dB" : ""}<br><i class="muted">${esc(txt)}</i></span>
        <span class="fx-chips"><button class="stu-btn" data-p="takeplay:${ti}:${ci}" ${dis} title="Play this take">▶</button><button class="stu-btn" data-p="takedel:${ti}:${ci}" ${dis} title="Delete this take">🗑</button></span></div>`; }));
    if (!any) h += `<div class="stu-note">No takes yet. Press ${esc(kl("rec"))} to record.</div>`;
    h += `</div><div class="bd-sec"><b>Kept takes</b>`;
    const alts = (B.audio.alts || []).slice().reverse();
    if (!alts.length) h += `<div class="stu-note">When a punch replaces audio, the old take is kept here so you can swap back. The last 14 are kept.</div>`;
    else h += alts.map(a => { const w = T().wordAt(B.audio, a.a + 0.2), txt = w != null ? B.toks.slice(w, w + 6).map(x => x.w).join(" ") : "";
      return `<div class="alt-row"><span><b>${clock(a.a)}</b> · T${a.track + 1} · ${clock(a.len)}<br><i class="muted">${esc(txt)}</i></span><span class="fx-chips"><button class="stu-btn" data-p="altswap:${a.id}" ${dis}>🔁 Swap</button><button class="stu-btn" data-p="altdel:${a.id}" ${dis} title="Forget this kept take">✕</button></span></div>`; }).join("");
    return h + `</div>`;
  }
  function levelsTabHtml() {
    const dis = B.rec || B.busy ? "disabled" : "", a = B.acx && B.acx.ci === B.ci ? B.acx : null;
    const chip = (ok, label, val) => `<span class="acx ${ok ? "ok" : "bad"}">${ok ? "✓" : "✕"} ${label} <b>${val}</b></span>`;
    return spacingHtml() + `<div class="bd-sec"><b>Gain</b><div class="stu-note">Raises or lowers ${B.sel ? "the selection" : B.selTake ? "the selected take" : "a selection or take (select one first)"} on track ${B.track + 1}. Nothing is re-recorded or rewritten.</div>
        <div class="fx-chips">${[-6, -3, -1, 1, 3, 6].map(v => `<button class="stu-btn" data-p="gain:${v}" ${dis} ${B.sel || B.selTake ? "" : "disabled"}>${v > 0 ? "+" : ""}${v} dB</button>`).join("")}<button class="stu-btn" data-p="gainReset" ${dis} ${B.sel || B.selTake ? "" : "disabled"}>Reset</button></div></div>
      <div class="bd-sec"><b>ACX check</b><div class="stu-note">Measures this chapter as it will export (all tracks, track sound included): loudness between −23 and −18 dB RMS, peaks at or under −3 dB, room tone at or under −60 dB.</div>
        ${a ? `<div class="fx-chips">${chip(a.rms >= -23 && a.rms <= -18, "RMS", a.rms.toFixed(1) + " dB")}${chip(a.peak <= -3, "Peak", a.peak.toFixed(1) + " dB")}${chip(a.floor <= -60, "Noise floor", a.floor.toFixed(1) + " dB")}</div>
          <div class="stu-note">${a.rms < -23 ? "Too quiet overall — Auphonic will level it, or raise the gain. " : a.rms > -18 ? "Louder than ACX allows on average. " : ""}${a.peak > -3 ? "Some peaks are too hot. " : ""}${a.floor > -60 ? "The room tone is noisy; check the room and gain. " : ""}${a.rms >= -23 && a.rms <= -18 && a.peak <= -3 && a.floor <= -60 ? "Passes." : ""}</div>` : ""}
        <div class="fx-chips"><button class="stu-btn" data-p="acx" ${dis} ${len() ? "" : "disabled"}>${B.busy === "acx" ? "Checking…" : "Check this chapter"}</button></div></div>`;
  }
  function micTabHtml() {
    const S = Store.settings, readers = [...new Set([B.readingAs, ...S.narrators.map(n => n.name)])];
    return `<div class="bd-sec"><b>Reading as</b><select class="stu-sel" id="b-as" ${B.rec ? "disabled" : ""}>${readers.map(nm => `<option ${nm === B.readingAs ? "selected" : ""}>${esc(nm)}</option>`).join("")}</select>
        <div class="stu-note">Your lines are lit; other readers' lines are dimmed, with the line before yours as a grey cue. Select words in the text to change who reads them.</div></div>
      <div class="bd-sec"><b>Reading</b>
        <label class="fxr"><span>Moving on</span><select class="stu-sel" data-pref="pacer"><option value="auto" ${S.pacer !== "manual" ? "selected" : ""}>Automatic: follows my voice into the next sentence</option><option value="manual" ${S.pacer === "manual" ? "selected" : ""}>Manual: I press Next (good for re-reading)</option></select></label>
        <label class="fxr"><span>Proofing</span><select class="stu-sel" data-pref="proofMode">${[["off", "Off"], ["stop", "When I stop"], ["live", "Live, as I read"]].map(([v, l]) => `<option value="${v}" ${(S.proofMode || "off") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="stu-note">Manual: the highlight stops at the end of each sentence, however often you re-read it. Next sentence (bottom right, or ${esc(kl("nextLine").replace("ArrowDown", "↓"))}) moves on.</div></div>
      <div class="bd-sec"><b>Microphone</b><button class="stu-btn" data-p="mic">🎙 ${esc(B.mic.label ? B.mic.label.slice(0, 34) : "Choose microphone")}</button>
        ${B.mic.isOpen ? (inf => `<div class="stu-note">Capture: <b>${inf.mode === "direct" ? "direct" : inf.mode === "worklet" ? "audio worklet" : "fallback"}</b>${inf.rate ? " · mic at " + (inf.rate / 1000) + " kHz" : ""}${inf.rate && inf.rate !== LRAudio.RATE ? ' · <b class="warn-t">set it to 48 kHz in Audio MIDI Setup</b>' : ""} · ${inf.drops ? '<b class="warn-t">' + inf.drops + " dropout" + (inf.drops === 1 ? "" : "s") + " this session</b>" : "no dropouts"}</div>`)(B.mic.info) : ""}</div>
      <div class="bd-sec"><b>Look</b><label class="fxr"><span>Theme</span><select class="stu-sel" data-pref="theme">${[["ledger", "Ledger"], ["archive", "Archive"], ["lamp", "Lamp"], ["nocturne", "Nocturne"], ["foundry", "Foundry"], ["afterglow", "Afterglow"], ["velvet", "Velvet"], ["signal", "Signal"], ["phosphor", "Phosphor"], ["sanguine", "Sanguine"]].map(([k, l]) => `<option value="${k}" ${(S.theme || "ledger") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="fxr"><span>Reading font</span><select class="stu-sel" data-pref="readFont"><option value="sans" ${S.readFont !== "serif" ? "selected" : ""}>Sans (clean)</option><option value="serif" ${S.readFont === "serif" ? "selected" : ""}>Serif (book)</option></select></label>
        <div class="stu-note">Text size: A− / A+ in the bar above, ${esc(kl("textSmaller"))} / ${esc(kl("textBigger"))}, or ⌘ + scroll over the text.</div></div>
      <a class="stu-btn" href="#/book/${esc(B.book.id)}">Book page →</a>`;
  }
  // after a take with co-narrator lines in it: honour skips, and (if asked) clear your own track under their lines,
  // where you were silent and the mic only heard their line in your headphones
  function afterDuetTake(r) {
    if (!r || !r.drops || !r.drops.length) return;
    const tr = r.track;
    for (const sk of (r.skips || []).slice().sort((a, b) => b.at - a.at)) {
      T().insertGapExcept(B.audio, sk.at, sk.need, sk.ti);
      for (const d of r.drops) { if (d.t >= sk.at - 1e-3) d.t += sk.need; if (d.speak != null && d.speak >= sk.at - 1e-3) d.speak += sk.need; }
    }
    if ((Store.settings.duet || {}).clean === false) return;
    for (const d of r.drops) {
      const a = d.t + 0.05, b = Math.min(d.t + d.dur, d.speak != null ? d.speak - 0.12 : d.t + d.dur) - 0.05;
      if (b - a > 0.2) T().clear(B.audio, [tr], a, b);
    }
  }
  // pickups changed in the shared folder: new asks for me, or replies for my asks
  document.addEventListener("lr-external", e => {
    if (!B || !/^#\/booth\//.test(location.hash) || !(e.detail || []).includes("pickups")) return;
    const n = pkForMe().filter(q => !Store.pickupReply(B.book, q)).length;
    if (n && n !== B.pkSeen) toast("🔁 " + n + " pickup" + (n === 1 ? "" : "s") + " waiting for you in this book: Tools ▸ Pickups.");
    B.pkSeen = n; applyPickups(true).catch(() => {}); renderSide();
  });
  // someone else sat down at this computer: their hotkeys, sizes and look come with them
  document.addEventListener("lr-me", async e => {
    if (B) B.assembling = false;
    KEYS = null;
    if (!B || !/^#\/booth\//.test(location.hash)) return;
    B.laneH = num0(Store.lsGet("lr-laneh"), 72); B.prerollSec = num0(Store.lsGet("lr-preroll"), 3); B.follow = Store.lsGet("lr-follow") !== "0";
    let fp = {}; try { fp = JSON.parse(Store.lsGet("lr-fxp") || "{}") || {}; } catch (er) {}
    for (const k in LRFx.KINDS) B.fxp[k] = Object.assign({}, LRFx.KINDS[k].def, fp[k] || {});
    if (B.view) B.view.pps = num0(Store.lsGet("lr-pps"), 40);
    B.col = null; applyReadFont(); await switchReader(e.detail.to);
  });
  async function switchReader(name) { if (!B) return; await flushSession(); if (!B) return; B.session = null; B.readingAs = name; B.pkTold = false; let ss = []; try { ss = await Store.sessions(name, 2); } catch (er) {} if (!B) return; B.sessions = ss; openChapter(B.ci); }

  function altsHtml() { return ""; }
  function swapAlt(id) {
    const al = (B.audio.alts || []).find(x => x.id === id); if (!al || B.rec) return;
    pushUndo();
    const cur = T().extract(B.audio, al.track, al.a, al.a + al.len);
    T().clear(B.audio, [al.track], al.a, al.a + al.len);
    al.clips.forEach(k => B.audio.tracks[al.track].clips.push(Object.assign({}, k, { at: al.a + k.at })));
    B.audio.tracks[al.track].clips.sort((a, b) => a.at - b.at); al.clips = cur;
    B.sel = { a: al.a, b: al.a + al.len }; B.playhead = al.a; B.track = al.track;
    Store.saveBook(B.book); loadPeaks(); renderEditBar(); renderTransport(); renderSide();
    notice("🔁 Swapped the take at " + clock(al.a) + ". Swap again to go back.");
  }

  // ---------------- manuscript ----------------
  function renderManuscript() {
    const ms = $("#ms"); if (!ms) return;
    const c = B.chap;
    if (B.edit) {
      ms.innerHTML = c.paras.map((p, pi) => p === Prep.SCENE_MARK ? `<div class="brk">⁂</div>` :
        `<p data-p="${pi}">${Prep.paraRuns(p).map(([t, part], ri) => `<span class="run pt-${part.replace(/[^a-z]/g, "")} ${Prep.readerOf(part, c, B.book) && Prep.readerOf(part, c, B.book) !== B.readingAs ? "other" : ""}" contenteditable="true" data-ri="${ri}">${esc(t)}</span>`).join("")}</p>`).join("");
      $$(".run", ms).forEach(el => el.onblur = () => {
        const pi = +el.parentNode.dataset.p, ri = +el.dataset.ri, p = c.paras[pi], txt = el.textContent;
        if (typeof p === "string") c.paras[pi] = txt; else p.r[ri][0] = txt;
        c.words = Prep.countWords(c.paras.map(Prep.paraText).join(" "));
        B.toks = Prep.tokens(c); B.mine = B.toks.map(t => isMine(t, c)); const pos = B.f.pos; B.f = Prep.makeFollower(B.toks, B.mine, pos); B.f.setManual(pacerManual());
        Store.saveBook(B.book); bookCounts(); renderStats();
      });
      return;
    }
    let html = "";
    const cueFrom = new Set();
    for (let i = 1; i < B.toks.length; i++) if (B.mine[i] && !B.mine[i - 1]) { let j = i - 1; while (j >= 0 && !B.mine[j] && B.toks[j].p === B.toks[i - 1].p) { cueFrom.add(j); j--; } }
    const tokenByPara = {}; B.toks.forEach((t, i) => (tokenByPara[t.p] = tokenByPara[t.p] || []).push(i));
    c.paras.forEach((p, pi) => {
      if (p === Prep.SCENE_MARK) { html += `<div class="brk">⁂</div>`; return; }
      const ids = tokenByPara[pi] || [];
      html += `<p>` + ids.map(i => `<span class="${B.mine[i] ? "w mine" : cueFrom.has(i) ? "w cue" : "w other"}${i < B.f.pos && B.mine[i] ? " read" : ""}" data-i="${i}">${esc(B.toks[i].w)}</span>`).join(" ") + `</p>`;
    });
    ms.innerHTML = html;
    ms.onclick = e => { const w = e.target.closest(".w"), sel = window.getSelection(); if (!w || (sel && !sel.isCollapsed)) return; clickWord(+w.dataset.i); };
    markPos(true); applyProofMarks();
  }
  function markPos(scroll) {
    renderPacer(); if (!B.rec) applyProofMarks();
    const ms = $("#ms"); if (!ms || B.edit) return;
    $$(".w.cur", ms).forEach(e => e.classList.remove("cur"));
    $$(".w.mine", ms).forEach(e => e.classList.toggle("read", +e.dataset.i < B.f.pos));
    const cur = ms.querySelector(`.w[data-i="${B.f.pos}"]`);
    if (cur) { cur.classList.add("cur"); if (scroll) { const wrap = $("#ms-wrap"), r = cur.getBoundingClientRect(), wr = wrap.getBoundingClientRect(); if (r.top < wr.top + wr.height * 0.15 || r.top > wr.top + wr.height * 0.6) wrap.scrollTo({ top: wrap.scrollTop + r.top - wr.top - wr.height * 0.33, behavior: "smooth" }); } }
  }

  // ---------------- dock: transport, clocks, level, flags; track heads & lanes ----------------
  function renderTransport() {
    const tp = $("#bd-main"); if (!tp) return;
    const rec = B.rec, playing = B.player.playing, L = len(), has = L > 0;
    const head = B.playhead != null ? B.playhead : L, flags = B.audio.markers.length;
    const bt = (a, label, o) => { o = o || {}; return `<button class="stu-btn ${o.cls || ""}" data-b="${a}" title="${esc(o.tip || "")}" ${o.dis ? "disabled" : ""}>${label}</button>`; };
    const G = (cls, inner) => `<div class="bd-grp ${cls || ""}">${inner}</div>`;
    const cs = clockState();
    tp.innerHTML = `<div class="bd-row bd-r1">` +
      G("bd-transport", bt("rec", rec ? (rec.paused ? ICON.play + " Resume" : ICON.pause + " Pause") : ICON.rec + " Record" + (B.track > 0 ? " T" + (B.track + 1) : ""), { cls: "bd-rec" + (rec && !rec.paused ? " live" : ""), tip: "Record · pause / resume (" + kl("rec") + ")", dis: playing }) +
        bt("stop", ICON.stop + " Stop", { tip: "Stop (" + kl("stop") + ")", dis: !rec && !playing }) +
        bt("play", playing ? ICON.stop + " Playing" : ICON.play + " Play", { tip: "Play / stop (" + kl("play") + ")", dis: rec || !has }) +
        bt("punch", ICON.punch + " Punch " + clock(head), { cls: "bd-punch", tip: "Punch in at the playhead (" + kl("punch") + ")", dis: rec || !has }) +
        bt("flub", "↺ Flub", { tip: "Back to the sentence start, pre-roll, record (" + kl("flub") + ")", dis: !has && !rec })) +
      G("", bt("marker", ICON.flag + " Marker", { tip: "Flub marker (" + kl("marker") + ")" }) + bt("custom", ICON.pin + " Custom", { tip: "Named marker (" + kl("custom") + ") — goes into your WAV export" }) + bt("click", ICON.users + " Click", { tip: "Co-narrator: drop their next line in now (" + kl("click") + "). Auto-place usually does it for you." })) +
      `<div class="bd-lcd bd-booth ${cs.on ? "" : "paused"}" data-b="clock" role="button" tabindex="0" title="Booth time on this chapter: starts the first time you press Record on it and stops when you mark the chapter complete. It keeps running when you press Stop (playing back, punching in) and pauses after ${IDLE_MIN} idle minutes. Click to ${cs.label === "booth" ? "pause" : "start"} the clock."><span class="bd-time" id="bd-booth">${clock(prog().boothSec)}</span><span class="bd-bl" id="bd-bl">${cs.label}</span></div>` +
      `<div class="bd-lcd" title="Finished time of this chapter (what you've recorded; the take in progress while recording)"><i class="bd-recdot ${rec && !rec.paused ? "on" : ""}"></i><span class="bd-bl">FH</span><span class="bd-time" id="bd-time">${clock(L)}</span><span class="stu-bar"><i id="bd-lvl"></i></span></div>` +
      `<div class="bd-lcd bd-lm" title="Raw-audio level check. Speak at narration volume: aim for the green band (peaks between −12 and −6 dB)."><button class="stu-btn ${B.lmOn ? "stu-rec" : ""}" data-b="level" ${rec ? "disabled" : ""}>🎚 ${B.lmOn ? "Level on" : "Level"}</button><span class="lm-track"><i class="lm-fill" id="lm-fill"></i><b class="lm-band"></b></span><span class="stu-chip" id="lm-msg">${B.lmOn || rec ? "Say a line…" : "Meter off"}</span></div>` +
      (B.sel ? `<span class="bd-selchip">Selected ${clock(B.sel.b - B.sel.a)}</span>` : "") +
      `<label class="bd-link" title="Start and stop follow-along together with recording"><input type="checkbox" data-b="link" ${B.follow ? "checked" : ""}> with listening</label>` +
      `<div class="bd-right">` + G("", bt("home", ICON.home, { tip: "Playhead to start (Home)", dis: rec }) + bt("end", ICON.end, { tip: "Playhead to end (End)", dis: rec })) +
        G("", bt("undo", ICON.undo, { tip: "Undo (⌘Z)", dis: rec || !B.undo.length }) + bt("redo", ICON.redo, { tip: "Redo (⌘⇧Z)", dis: rec || !B.redo.length }) + bt("split", ICON.split + " Split", { tip: "Split the take at the playhead (B)", dis: rec || !has })) +
        G("", bt("zoomOut", "−", { tip: "Zoom out (−, or ⌘-scroll)" }) + bt("zoomIn", "+", { tip: "Zoom in (=, or ⌘-scroll)" }) + bt("fit", "⤢ Fit", { tip: "See the whole chapter" })) +
        G("", bt("prevFlag", ICON.chevL, { tip: "Previous flag (,)", dis: rec || !flags }) + `<button class="stu-btn" data-b="flags" title="See every flag in this chapter">${ICON.flag} ${flags} flag${flags === 1 ? "" : "s"}</button>` + bt("nextFlag", ICON.chevR, { tip: "Next flag (.)", dis: rec || !flags })) +
      `</div></div>`;
    tp.onclick = dockClick;
    tp.onchange = e => { if (e.target.dataset.b === "link") { B.follow = e.target.checked; Store.lsSet("lr-follow", B.follow ? "1" : "0"); if (!B.follow) stopListening(); else if (B.rec) startListening(); } e.target.blur(); };
    renderHeads();
    const cv = $("#wave"); if (cv) { cv.style.height = (RULER + B.laneH * B.audio.tracks.length) + "px"; bindWave(cv); }
    document.body.classList.toggle("booth-recording", !!rec);
    if ($("#booth-editbar")) requestAnimationFrame(layout);
    drawWave();
  }
  function renderHeads() {
    const hd = $("#booth-heads"); if (!hd) return;
    const ts = trackSet(), rec = B.rec;
    hd.style.paddingTop = RULER + "px";
    hd.innerHTML = B.audio.tracks.map((tr, i) => {
      const s = ts[i] || {}, on = i === B.track;
      return `<div class="trk-head ${on ? "sel" : ""} ${s.mute ? "dim" : ""}" data-t="${i}" style="height:${B.laneH - 2}px">
        <div class="th-r1"><b>${i + 1}</b><input class="th-name" data-tn="${i}" value="${esc(s.name || "Track " + (i + 1))}" ${rec ? "disabled" : ""}><button class="th-fx ${(s.armed || []).length || LRFx.chainActive(LRFx.chainOf(s)) ? "on" : ""}" data-tf="${i}" title="Effects on this track${(s.armed || []).length ? ": " + esc(s.armed.map(e => LRFx.KINDS[e.k].name).join(", ")) + " armed" : ""}">FX</button>${B.audio.tracks.length > 1 ? `<button data-tx="${i}" title="Remove this track from every chapter" ${rec ? "disabled" : ""}>✕</button>` : ""}</div>
        ${B.laneH >= 46 ? `<div class="th-r2"><button class="${s.mute ? "m-on" : ""}" data-tm="${i}" title="Mute">M</button><button class="${s.solo ? "s-on" : ""}" data-ts="${i}" title="Solo">S</button><input type="range" class="th-vol" min="-24" max="12" step="0.5" value="${s.vol || 0}" data-tv="${i}" title="Volume ${(s.vol || 0) > 0 ? "+" : ""}${s.vol || 0} dB"></div>` : ""}
        ${B.laneH >= 60 ? `<div class="th-sub">${rec && rec.track === i ? (rec.paused ? "paused" : "● recording") : clock(T().trackLen(tr))}</div>` : ""}</div>`;
    }).join("");
    hd.onclick = e => {
      const t = e.target, ts2 = trackSet();
      if (t.dataset.tm != null) { const s = ts2[+t.dataset.tm]; s.mute = !s.mute; saveTracks(); return; }
      if (t.dataset.ts != null) { const s = ts2[+t.dataset.ts]; s.solo = !s.solo; saveTracks(); return; }
      if (t.dataset.tx != null) { removeTrack(+t.dataset.tx); return; }
      if (t.dataset.tf != null) { B.side = "tools"; B.tab = "fx"; B.fxTrack = +t.dataset.tf; renderSide(); return; }
      const h = t.closest("[data-t]"); if (h && !B.rec && t.tagName !== "INPUT") { B.track = +h.dataset.t; renderEditBar(); renderTransport(); }
    };
    hd.oninput = e => { const t = e.target; if (t.dataset.tv != null) { trackSet()[+t.dataset.tv].vol = +t.value; t.title = "Volume " + t.value + " dB"; Store.saveBook(B.book); } };
    hd.onchange = e => { const t = e.target; if (t.dataset.tn != null) { trackSet()[+t.dataset.tn].name = t.value.trim() || "Track " + (+t.dataset.tn + 1); Store.saveBook(B.book); t.blur(); } };
  }
  function saveTracks() { Store.saveBook(B.book); renderTransport(); }
  function dockClick(e) {
    const b = e.target.closest("[data-b]"); if (!b || b.disabled || b.tagName === "INPUT" || b.tagName === "LABEL") return;
    if (b.blur) b.blur();
    const a = b.dataset.b;
    ({ rec: () => recordToggle(), stop: () => B.rec ? stopRecording() : (B.player.stop(), renderTransport()), play: () => togglePlay(), flub,
      punch: () => punchAt(B.playhead != null ? B.playhead : len()), marker: () => addMarker(), custom: customMarker,
      clock: clockClick, level: levelToggle, split: splitHere, click: () => act("click"), zoomOut: () => setZoom(1 / 1.5), zoomIn: () => setZoom(1.5), fit: fitZoom,
      home: () => seek(0), end: () => seek(len()), undo, redo, prevFlag: () => jumpFlag(-1), nextFlag: () => jumpFlag(1), flags: flagList }[a] || (() => {}))();
  }
  async function levelToggle() {
    if (B.lmOn) { B.lmOn = false; renderTransport(); return; }
    if (!(await ensureMic())) return; B.lmOn = true; B.mic.peakHold = -90; B.lmT = Date.now(); renderTransport();
    const loop = () => { if (!B || !B.lmOn) return; meters(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }
  function customMarker() { const note = prompt("Name this marker (it goes into your WAV export):", ""); if (note == null) return; addMarker(note.trim() || "Marker"); }
  function jumpFlag(dir) {
    const ms = B.audio.markers; if (!ms.length) return;
    const now = B.playhead != null ? B.playhead : len();
    const m = dir > 0 ? ms.find(x => x.t > now + 1.05) || ms[0] : [...ms].reverse().find(x => x.t < now + 0.95) || ms[ms.length - 1];
    seek(Math.max(0, m.t - 1));
  }
  function flagList() {
    const ov = document.createElement("div"); ov.className = "overlay";
    const draw = () => ov.innerHTML = `<div class="card reader" style="max-width:620px"><h2>${ICON.flag} Flags in ${esc(B.chap.title)}</h2>
      ${B.audio.markers.length ? `<table class="ch">${B.audio.markers.map((m, i) => `<tr><td style="width:70px"><b>${clock(m.t)}</b></td><td>${m.note ? "<b>" + esc(m.note) + "</b> · " : ""}<span class="muted">“…${esc(m.ctx || "")}…”</span></td>
        <td style="white-space:nowrap"><button class="btn small" data-go="${i}">Go</button><button class="btn small quiet" data-del="${i}">✕</button></td></tr>`).join("")}</table>` : `<p class="muted">No flags yet. Press M while recording to drop one.</p>`}
      <div class="row"><div class="spacer"></div><button class="btn primary" data-x>Close</button></div></div>`;
    draw(); document.body.appendChild(ov);
    ov.onclick = e => {
      const g = e.target.closest("[data-go]"), d = e.target.closest("[data-del]");
      if (e.target.closest("[data-x]") || e.target === ov) { ov.remove(); renderTransport(); return; }
      if (g) { const t = B.audio.markers[+g.dataset.go].t; ov.remove(); seek(Math.max(0, t - 1)); }
      if (d) { pushUndo(); B.audio.markers.splice(+d.dataset.del, 1); Store.saveBook(B.book); draw(); }
    };
  }

  // ---------------- stats bar ----------------
  function renderStats() {
    const el = $("#stats-bar"); if (!el) return;
    const st = statsNow(), c = B.counts[B.ci] || { mine: 0, done: 0 };
    const bkLeft = Math.max(0, B.bookMine - B.bookDone), chLeft = Math.max(0, c.mine - c.done), pace = st.pace;
    const item = (l, v, t) => `<div class="sb-item" title="${esc(t || "")}"><span>${l}</span><b>${v}</b></div>`;
    el.innerHTML = `<div class="sb-grp">${item("Remaining", num(bkLeft), "Your words left in this book · " + num(chLeft) + " in this chapter")}${item("Pace", pace ? num(pace) : "—", st.paceSrc)}${item("Time Left", pace ? hm(bkLeft / pace * 3600) : "—", "Booth time to finish your part at this pace")}</div>
      <div class="sb-grp">${item("Earned", money(st.earnedToday), "Earned today")}${item("Est. Value", money(st.bookValue), "Your share of this book")}${item("Next Goal", st.milestone ? num(st.milestone.left) : "—", st.milestone ? "Words to " + st.milestone.pct + "% of your part" : "")}</div>
      <div class="sb-grp sb-small">${item("This Chapter Time", hm(prog().boothSec))}${item("This Book Time", hm(st.bookSec))}${item("Booth Today", hm(st.boothToday))}${item("Words Today", num(st.wordsToday))}${item("FH Today", (st.wordsToday / (Store.settings.wpfh || 9300)).toFixed(2))}</div>
      <span style="flex:1"></span><span class="sb-as">${B.assembling ? `🧩 Assembling on <b>${esc(B.readingAs)}</b>'s narration` : `Reading as <b>${esc(B.readingAs)}</b>`}</span>`;
  }
  function statsNow() {
    const today = Prep.ymd(new Date()), S = Store.settings;
    const past = B.sessions.filter(s => !B.session || s.id !== B.session.id);
    const todays = past.filter(s => s.date === today), cur = B.session || { words: 0, boothSec: 0, value: 0 };
    const wordsToday = todays.reduce((a, s) => a + (s.words || 0), 0) + cur.words;
    const boothToday = todays.reduce((a, s) => a + (s.boothSec || 0), 0) + cur.boothSec;
    const earnedToday = todays.reduce((a, s) => a + (s.value || 0), 0) + (cur.value || 0);
    // pace, like Finished Hour: real words over real booth time of the chapters you've completed; else recent sessions; else your setting
    let cw = 0, cs = 0, bookSec = 0;
    B.book.chapters.forEach((c, i) => { const p = progOf(c, B.readingAs); bookSec += p.boothSec || 0; if (c.included && p.done && p.boothSec > 60) { cw += (B.counts[i] || {}).mine || 0; cs += p.boothSec; } });
    const since = Prep.ymd(new Date(Date.now() - 30 * 864e5));
    let w30 = cur.words, b30 = cur.boothSec; past.filter(s => s.date >= since).forEach(s => { w30 += s.words || 0; b30 += s.boothSec || 0; });
    const set = (S.narrators.find(n => n.name === B.readingAs) || {}).pace;
    let pace = null, paceSrc = "Words per booth hour";
    if (cs >= 600) { pace = cw / (cs / 3600); paceSrc += " · from your completed chapters in this book"; }
    else if (b30 >= 3 * 3600) { pace = w30 / (b30 / 3600); paceSrc += " · last 30 days"; }
    else if (set) { pace = set; paceSrc += " · from Settings until you've completed a chapter"; }
    let milestone = null;
    if (B.bookMine) { const pct = Math.min(100, (Math.floor(100 * B.bookDone / B.bookMine / 10) + 1) * 10); milestone = { pct, left: Math.ceil(B.bookMine * pct / 100) - B.bookDone }; }
    return { wordsToday, boothToday, earnedToday, pace, paceSrc, bookValue: valueOfMyPart(), milestone, bookSec };
  }
  function valueOfMyPart() {
    // on the schedule: the title's net, shared by the words each of you reads
    const T = B.book.titleId && window.LL && LL.tById(B.book.titleId);
    if (T && T.kind !== "author") { const net = LL.moneyOf(T).net, tw = LL.partWords(T), me = (T.stages || []).find(s => s.type === "record" && s.owner === LL.keyOf(B.readingAs)); return net > 0 && tw ? net * ((me && me.words) || B.bookMine) / tw : 0; }
    const words = B.book.chapters.filter(c => c.included).reduce((a, c) => a + c.words, 0);
    const e = Prep.estimate(words, B.book, Store.settings);
    const readers = {}; B.book.chapters.filter(c => c.included).forEach(c => { const w = Prep.wordsByReader(c, B.book); for (const k in w) readers[k] = (readers[k] || 0) + w[k]; });
    const multi = Object.keys(readers).filter(k => k !== "?").length > 1;
    return multi ? e.gross * (B.bookMine / Math.max(1, words)) : e.mine;
  }

  // ======================= the chapter clock (Finished Hour rules) =======================
  // Starts the first time you press Record on a chapter; keeps running through Stop, playback and punches;
  // pauses after 5 idle minutes or when the window is hidden; click to pause/resume; stops when the chapter is marked complete.
  function clockState() {
    if (B.rec && !B.rec.paused) return { on: true, label: "booth" };
    if (!B.bRun[B.ci]) return { on: false, label: "not started" };
    if (B.clockPaused) return { on: false, label: "paused" };
    if (document.hidden) return { on: false, label: "paused" };
    if (!B.player.playing && Date.now() - B.lastAct > IDLE_MIN * 60000) return { on: false, label: "idle" };
    return { on: true, label: "booth" };
  }
  function clockClick() {
    if (!B.bRun[B.ci]) { B.bRun[B.ci] = true; B.clockPaused = false; }
    else B.clockPaused = !B.clockPaused;
    B.lastAct = Date.now(); renderTransport();
  }
  function ensureSession() {
    if (B.session) return;
    const now = new Date();
    B.session = { id: Prep.uid(), person: B.assembling ? (Store.me() || B.readingAs) : B.readingAs, date: Prep.ymd(now), start: now.toISOString(), end: now.toISOString(),
      titleId: B.book.id, title: B.book.title, chapters: [], words: 0, boothSec: 0, recSec: 0, value: 0 };
  }
  function tick() {
    if (!B) return;
    if (B.session && B.session.date !== Prep.ymd(new Date())) { flushSession(); B.session = null; }
    const cs = clockState();
    if (cs.on) {
      prog().boothSec = (prog().boothSec || 0) + 1;
      ensureSession(); B.session.boothSec++; if (B.rec && !B.rec.paused) B.session.recSec++;
      if (!B.session.chapters.includes(B.chap.id)) B.session.chapters.push(B.chap.id);
      if (B.session.boothSec % 30 === 0) { flushSession(); Store.saveBook(B.book); }
    }
    meters();
    const bb = $("#bd-booth"); if (bb) bb.textContent = clock(prog().boothSec);
    const bl = $("#bd-bl"); if (bl && bl.textContent !== cs.label) { bl.textContent = cs.label; const box = bl.parentNode; box.classList.toggle("paused", !cs.on); }
    const tt = $("#bd-time"); if (tt && !B.raf) tt.textContent = clock(len());
    if (cs.on && prog().boothSec % 5 === 0) renderStats();
  }
  async function flushSession() {
    if (!B || !B.session || (!B.session.boothSec && !B.session.words)) return;
    B.session.end = new Date().toISOString();
    try { await Store.saveSession(B.session.person, B.session); const i = B.sessions.findIndex(s => s.id === B.session.id); if (i >= 0) B.sessions[i] = Object.assign({}, B.session); else B.sessions.push(Object.assign({}, B.session)); }
    catch (e) { console.warn("session save", e); }
  }
  function advanced(oldPos, newPos) {
    const p = prog(); p.pos = newPos;
    if (newPos > p.readTo) {
      let n = 0; for (let i = p.readTo; i < newPos; i++) if (B.mine[i]) n++;
      p.readTo = newPos;
      if (B.book.corrections || B.assembling) n = 0;            // fixing a finished book: pickups count as booth time, not words
      if (n) {
        ensureSession();
        const perWord = B.bookMine ? valueOfMyPart() / B.bookMine : 0;
        B.session.words += n; B.session.value += n * perWord;
        if (!B.session.chapters.includes(B.chap.id)) B.session.chapters.push(B.chap.id);
        B.counts[B.ci].done = Math.min(B.counts[B.ci].mine, B.counts[B.ci].done + n); B.bookDone += n;
        if (window.LRCele && B.rec) LRCele.comboWords(n);
        const k0 = Math.floor((B.session.words - n) / 1000), k1 = Math.floor(B.session.words / 1000);
        if (k1 > k0 && window.LRCele) LRCele.celebrate({ title: num(k1 * 1000) + " WORDS", sub: pick(["this sitting. Keep the lamp lit.", "and counting.", "read aloud today, in one sitting.", "The voice holds."]), level: 1 });
        checkGoals();
      }
    }
    Store.saveBook(B.book);
    if (B.f.pos >= B.toks.length && !p.done) chapterComplete(false);
  }

  // ======================= follow-along =======================
  function startListening() {
    if (B.listening || !B.follow) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Follow-along needs Chrome's speech recognition — not available here."); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = "en-US";
    const used = {};
    r.onresult = ev => {
      B.lastAct = Date.now();
      for (let k = ev.resultIndex; k < ev.results.length; k++) {
        const res = ev.results[k], words = res[0].transcript.trim().split(/\s+/).filter(Boolean);
        const upto = res.isFinal ? words.length : Math.max(0, words.length - 1);
        const from = used[k] || 0;
        if (upto > from) { heard(words.slice(from, upto)); used[k] = upto; }
      }
    };
    r.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { B.follow = false; const cb = $('[data-b="link"]'); if (cb) cb.checked = false; toast("Chrome blocked speech recognition here, so follow-along is off. Click words to move your place."); } };
    r.onend = () => { if (B && B.listening) setTimeout(() => { try { B.listening && r.start(); } catch (e) {} }, 250); };
    try { r.start(); B.recog = r; B.listening = true; } catch (e) { console.warn(e); }
  }
  function heard(words) { const old = B.f.pos; if (B.f.hear(words)) { advanced(old, B.f.pos); markPos(true); renderStats(); } }
  function stopListening() { if (!B) return; B.listening = false; if (B.recog) { try { B.recog.stop(); } catch (e) {} B.recog = null; } }
  function sampleAnchor() {
    if (!B || !B.rec || B.rec.paused) return;
    const w = B.f.pos; if (w === B.rec.lastW) return;
    const c = B.rec.clip, t = Math.max(B.rec.start, c.at + c.dur - SYNC_LAT);
    B.rec.anchors.push([t, w]); B.rec.lastW = w;
  }

  // ======================= recording =======================
  async function ensureStudio() {
    let st = await Store.studioStatus();
    if (st === "ready") return true;
    return new Promise(res => {
      const ov = document.createElement("div"); ov.className = "overlay";
      ov.innerHTML = `<div class="card reader"><h2>Where should recordings live?</h2><p>Choose a <b>Studio folder</b> on this computer for your audio. Keep it <b>outside</b> Google Drive or Dropbox: recordings are big, and they stay on this machine. Each book gets its own folder inside.</p>
        <div class="row"><div class="spacer"></div><button class="btn quiet" data-x>Not now</button><button class="btn primary" id="pickst">${st === "needs-permission" ? "Reopen my Studio folder" : "Choose Studio folder"}</button></div></div>`;
      document.body.appendChild(ov);
      $("[data-x]", ov).onclick = () => { ov.remove(); res(false); };
      $("#pickst", ov).onclick = async () => { try { if (st === "needs-permission") await Store.reopenStudio(); else await Store.pickStudio(); ov.remove(); res(true); } catch (e) { if (e.name !== "AbortError") toast(e.message); } };
    });
  }
  async function ensureMic() {
    if (B.mic.isOpen) return true;
    try {
      await B.mic.open(localStorage.getItem("lr-mic") || undefined);
      const inf = B.mic.info;
      if (inf.rate && inf.rate !== LRAudio.RATE && !B.rateWarned) { B.rateWarned = true; toast("🎤 Your microphone is running at " + (inf.rate / 1000) + " kHz. For the cleanest takes, set it to 48,000 Hz in Audio MIDI Setup (Applications ▸ Utilities), then reload."); }
      return true;
    }
    catch (e) { toast("Couldn't open the microphone: " + e.message); return false; }
  }
  async function chooseMic() {
    await ensureMic();
    const list = await LRAudio.Mic.devices();
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader"><h2>Microphone</h2><label>Input<select id="micsel">${list.map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === B.mic.deviceId ? "selected" : ""}>${esc(d.label || "Microphone")}</option>`).join("")}</select></label>
      <p class="small muted">Recording is 48 kHz, 24-bit, with Chrome's call processing (echo cancelling, noise suppression, auto gain) switched off, so you get the raw signal.</p>
      <div class="row"><div class="spacer"></div><button class="btn primary" data-x>Done</button></div></div>`;
    document.body.appendChild(ov);
    $("#micsel", ov).onchange = async e => { localStorage.setItem("lr-mic", e.target.value); B.mic.close(); await B.mic.open(e.target.value); renderSide(); };
    $("[data-x]", ov).onclick = () => ov.remove();
  }

  // R always carries on from the end of the last clip in the chapter, whichever track that clip is on, and records onto
  // the selected track. (Shift+R is the punch: it records from the playhead.) ⌥1–6 is R onto that track.
  function nextRecStart0() { return len(); }
  async function recordToggle(onTrack) {
    if (B.rec && onTrack == null) { B.rec.paused = !B.rec.paused; if (!B.rec.paused) B.rec.lastW = null; renderTransport(); return; }
    if (B.player.playing) B.player.stop();
    if (onTrack != null) B.track = onTrack;
    return startRecording(len(), false);
  }
  async function punchAt(t) {
    if (B.rec) await stopRecording();
    t = Math.max(0, Math.min(len(), t));
    const w = T().wordAt(B.audio, t); if (w != null) { B.f.set(w); prog().pos = B.f.pos; markPos(true); }
    return startRecording(t, true);
  }
  async function startRecording(at, punched, preSnap) {
    if (B.edit) { B.edit = false; renderManuscript(); renderEditBar(); }
    if (!(await ensureStudio())) return;
    if (!(await ensureMic())) return;
    B.bRun[B.ci] = true; B.clockPaused = false; B.lastAct = Date.now();      // Finished Hour: the clock starts the first time you record on a chapter
    if (preSnap) { B.undo.push(preSnap); B.redo = []; } else pushUndo();
    B.player.stop(); B.sel = null;
    const d = await dir();
    if (punched && B.prerollSec > 0 && at > 0.2 && T().hasAudio(B.audio)) {
      setHint("Pre-roll…");
      await B.player.play(LRAudio.mixer(d, B.audio, trackSet()), Math.max(0, at - B.prerollSec), at);
    }
    const name = "take-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-" + Math.random().toString(36).slice(2, 5) + ".wav";
    const writer = await LRAudio.WavWriter.create(d, name, LRAudio.RATE);
    const clip = { file: name, off: 0, dur: 0, at };
    B.audio.tracks[B.track].clips.push(clip);
    delete B.audio.pad;
    B.rec = { gapEnd: B.pendingGap != null ? B.pendingGap : null, match: !!B.pendingMatch, pickup: B.pendingPickup || null, writer, clip, file: name, paused: false, dir: d, lastW: null, start: at, track: B.track, punch: !!punched || B.track > 0, anchors: [], clipFlags: 0, lastClipT: -9, pos0: B.f.pos, handled: new Set(), loud: 0, coUntil: 0 };
    B.peaks[name] = { mm: writer.mm };
    B.pendingGap = null; B.pendingMatch = false; B.pendingPickup = null;
    if (proofMode() === "live") B.rec.pf = { buf: [], n: 0, a: at };
    B.mic.onFrames = f => {
      const r = B && B.rec; if (!(r && r.writer === writer && !r.paused)) return;
      if (r.pf) { r.pf.buf.push(f.slice()); r.pf.n += f.length; if (r.pf.n >= PROOF_EVERY * LRAudio.RATE) proofLive(r, false); }
      let hot = 0; for (let i = 0; i < f.length; i++) if (f[i] >= 0.999 || f[i] <= -0.999) hot++;
      writer.push(f); r.clip.dur = writer.duration - r.clip.off;
      let pk = 0; for (let i = 0; i < f.length; i += 4) { const a = f[i] < 0 ? -f[i] : f[i]; if (a > pk) pk = a; } if (pk > 0.012) { r.loud = r.clip.at + r.clip.dur; if (r.drops) for (const dp of r.drops) if (dp.speak == null && r.loud > dp.t + 0.15) dp.speak = r.loud - 0.04; }
      // reading on while their line plays (not waiting for it): they keep their space and you carry on after it
      const cd = r.coNow; if (cd && !cd.skipped) { const now = r.clip.at + r.clip.dur, thr = duetOpt("hear") ? 0.03 : 0.012;
        if (now > cd.t + 0.3 && pk > thr) { if (cd.vStart == null || now - cd.vLast > 0.25) cd.vStart = now - f.length / LRAudio.RATE; cd.vLast = now; if (now - cd.vStart >= 0.3) skipLine(cd.vStart - 0.05, true); } }
      // Finished Hour flagged clipping as you went
      if (hot > 1) { r.clipFlags += hot; const t = r.clip.at + r.clip.dur; if (t - r.lastClipT > 3) { r.lastClipT = t; B.audio.markers.push({ id: Prep.uid(), t, w: B.f.pos, ctx: "", note: "Clipped — too loud here", auto: true, done: false }); } }
    };
    B.mic.onDrop = (ms, why) => {
      const r = B && B.rec; if (!r || r.writer !== writer) return;
      const t = r.clip.at + r.clip.dur; if (r.lastDropT != null && t - r.lastDropT < 2) return; r.lastDropT = t;
      B.audio.markers.push({ id: Prep.uid(), t, w: B.f.pos, ctx: "", note: "Audio dropout — " + why, auto: true, done: false });
      if (!r.dropToast) { r.dropToast = true; toast("⚠️ The microphone audio glitched at " + clock(t) + ". It's flagged in Pickups so you can punch it in again."); }
    };
    B.playhead = null;
    startListening(); startAnim();
    renderEditBar(); renderTransport(); renderStats();
  }
  // ⌥1–6 while recording: the take carries straight on, onto another track, with no gap (same file, new clip)
  function switchTrackLive(ti) {
    const r = B.rec; if (!r || ti === r.track) return;
    while (B.audio.tracks.length <= ti) { if (!addTrack(true)) return; }
    const now = r.clip.at + r.clip.dur;
    r.clip.dur = r.writer.duration - r.clip.off;
    const nc = { file: r.file, off: r.writer.duration, dur: 0, at: now };
    B.audio.tracks[ti].clips.push(nc);
    r.clip = nc; r.track = ti; B.track = ti; r.punch = true;
    notice("🎙 Now recording on track " + (ti + 1) + (trackSet()[ti] ? " · " + trackSet()[ti].name : ""));
    renderEditBar(); renderTransport();
  }
  async function stopRecording() {
    if (!B || !B.rec) return;
    if (B.rec && !B.rec.paused) await B.mic.flush();          // the last few milliseconds still in the capture buffer
    if (!B || !B.rec) return;
    const r = B.rec; B.rec = null; B.mic.onFrames = null; B.mic.onDrop = null;
    afterDuetTake(r); document.body.classList.remove("booth-recording"); drawVoice();
    try { await r.writer.close(); } catch (e) { toast("Saving the take failed: " + e.message); }
    r.clip.dur = r.writer.duration - r.clip.off;
    B.audio.alts = B.audio.alts || [];
    let end = r.start, ti = -1;
    for (const tr of B.audio.tracks) {
      ti++;
      const mine = tr.clips.filter(c => c.file === r.file && c.dur > 0.05);
      tr.clips = tr.clips.filter(c => c.file !== r.file);
      for (const c of mine) {
        // keep what's being replaced so you can swap back to it (Finished Hour kept the last 14)
        const old = T().extract(B.audio, ti, c.at, c.at + c.dur), cov = old.reduce((m, k) => m + k.dur, 0);
        if (cov > 0.3) { B.audio.alts.push({ id: Prep.uid(), track: ti, a: c.at, len: c.dur, clips: old, when: Date.now() }); if (B.audio.alts.length > 14) B.audio.alts.shift(); }
        T().clear(B.audio, [ti], c.at, c.at + c.dur);
        tr.clips.push(c); tr.clips.sort((x, y) => x.at - y.at);
        end = Math.max(end, c.at + c.dur);
      }
    }
    // word timing: the take's anchors replace the old ones under it
    B.audio.anchors = B.audio.anchors.filter(p => !(p[0] >= r.start && p[0] < end)).concat(r.anchors).sort((x, y) => x[0] - y[0]);
    if (r.gapEnd != null) { if (r.gapEnd > end + 0.01) T().deleteRange(B.audio, end, r.gapEnd); if (r.match) await matchLevel(r, end).catch(() => {}); }
    if (r.pickup) { const k = B.audio.markers.findIndex(x => x.id === r.pickup); if (k >= 0) B.audio.markers.splice(k, 1); }
    B.lastRecEnd = { ci: B.ci, track: r.track, t: end };
    if (r.punch && end < len() - 0.05) B.playhead = end;     // Finished Hour: after a punch the playhead sits at the end of it
    if (r.clipFlags) toast("⚠️ That take clipped (" + r.clipFlags + " samples at full scale). The spots are flagged — consider lowering the gain and re-reading them.");
    stopListening();
    renderEditBar(); renderTransport();
    if (trackSet().some(t => t && t.armed && t.armed.length)) {
      B.busy = "armed";
      try { if (await processArmed(r.file)) notice("🎛 Armed effects applied to the new take. Undo takes the take away; the dry recording is kept in your Studio folder."); }
      catch (e) { console.error(e); toast("Armed effects failed: " + e.message + ". The take is kept dry."); }
      B.busy = null; renderTransport();
    }
    Store.saveBook(B.book, true);
    flushSession();
    if (window.LRCele) { LRCele.comboEnd(); setTimeout(() => LRCele.flush(), 300); }
    if (window.flushNotes) setTimeout(flushNotes, 900);
    stopLine(); const db = $("#duet-banner"); if (db) db.remove();
    if (r.pf) proofLive(r, true); else if (proofMode() === "stop") proofTake(r);
  }
  async function flub() {
    if (!T().hasAudio(B.audio) && !B.rec) return;
    if (B.rec) await stopRecording();
    const L = len(), render = await mix();
    const s = B.f.sentenceStart(B.f.pos);
    let t = T().timeOfWord(B.audio, s);
    if (t == null || t > L) t = await LRAudio.lastPause(render, L, 0.6, 0.25);
    t = await LRAudio.quietPoint(render, Math.min(t, L), 0.35, 0.45);
    const pre = snap();
    // their lines: one that comes before this sentence stays whole (the re-read starts after it);
    // one that comes after it is taken out whole, and drops in again when you read up to it
    for (const tr of B.audio.tracks) for (const c of tr.clips) if (c.line && c.at + c.dur > t) {
      if (c.line.from < s) t = Math.max(t, Math.min(L, c.at + c.dur + 0.25));
    }
    for (const tr of B.audio.tracks) tr.clips = tr.clips.filter(c => !(c.line && c.line.from >= s && c.at + c.dur > t));
    B.f.set(s); prog().pos = B.f.pos; markPos(true);
    T().truncate(B.audio, t);
    await startRecording(t, false, pre);
  }
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
    if (on) notice("🧩 Assembling " + B.chap.title + ": the timeline is " + narr + "'s narration. Bring in their chapter audio (📼 Finished audio), map it, then Splice all in Co-narrator.");
  }
  function origTabHtml() {
    const dis = B.rec || B.busy ? "disabled" : "", ch = B.chap, withO = B.book.chapters.filter(c => c.orig).length, mapped = B.book.chapters.filter(c => c.origMap).length;
    const q = B.findQ || "", hits = B.findHits || [];
    const narr = Prep.readerOf("n", ch, B.book), me = Store.me() || B.readingAs;
    const asm = B.assembling ? `<div class="bd-sec recut"><b>🧩 Assembling ${esc(ch.title)}</b><div class="stu-note">This timeline is ${esc(B.readingAs)}'s narration. Cast lines (yours too, once you've sent them) drop into it with Splice all in 👥 Co-narrator.</div><div class="fx-chips"><button class="stu-btn" data-p="asmoff" ${dis}>← Back to my lines</button></div></div>`
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
        ${(c.samples || []).map(sm => `<div class="ch-sm"><button class="stu-btn" data-c="play:${sm.id}">▶</button><input data-sm="${sm.id}" value="${esc(sm.label || "")}" placeholder="calm, shouting…"><span>${sm.dur ? sm.dur.toFixed(1) + " s" : ""}</span><button class="stu-btn" data-c="smx:${sm.id}" title="Remove this sample">✕</button></div>`).join("") || `<div class="stu-note">None yet.</div>`}
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
    if (a === "play") { const sm = c.samples.find(z => z.id === x); if (!sm) return; try { const f = await (await d.getFileHandle(sm.file)).getFile(); if (B.charAudio) B.charAudio.pause(); B.charAudio = new Audio(URL.createObjectURL(f)); B.charAudio.play(); } catch (er) { toast("That sample's file is missing."); } return; }
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

  // ======================= duets: the co-narrator's lines =======================
  // A "run" is a stretch of one reader's words with nobody else's in between. The chapter's narrator is the lead: they
  // record straight through and their co-narrator's runs drop in as lines. The co-narrator records their runs and sends
  // them: each run is cut from their recording by its word timing and the pauses around it.
  const amLead = () => (Prep.readerOf("n", B.chap, B.book) || B.readingAs) === B.readingAs;
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
  function theirRuns() { if (!B.runsCache || B.runsCache.v !== B.toks) B.runsCache = { v: B.toks, runs: runsOf((i, t) => B.mine[i] ? null : Prep.readerOf(t.part, B.chap, B.book)) }; return B.runsCache.runs; }
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
  async function playLine(l, onEnd) {
    stopLine();
    try {
      const x = await LRAudio.renderRange(await dir(), [{ file: l.file, off: l.hin || 0, dur: l.dur, at: 0 }], 0, l.dur);
      const ctx = new AudioContext({ sampleRate: LRAudio.RATE }), buf = ctx.createBuffer(1, x.length, LRAudio.RATE); buf.copyToChannel(x, 0);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const gn = ctx.createGain(); gn.gain.value = coVol(); src.connect(gn); gn.connect(ctx.destination); src.start();   // their line, at your headphone level
      B.coPlay = ctx; src.onended = () => { if (B && B.coPlay === ctx) stopLine(); onEnd && onEnd(); };
    } catch (e) { toast("Couldn't play that line: " + e.message); }
  }
  function stopLine() { if (B && B.coPlay) { B.coPlay.close().catch(() => {}); B.coPlay = null; } }
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
      const d = await Store.duetDir(B.book, B.chap, B.readingAs, true);
      for await (const [name] of d.entries()) await d.removeEntry(name).catch(() => {});
      const R = LRAudio.RATE, lines = [];
      for (let i = 0; i < out.length; i++) {
        // each line carries ~0.6 s of handle either side, hidden: drag its edge out on the lead's side to get a clipped word back
        const o = out[i], n = i + 1, file = "line-" + String(n).padStart(3, "0") + ".wav", hin = Math.min(0.6, o.a), hout = Math.min(0.6, Math.max(0, L - o.b)), x = await render(o.a - hin, o.b - o.a + hin + hout);
        const fade = Math.min(x.length, Math.round(R * 0.012)); for (let k = 0; k < fade; k++) { x[k] *= k / fade; x[x.length - 1 - k] *= k / fade; }
        for (const dd of [d].concat(copyTo ? [copyTo] : [])) { const w = await LRAudio.WavWriter.create(dd, file, R); w.push(x); await w.close(); }
        lines.push({ n, file, from: o.x.from, to: o.x.to, text: o.x.text, dur: +(o.b - o.a).toFixed(4), hin: +hin.toFixed(4), hout: +hout.toFixed(4), guess: !!o.guess });
        busyNote("Cutting line " + n + " / " + out.length);
      }
      const pack = { v: 1, book: B.book.title, bookId: B.book.id, chapter: B.chap.title, chapterId: B.chap.id, reader: B.readingAs, made: new Date().toISOString(), rate: R, lines };
      for (const dd of [d].concat(copyTo ? [copyTo] : [])) { const fh = await dd.getFileHandle("lines.json", { create: true }), w = await fh.createWritable(); await w.write(JSON.stringify(pack, null, 1)); await w.close(); }
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
      else { try { d = await Store.duetDir(B.book, B.chap, r, false); pack = await readPack(d); } catch (e) { d = null; } }
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
    const rc = Object.entries(B.recut || {}).filter(([r, n]) => n && recutOf(r).length);
    if (rc.length) toast("🔁 " + rc.map(([r, n]) => r + " re-sent " + n + " line" + (n === 1 ? "" : "s") + " you've already placed").join(", ") + ". Co-narrator tab ▸ Swap them in.");
    if (fresh) { Store.saveBook(B.book); renderSide(); notice("👥 " + fresh + " co-narrator line" + (fresh === 1 ? "" : "s") + " arrived for " + B.chap.title + "." + (B.audio.markers.some(m => m.slot) ? " Splice all fills your slots." : "")); }
    else if (!quiet) toast(picked ? "No lines for this chapter in that folder." : "No new lines yet. When your co-narrator presses Send, they appear here (through the shared Library folder).");
    return got;
  }
  // placed lines whose newest version (from a re-send) isn't the one in the chapter
  function recutOf(r) {
    const out = [], rec = duetData()[r]; if (!rec) return out;
    B.audio.tracks.forEach((tr, ti) => tr.clips.forEach((c, ci) => { if (!c.line || c.line.r !== r) return; const l = rec.lines.find(z => z.from === c.line.from); if (l && l.file !== c.file) out.push({ ti, ci, l }); }));
    return out;
  }
  // swap a placed line for a new version: the chapter grows or shrinks to fit (your audio moves along with it)
  function swapClip(ti, ci, l) {
    const c = B.audio.tracks[ti].clips[ci], end = c.at + c.dur, d = l.dur - c.dur;
    if (d > 0.005) T().insertGap(B.audio, end, d);
    else if (d < -0.005) { const a = end + d, busy = B.audio.tracks.some((tr, k) => k !== ti && tr.clips.some(z => z.at < end - 0.01 && z.at + z.dur > a + 0.01)); if (!busy) T().deleteRange(B.audio, a, end); }
    const k = B.audio.tracks[ti].clips.find(z => z.line && c.line && z.line.from === c.line.from && z.line.r === c.line.r) || c;
    k.file = l.file; k.off = l.hin || 0; k.dur = l.dur; delete k.fi; delete k.fo; delete k.g;
  }
  function swapRecut(r) {
    if (B.rec || B.busy) return;
    const todo = recutOf(r).sort((a, b) => B.audio.tracks[b.ti].clips[b.ci].at - B.audio.tracks[a.ti].clips[a.ci].at);   // last first, so earlier times stay put
    if (!todo.length) { toast("Nothing to swap."); return; }
    pushUndo(); for (const x of todo) swapClip(x.ti, x.ci, x.l);
    if (B.recut) delete B.recut[r];
    edited(); renderSide(); notice("🔁 " + todo.length + " of " + r + "'s line" + (todo.length === 1 ? "" : "s") + " swapped for the new cut. Undo puts the old ones back.");
  }
  async function pickLinesFolder() { try { const d = await window.showDirectoryPicker({ id: "lamp-room-lines", mode: "read" }); await bringLines(d); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }
  async function pickCopyFolder() { try { const d = await window.showDirectoryPicker({ id: "lamp-room-lines-out", mode: "readwrite" }); const sub = await d.getDirectoryHandle((B.book.folder + " - " + B.chap.title + " - " + B.readingAs).replace(/[\\/:*?"<>|]+/g, "-"), { create: true }); await sendLines(sub); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }

  function duetTabHtml() {
    const dis = B.rec || B.busy ? "disabled" : "";
    if (!amLead()) {
      const runs = myRuns(), lead = Prep.readerOf("n", B.chap, B.book) || "the lead", s = B.sent && B.sent.ci === B.ci ? B.sent : null;
      return `<div class="bd-sec"><b>You're reading for ${esc(lead)}</b><div class="stu-note">${esc(lead)} narrates this chapter. Record your ${runs.length} line${runs.length === 1 ? "" : "s"} (${num(runs.reduce((a, x) => a + x.words, 0))} words) straight through, with a breath between lines. Then <b>Send</b>: each line is cut out by your word timing and the pauses around it, and lands in the shared Library where ${esc(lead)}'s Booth picks it up.</div>
          <div class="fx-chips"><button class="stu-btn stu-rec" data-p="send" ${dis} ${len() ? "" : "disabled"}>${B.busy === "send" ? "Sending…" : "📤 Send my lines"}</button><button class="stu-btn" data-p="sendcopy" ${dis} ${len() ? "" : "disabled"} title="Also save the lines in a folder you choose (to share another way)">Send + save a copy…</button></div>
          ${s ? `<div class="co-chips"><span class="ok">${s.n} sent</span>${s.guessed ? `<span class="warn">${s.guessed} placed by pauses (no word timing)</span>` : ""}${s.missing ? `<span class="warn">${s.missing} not found in the recording</span>` : ""}</div>` : ""}</div>
        <div class="bd-sec"><b>Your lines</b>${runs.map((x, i) => `<div class="co-line"><span class="n">${i + 1}</span><span>${esc(qt(short(x.text, 18)))}</span><span></span></div>`).join("") || `<div class="stu-note">None in this chapter.</div>`}</div>`;
    }
    const runs = theirRuns();
    if (!runs.length) return `<div class="bd-sec"><b>Co-narrator</b><div class="stu-note">No one else reads in this chapter.</div></div>`;
    const arrived = runs.filter(x => lineFor(x)).length, placed = runs.filter(x => placedClip(x)).length, slots = runs.filter(x => !placedClip(x) && slotOf(x)).length, who = [...new Set(runs.map(x => x.r))].join(" & ");
    const rcs = [...new Set(runs.map(x => x.r))].map(r => [r, recutOf(r).length]).filter(z => z[1]);
    const miss = [...new Set(runs.map(x => x.r))].map(r => [r, runs.filter(x => x.r === r && ((duetData()[r] || {}).missing || []).includes(x.from) && !lineFor(x)).length]).filter(z => z[1]);
    return `${miss.map(([r, n]) => `<div class="bd-sec recut"><b>⚠ ${n} line${n === 1 ? "" : "s"} missing from ${esc(r)}'s file</b><div class="stu-note">Their file had no take of ${n === 1 ? "this line" : "these lines"} (marked below). Mark them as pickups and they go on ${esc(r)}'s list${isNarrator(r) ? "" : " for you to send"}.</div><div class="fx-chips"><button class="stu-btn stu-rec" data-p="miss:${esc(r)}" ${dis}>🔁 Mark as pickups</button></div></div>`).join("")}${rcs.map(([r, n]) => `<div class="bd-sec recut"><b>🔁 ${esc(r)} re-cut ${n} line${n === 1 ? "" : "s"} you've already placed</b><div class="stu-note">Swap in the new cut: each one replaces the old in place, and the chapter grows or shrinks to fit. Undo puts the old ones back.</div><div class="fx-chips"><button class="stu-btn stu-rec" data-p="recut:${esc(r)}" ${dis}>Swap them in</button></div></div>`).join("")}<div class="bd-sec"><b>${esc(who)}'s lines</b>
        <div class="co-chips"><span>${runs.length} in this chapter</span><span class="${arrived === runs.length ? "ok" : arrived ? "" : "warn"}">${arrived} arrived</span><span class="${placed ? "ok" : ""}">${placed} in</span>${slots ? `<span class="warn">${slots} slots waiting</span>` : ""}</div>
        <label class="check"><input type="checkbox" data-duet="auto" ${duetOpt("auto") ? "checked" : ""}> <b>Auto-place while I record</b></label>
        <div class="stu-note">Read through. When you've finished the line before theirs and gone quiet, their line drops in on their track${duetOpt("hear") ? " and plays in your headphones" : ""}; wait for “Your turn”. If their audio isn't in yet, a slot is marked and it splices in later. <b>${esc(kl("click"))}</b> drops their next line in by hand.</div>
        <label class="check"><input type="checkbox" data-duet="hear" ${duetOpt("hear") ? "checked" : ""}> Play their line in my headphones</label>
        <div class="fx-chips"><button class="stu-btn stu-rec" data-p="spliceall" ${dis} ${arrived > placed ? "" : "disabled"} title="Fill the slots, and place any line not yet in by your word timing">⤓ Splice all</button><button class="stu-btn" data-p="bring" ${dis}>Check for new lines</button><button class="stu-btn" data-p="bringfrom" ${dis}>Load from a folder…</button></div></div>
      <div class="bd-sec">${runs.map((x, i) => { const l = lineFor(x), p = placedClip(x), sl = !p && slotOf(x);
        return `<div class="co-line ${p ? "placed" : sl ? "slot" : ""}"><span class="n">${i + 1}</span><span>${esc(qt(short(x.text, 16)))}<br><i>${esc(x.r)} · ${!l && !p && ((duetData()[x.r] || {}).missing || []).includes(x.from) ? '<b class="warn-t">missing from their file</b> · ' : ""}${p ? "in · " + clock(B.audio.tracks[p.ti].clips[p.ci].at) : sl ? "slot at " + clock(sl.t) : ""}${l ? (p || sl ? " · " : "") + l.dur.toFixed(1) + " s" + (l.check ? ' · <b class="warn-t">check</b>' : "") + (l.pk ? " · pickup" : "") : (p || sl ? "" : "") + (l ? "" : " not arrived")}</i></span>
          <span class="fx-chips">${l ? `<button class="stu-btn" data-p="lplay:${i}" title="Listen">▶</button>` : ""}${p ? `<button class="stu-btn" data-p="lgo:${i}" title="Go to it">go</button><button class="stu-btn" data-p="lout:${i}" ${dis} title="Take it back out">↩</button>` : l ? `<button class="stu-btn" data-p="lin:${i}" ${dis} title="Put it in at the playhead (snaps to the pause)">Place</button>` : ""}<button class="stu-btn" data-p="lask:${i}" title="Mark as a pickup for ${esc(x.r)}">🔁</button></span></div>`; }).join("")}</div>
      <div class="bd-sec"><b>A recording from outside the Lamp Room</b><div class="stu-note">Cast who don't use the Lamp Room send you a file. Drop it here and it's cut into their lines: at the clicks or claps between lines if there are any, otherwise at the pauses. WAV, MP3, M4A, AIFF or FLAC.</div>
        <div class="fx-chips">${[...new Set(runs.map(x => x.r))].map(r => `<button class="stu-btn" data-p="castdrop:${esc(r)}" ${dis}>🎧 ${esc(r)}'s file…</button>`).join("")}</div>
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
        ${open.length ? open.map(m => { const z = pkZone(m); return `<div class="co-line"><span class="n">⚑</span><span><b data-p="pgo:${m.id}" class="lnk" title="Play it in context">▶ ${clock(z ? z.a : m.t)}</b> ${esc(m.note || "Flub")}<br><i>${m.ctx ? "“…" + esc(m.ctx) + "…”" : ""}</i></span><span class="fx-chips"><button class="stu-btn stu-rec" data-p="pfix:${m.id}" ${B.rec ? "disabled" : ""}>Fix</button><button class="stu-btn" data-p="pdone:${m.id}" title="It's fine: remove the flag">✓</button>${m.proof && m.proof.text ? `<button class="stu-btn" data-p="pign:${m.id}" title="This is right (a name, a word the proofer doesn't know): never flag it again, in any of your books">Always ignore</button>` : ""}</span></div>`; }).join("") : `<div class="stu-note">No open flags. Clean chapter.</div>`}</div>`;
  }
  // ---- pickup zones: the sentence the flag is in, in red, adjustable on the waveform; stored relative to the flag so ripple edits carry it ----
  function pkSentence(m) {
    const w = m.w != null ? m.w : T().wordAt(B.audio, m.t); if (w == null) return null;
    const s = B.f.sentenceStart(w); let e = Math.max(s, w);
    while (e < B.toks.length - 1 && !B.toks[e].end && B.toks[e + 1].p === B.toks[e].p) e++;
    return { s, e };
  }
  function pkZone(m) {
    if (m.zone) return { a: Math.max(0, m.t + m.zone.da), b: m.t + m.zone.db };
    const sw = pkSentence(m), an = B.audio.anchors || [];
    let a = null, b = null;
    if (sw) { a = T().timeOfWord(B.audio, sw.s); const nx = an.find(p => p[1] > sw.e); b = nx ? nx[0] : null; }
    if (a == null || a > m.t + 0.5) a = Math.max(0, m.t - 2.5);
    if (b == null || b <= m.t) b = Math.min(len(), Math.max(m.t + 0.8, a + 3));
    m.zone = { da: +(a - m.t).toFixed(3), db: +(b - m.t).toFixed(3) };
    return { a, b };
  }
  async function pkSnap(m) {        // tidy the zone's edges into the nearest quiet
    const z = pkZone(m); if (!z) return; const r = await mix();
    const a = await LRAudio.quietPoint(r, z.a, 0.3, 0.35), b = await LRAudio.quietPoint(r, z.b, 0.3, 0.35);
    if (b - a > 0.3) m.zone = { da: +(a - m.t).toFixed(3), db: +(b - m.t).toFixed(3) };
  }
  function pkTrack(z) {             // the track the original is on: the one with the most audio (not a partner line) in the zone
    let best = B.track, most = 0;
    B.audio.tracks.forEach((tr, ti) => { let n = 0; for (const c of tr.clips) if (!c.line) n += Math.max(0, Math.min(c.at + c.dur, z.b) - Math.max(c.at, z.a)); if (n > most) { most = n; best = ti; } });
    return best;
  }
  async function pickupPlay(id) {
    const m = B.audio.markers.find(x => x.id === id); if (!m || B.rec) return; const z = pkZone(m);
    B.sel = { a: Math.max(0, z.a - 2), b: Math.min(len(), z.b + 0.6) }; await togglePlay(true); B.sel = null; drawWave();
  }
  async function pickupFix(id) {
    if (B.rec) return; const m = B.audio.markers.find(x => x.id === id); if (!m) return;
    if (!m.zone) await pkSnap(m);
    const z = pkZone(m), sw = pkSentence(m);
    B.track = pkTrack(z);
    if (sw) { B.f.set(sw.s); prog().pos = B.f.pos; markPos(true); }
    B.pendingPickup = m.id; B.sel = { a: z.a, b: z.b };
    await replaceSel();
  }
  function removeMarker(id) { const k = B.audio.markers.findIndex(x => x.id === id); if (k >= 0) { pushUndo(); B.audio.markers.splice(k, 1); Store.saveBook(B.book); applyProofMarks(); renderSide(); renderTransport(); drawWave(); } }

  // ======================= takes, gain, checks =======================
  function selectTake(ti, ci) { B.selTake = { ti, ci }; B.sel = null; B.track = ti; renderEditBar(); renderTransport(); if (B.side === "tools" && B.tab === "takes") renderSide(); }
  function deleteTake(ti, ci) {
    if (B.rec) return; const c = B.audio.tracks[ti] && B.audio.tracks[ti].clips[ci]; if (!c) return;
    pushUndo();
    B.audio.tracks[ti].clips.splice(ci, 1);
    const shared = B.audio.tracks.some((_, k) => T().extract(B.audio, k, c.at, c.at + c.dur).length);
    if (!shared) T().deleteRange(B.audio, c.at, c.at + c.dur);
    B.selTake = null; B.sel = null; B.playhead = c.at;
    edited(); renderSide();
    notice("🗑 Take deleted" + (shared ? " (left as silence so the other tracks stay in sync)" : "") + ". Undo brings it back.");
  }
  function gainSel(db) {
    if (B.rec) return; let ti = B.track, a, b;
    if (B.sel) { a = B.sel.a; b = B.sel.b; } else if (B.selTake) { const c = B.audio.tracks[B.selTake.ti].clips[B.selTake.ci]; ti = B.selTake.ti; a = c.at; b = c.at + c.dur; } else return;
    pushUndo(); T().splitAt(B.audio, ti, a); T().splitAt(B.audio, ti, b);
    for (const c of B.audio.tracks[ti].clips) if (c.at >= a - 1e-6 && c.at + c.dur <= b + 1e-6) { const g = db == null ? 0 : Math.max(-30, Math.min(24, (c.g || 0) + db)); if (g) c.g = g; else delete c.g; }
    const keep = B.sel; edited(); B.sel = keep; renderTransport(); renderSide();
    if (B.player.playing) chainChanged();
  }
  async function acxCheck() {
    if (B.busy || !len()) return; B.busy = "acx"; renderSide();
    try {
      const render = await mix(), L = len(), R = RATE(), CH = 10, win = Math.round(R * 0.5);
      let ss = 0, n = 0, pk = 0, wss = 0, wn = 0; const wins = [];
      for (let t = 0; t < L; t += CH) {
        const x = await render(t, Math.min(CH, L - t));
        for (let i = 0; i < x.length; i++) { const v = x[i], a = v < 0 ? -v : v; ss += v * v; if (a > pk) pk = a; wss += v * v; if (++wn === win) { wins.push(Math.sqrt(wss / win)); wss = 0; wn = 0; } }
        n += x.length; busyNote("Checking… " + Math.round(100 * Math.min(1, (t + CH) / L)) + "%");
      }
      const db = v => 20 * Math.log10(Math.max(v, 1e-9)), live = wins.filter(v => v > 1e-6).sort((x, y) => x - y);
      B.acx = { ci: B.ci, rms: db(Math.sqrt(ss / Math.max(1, n))), peak: db(pk), floor: live.length ? db(live[0]) : -120 };
    } catch (e) { toast("Check failed: " + e.message); }
    B.busy = null; busyNote(""); renderSide();
  }

  // ======================= who reads what: select words, pick a reader =======================
  function readersForPop() {
    const S = Store.settings, set = new Set(S.narrators.map(n => n.name)); Object.values(B.book.parts || {}).forEach(r => r && set.add(r)); set.add(B.readingAs);
    ["Cast 1", "Cast 2", "Cast 3", "Cast 4"].forEach(n => set.add(n));
    return [...set];
  }
  function showPartPop() {
    if (B.edit) return;
    const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const ms = $("#ms"), r = sel.getRangeAt(0); if (!ms || !ms.contains(r.commonAncestorContainer)) return;
    const ws = $$(".w", ms).filter(w => r.intersectsNode(w)); if (!ws.length) return;
    const from = +ws[0].dataset.i, to = +ws[ws.length - 1].dataset.i, rect = r.getBoundingClientRect();
    hidePartPop();
    const pop = document.createElement("div"); pop.className = "part-pop"; pop.id = "part-pop";
    const words = B.toks.slice(from, to + 1).map(t => t.w), txt = words.length > 6 ? words.slice(0, 3).join(" ") + " … " + words.slice(-2).join(" ") : words.join(" ");
    pop.innerHTML = `<div class="pp-q">Who reads <i>“${esc(txt)}”</i>?</div><div class="fx-chips">${readersForPop().map(n => `<button class="stu-btn ${n === B.readingAs ? "stu-rec" : ""}" data-who="${esc(n)}">${esc(n)}${n === B.readingAs ? " (me)" : ""}</button>`).join("")}<button class="stu-btn" data-who="__n" title="Narration: read by whoever narrates this chapter">Narration</button><button class="stu-btn" data-who="__x">✕</button></div>`;
    const run = theirRuns().find(x => from >= x.from && to <= x.to);
    if (run && amLead()) pop.insertAdjacentHTML("beforeend", `<div class="fx-chips" style="margin-top:6px"><button class="stu-btn" data-ask="1">🔁 Ask ${esc(run.r)} for a pickup of this line</button></div>`);
    const nm = words.map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, "").replace(/['’]s$/, "")).join(" ").trim();
    if (words.length <= 4 && nm) { const known = charFind(nm); pop.insertAdjacentHTML("beforeend", `<div class="fx-chips" style="margin-top:6px"><button class="stu-btn" data-char="${esc(nm)}">🎭 ${known ? "Open " + esc(known.name) + "'s card" : "Add “" + esc(nm) + "” to my characters"}</button></div>`); }
    document.body.appendChild(pop);
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, rect.left + rect.width / 2 - pop.offsetWidth / 2)) + "px";
    pop.style.top = Math.max(8, rect.top - pop.offsetHeight - 8) + "px";
    pop.onmousedown = e => e.preventDefault();
    pop.onclick = e => { const cb = e.target.closest("[data-char]"); if (cb) { hidePartPop(); window.getSelection().removeAllRanges(); charAddOrOpen(cb.dataset.char); return; } if (e.target.closest("[data-ask]")) { hidePartPop(); window.getSelection().removeAllRanges(); askPickupPrompt(run); return; } const b = e.target.closest("[data-who]"); if (!b) return; const w = b.dataset.who; hidePartPop(); window.getSelection().removeAllRanges(); if (w !== "__x") setReader(from, to, w); };
  }
  function hidePartPop() { const p = $("#part-pop"); if (p) p.remove(); }
  function setReader(from, to, who) {
    const parts = B.book.parts = B.book.parts || {};
    let part = "n";
    if (who !== "__n") { part = Object.keys(parts).find(k => k !== "n" && parts[k] === who); if (!part) { part = "r:" + who; parts[part] = who; } }
    Prep.setPart(B.chap, from, to, part);
    const pos = B.f.pos; B.toks = Prep.tokens(B.chap); B.mine = B.toks.map(t => isMine(t, B.chap)); B.f = Prep.makeFollower(B.toks, B.mine, pos); B.f.setManual(pacerManual());
    Store.saveBook(B.book); bookCounts(); renderManuscript(); renderStats();
    notice((to - from + 1) + " word" + (to > from ? "s" : "") + " now read by " + (who === "__n" ? "the narrator" : who) + ". Select them again to change it.");
  }

  // ======================= the voice waveform over the page while you record (Finished Hour drew one too) =======================
  // Full-width, like Finished Hour's: the live mic signal drawn as a line of electricity across the screen, near the bottom of
  // the page. Three passes give the glow (a wide haze, the coloured line, a white-hot core); loud moments crackle and throw sparks.
  function drawVoice() {
    const cv = $("#voice-wave"), an = B.mic && B.mic.analyser;
    if (!cv) return;
    const on = !!(B.rec && !B.rec.paused && an) && Store.settings.voiceWave !== false;
    cv.classList.toggle("on", on); if (!on) { B.sparks = []; return; }
    const dock = $("#booth-dock"), dockTop = dock ? dock.getBoundingClientRect().top : innerHeight, W = innerWidth, H = 360, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    cv.style.top = Math.round(dockTop - 120 - H / 2) + "px";          // the centre line rides about 120 px above the dock
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const buf = B.vbuf = B.vbuf && B.vbuf.length === an.fftSize ? B.vbuf : new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf);
    let pk = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; }
    const vol = Math.min(1, pk * 3), cs = getComputedStyle(document.body), col = (cs.getPropertyValue("--accent") || "#c9a45a").trim(), col2 = (cs.getPropertyValue("--accent2") || cs.getPropertyValue("--accent-hi") || "#fff").trim();
    const N = buf.length, mid = H / 2;
    const pts = new Array(N); let px = 0, py = mid;
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1) * W, e = Math.min(1, i / (N * 0.03), (N - 1 - i) / (N * 0.03));   // ease in/out over the last 3% at each edge
      const y = mid + H * 0.32 * Math.tanh(buf[i] * 2.4) * e; pts[i] = [x, y];   // soft-limited so loud lines never clip the frame
      if (Math.abs(y - mid) > Math.abs(py - mid)) { px = x; py = y; }
    }
    const line = (w, c, blur, alpha, jitter) => {
      g.globalAlpha = alpha; g.lineWidth = w; g.strokeStyle = c; g.shadowColor = c; g.shadowBlur = blur; g.lineJoin = "round"; g.lineCap = "round"; g.beginPath();
      for (let i = 0; i < N; i++) { const [x, y] = pts[i], j = jitter ? (Math.random() - 0.5) * jitter * Math.abs(y - mid) / 20 : 0; i ? g.lineTo(x, y + j) : g.moveTo(x, y + j); }
      g.stroke();
    };
    line(12, col, 40 + vol * 40, 0.22, 0);                 // haze
    line(4.5, col, 14 + vol * 26, 0.95, 0);                // the line
    if (vol > 0.25) line(1.5, col2, 10, 0.5 * vol, 6 + vol * 10);   // crackle: a second arc that won't sit still
    line(1.6, "#ffffff", 6, 0.85, 0);                      // white-hot core
    g.shadowBlur = 0; g.globalAlpha = 1;
    const sp = B.sparks = B.sparks || [];
    if (vol > 0.28 && Math.random() < vol * 0.6) for (let k = 0; k < 1 + Math.floor(Math.random() * 4); k++) sp.push({ x: px + (Math.random() - .5) * 40, y: py + (Math.random() - .5) * 24, vx: (Math.random() - .5) * 3.5, vy: -Math.random() * 2.6 - .4, life: 1, d: .018 + Math.random() * .025, s: 1.2 + Math.random() * 2.6, c: Math.random() < 0.3 ? col2 : col });
    for (let k = sp.length - 1; k >= 0; k--) { const q = sp[k]; q.x += q.vx; q.y += q.vy; q.vy += .03; q.life -= q.d; if (q.life <= 0) { sp.splice(k, 1); continue; }
      g.globalAlpha = q.life; g.fillStyle = q.c; g.shadowColor = q.c; g.shadowBlur = 10; g.beginPath(); g.arc(q.x, q.y, q.s, 0, 7); g.fill(); }
    g.globalAlpha = 1; g.shadowBlur = 0;
  }


  // ======================= waveform: a zoomed window that follows the head, one lane per track =======================
  async function loadPeaks() {
    if (!B) return;
    if (!T().hasAudio(B.audio) || (await Store.studioStatus()) !== "ready") { if (B) drawWave(); return; }
    if (!B) return; const a = B.audio, d = await dir();
    for (const tr of a.tracks) for (const c of tr.clips) if (B && !B.peaks[c.file]) { const p = await LRAudio.loadPeaks(d, c); if (p && B) B.peaks[c.file] = p; }
    if (B) drawWave();
  }
  const view = () => B.view || (B.view = { t0: 0, pps: num0(Store.lsGet("lr-pps"), 40) });
  function head() { return B.rec ? B.rec.clip.at + B.rec.clip.dur : B.player.playing ? B.player.time : B.playhead; }
  function follow(W) {
    const v = view(), span = W / v.pps, h = head(), L = len();
    if (B.dragging) return;
    if (h == null) { if (v.t0 > Math.max(0, L - span * 0.2)) v.t0 = Math.max(0, L - span * 0.8); return; }
    if (B.rec || B.player.playing) { if (h - v.t0 > span * 0.8 || h < v.t0) v.t0 = Math.max(0, h - span * 0.8); }
    else if (h < v.t0 || h > v.t0 + span) v.t0 = Math.max(0, h - span / 2);
  }
  function ticks(pps) { const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]; const major = steps.find(x => x * pps >= 78) || 3600; return { major, minor: major >= 60 ? major / 6 : major === 15 ? 5 : major / 5 }; }
  const rulerLabel = t => { const m = Math.floor(t / 60), x = Math.round(t % 60); return m + ":" + String(x).padStart(2, "0"); };
  // fades: the faded part is shaded with its curve, and a small dot at each bottom corner to drag
  function drawFades(g, c, xa, xb, top, LH, pps) {
    const fi = c.fi || 0, fo = c.fo || 0, bot = top + LH - 2, h = LH - 4;
    g.save(); g.strokeStyle = "rgba(255,255,255,.7)"; g.fillStyle = "rgba(0,0,0,.28)"; g.lineWidth = 1;
    const curve = (x0, w, rising) => { g.beginPath(); g.moveTo(x0, bot); for (let k = 0; k <= 24; k++) { const u = k / 24, y = bot - h * LRAudio.fadeCurve(rising ? u : 1 - u); g.lineTo(x0 + w * u, y); } return g; };
    if (fi > 0) { const w = fi * pps; curve(xa, w, true).stroke(); g.beginPath(); g.moveTo(xa, top + 2); curve(xa, w, true); g.lineTo(xa + w, top + 2); g.closePath(); g.fill(); }
    if (fo > 0) { const w = fo * pps, x0 = xb - w; curve(x0, w, false).stroke(); g.beginPath(); g.moveTo(x0, top + 2); curve(x0, w, false); g.lineTo(xb, top + 2); g.closePath(); g.fill(); }
    if (LH >= 30 && xb - xa > 44) {
      g.fillStyle = "rgba(255,255,255,.85)";
      for (const x of [xa + 10 + fi * pps, xb - 10 - fo * pps]) { g.beginPath(); g.arc(x, top + LH - 8, 3.5, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }
  // where the other tracks are quiet (from the waveform peaks): pauses a co-narrator line can drop into
  function quietRanges(exceptTi) {
    const L = len(), N = Math.ceil(L * 100) + 1, amp = new Float32Array(N);
    B.audio.tracks.forEach((tr, ti) => { if (ti === exceptTi) return; for (const c of tr.clips) { const pk = B.peaks[c.file]; const k0 = Math.max(0, Math.floor(c.at * 100)), k1 = Math.min(N, Math.ceil((c.at + c.dur) * 100));
      for (let k = k0; k < k1; k++) { let v = pk ? 0 : 1; if (pk) { const j = Math.floor((c.off + k / 100 - c.at) * LRAudio.PEAKS_PER_SEC); if (pk.mm) { const n = pk.mm.length / 2; if (j >= 0 && j < n) v = Math.max(Math.abs(pk.mm[2 * j]), Math.abs(pk.mm[2 * j + 1])) / 127; } else if (pk.abs && j >= 0 && j < pk.abs.length) v = pk.abs[j] / 255; } if (v > amp[k]) amp[k] = v; } } });
    const nz = Array.from(amp).filter(v => v > 0.001).sort((a, b) => a - b), thr = Math.max(0.02, (nz[Math.floor(nz.length * 0.1)] || 0) * 3);
    const out = []; let s0 = -1; for (let k = 0; k <= N; k++) { const q = k < N && amp[k] < thr; if (q && s0 < 0) s0 = k; if (!q && s0 >= 0) { if (k - s0 >= 25) out.push({ a: s0 / 100, b: k / 100 }); s0 = -1; } }
    return out;
  }
  // how long a clip's whole recording is (from its waveform peaks), so an edge can't be dragged past it
  function srcDurOf(file) { const p = B.peaks[file]; return p ? (p.mm ? p.mm.length / 2 : p.abs.length) / LRAudio.PEAKS_PER_SEC : null; }
  function drawWave() {
    const cv = $("#wave"); if (!cv || !B) return;
    const W = cv.clientWidth || 800, H = cv.clientHeight || (RULER + B.laneH), dpr = window.devicePixelRatio || 2;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    follow(W);
    const v = view(), t0 = v.t0, pps = v.pps, X = t => (t - t0) * pps, n = B.audio.tracks.length, LH = (H - RULER) / n, C = colors();
    g.fillStyle = C.lane; g.fillRect(0, 0, W, H);
    g.fillStyle = C.lane2; g.fillRect(0, 0, W, RULER);
    const { major, minor } = ticks(pps); g.font = "600 9px system-ui"; g.textBaseline = "middle";
    for (let t = Math.floor(t0 / minor) * minor; t <= t0 + W / pps; t += minor) {
      const x = X(t); if (x < 0) continue; const isMaj = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      g.fillStyle = C.tick; g.globalAlpha = isMaj ? 1 : 0.55; g.fillRect(Math.round(x), isMaj ? RULER - 6 : RULER - 3, 1, isMaj ? 6 : 3); g.globalAlpha = 1;
      if (isMaj) { g.fillStyle = C.tickInk; g.fillText(rulerLabel(t), x + 3, RULER / 2); }
    }
    const ts = trackSet(), solo = ts.some(s => s && s.solo);
    B.audio.tracks.forEach((tr, ti) => {
      const top = RULER + ti * LH, mid = top + LH / 2, amp = LH / 2 * 0.88, st = ts[ti] || {}, audible = !st.mute && (!solo || st.solo);
      if (ti === B.track && n > 1) { g.fillStyle = `rgba(${C.w1.join(",")},.08)`; g.fillRect(0, top, W, LH); }
      if (ti > 0) { g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(0, top, W, 1); }
      g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect(0, mid, W, 1);
      const base = ti === 0 ? C.w1 : C.w2, col = `rgb(${base.join(",")})`;
      g.save(); g.beginPath(); g.rect(0, top, W, LH); g.clip();
      const order = tr.clips.map((c, ci) => [c, ci]).sort((x, y) => (B.rec && B.rec.file === x[0].file ? 1 : 0) - (B.rec && B.rec.file === y[0].file ? 1 : 0));
      order.forEach(([c, ci]) => {
        const live = B.rec && B.rec.clip === c;
        const x0 = Math.max(0, Math.floor(X(c.at))), x1 = Math.min(W, Math.ceil(X(c.at + c.dur))); if (x1 <= x0) return;
        if (live) { g.fillStyle = C.lane; g.fillRect(x0, top + 1, x1 - x0, LH - 1); }
        const pk = (B.rec && B.rec.file === c.file) ? { mm: B.rec.writer.mm } : B.peaks[c.file];
        g.fillStyle = live ? "#e5473b" : !audible ? "#7a7568" : col;
        if (!pk) { g.globalAlpha = .3; g.fillRect(x0, mid - 2, x1 - x0, 4); g.globalAlpha = 1; }
        else for (let x = x0; x < x1; x++) {
          const a = Math.max(0, Math.floor((c.off + t0 + x / pps - c.at) * LRAudio.PEAKS_PER_SEC)), b = Math.max(a + 1, Math.ceil((c.off + t0 + (x + 1) / pps - c.at) * LRAudio.PEAKS_PER_SEC));
          let mn = 0, mx = 0;
          if (pk.mm) { const nn = pk.mm.length / 2; for (let k = a; k < Math.min(b, nn); k++) { const lo = pk.mm[2 * k] / 127, hi = pk.mm[2 * k + 1] / 127; if (lo < mn) mn = lo; if (hi > mx) mx = hi; } }
          else { for (let k = a; k < Math.min(b, pk.abs.length); k++) { const m = pk.abs[k] / 255; if (m > mx) mx = m; } mn = -mx; }
          if (c.g) { const gg = Math.pow(10, c.g / 20); mx = Math.min(1, mx * gg); mn = Math.max(-1, mn * gg); }
          if (mx - mn < 0.004) continue;
          g.fillRect(x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
        }
        if (live) { const tw = Math.min(110, x1 - x0), tg = g.createLinearGradient(x1 - tw, 0, x1, 0); tg.addColorStop(0, "rgba(255,59,87,0)"); tg.addColorStop(1, "rgba(255,59,87,.32)"); g.fillStyle = tg; g.fillRect(x1 - tw, top, tw, LH); }
        const xa = X(c.at), xb = X(c.at + c.dur), picked = B.selTake && B.selTake.ti === ti && B.selTake.ci === ci, frame = live ? "255,59,87" : picked ? "255,244,214" : base.join(",");
        if (picked) { g.fillStyle = "rgba(255,244,214,.10)"; g.fillRect(xa, top + 1, xb - xa, LH - 2); }
        g.strokeStyle = `rgba(${frame},.7)`; g.lineWidth = 1; g.strokeRect(Math.round(xa) + .5, top + 1.5, Math.max(2, Math.round(xb - xa)), LH - 3);
        g.fillStyle = `rgba(${frame},.55)`; g.fillRect(Math.round(xa), top + 2, 3, LH - 4); g.fillRect(Math.round(xb) - 2, top + 2, 3, LH - 4);
        if (LH >= 30 && xb - xa > 46) { g.fillStyle = "rgba(255,255,255,.55)"; g.font = "10px system-ui"; g.fillText(live ? "● Recording" : (B.fxBusy === ti && ci === B.audio.tracks[ti].clips.length - 1 ? "🎛 … " : c.fx ? "🎛 " : "") + (c.line ? "👥 " + c.line.r : "Take " + (ci + 1)) + (c.g ? "  " + (c.g > 0 ? "+" : "") + c.g + " dB" : ""), Math.max(xa, 0) + 6, top + 10); }
        if (!live) drawFades(g, c, xa, xb, top, LH, pps);
      });
      g.restore();
    });
    if (!B.rec) for (const m of B.audio.markers) if (!m.done && !m.slot) {       // pickup zones: exactly what Fix will replace
      const z = pkZone(m), xa = X(z.a), xb = X(z.b); if (xb < 0 || xa > W) continue;
      g.fillStyle = "rgba(255,59,79,.16)"; g.fillRect(xa, RULER, xb - xa, H - RULER);
      g.fillStyle = "rgba(255,59,79,.9)"; g.fillRect(xa - 1, RULER, 2, H - RULER); g.fillRect(xb - 1, RULER, 2, H - RULER);
      g.fillRect(xa - 4, RULER, 8, 6); g.fillRect(xb - 4, RULER, 8, 6);
      if (xb - xa > 46) { g.font = "600 10px system-ui"; g.fillText("PICKUP", xa + 5, RULER + 15); }
    }
    if (B.sel) { const xa = X(B.sel.a), xb = X(B.sel.b); g.fillStyle = "rgba(245,236,214,.16)"; g.fillRect(xa, RULER, xb - xa, H - RULER); g.fillStyle = "rgba(245,236,214,.7)"; g.fillRect(xa, RULER, 1, H - RULER); g.fillRect(xb - 1, RULER, 1, H - RULER); }
    if (B.ghost) { const gx = X(B.ghost.at), gw = B.ghost.dur * pps, top = RULER + B.ghost.ti * LH; g.strokeStyle = "rgba(245,236,214,.9)"; g.setLineDash([4, 3]); g.strokeRect(gx, top + 1, gw, LH - 2); g.setLineDash([]);
      if (B.ghost.mode) { g.fillStyle = B.ghost.mode === "snap" ? "rgba(90,200,190,.25)" : "rgba(255,190,90,.22)"; g.fillRect(gx, top + 1, gw, LH - 2); g.fillStyle = "#fff"; g.font = "11px system-ui"; g.fillText(B.ghost.mode === "snap" ? "👥 drops into this pause" : B.ghost.mode === "move" ? "👥 slides the line (nothing else moves)" : "👥 opens space here", Math.max(4, gx + 6), top + 14); } }
    if (B.trimView) { const tv = B.trimView, xa = X(tv.a), xb = X(tv.b);
      g.fillStyle = tv.open ? "rgba(70,200,190,.32)" : "rgba(229,71,59,.35)";
      for (const ln of tv.lanes) g.fillRect(Math.min(xa, xb), RULER + ln * LH, Math.max(2, Math.abs(xb - xa)), LH);
      const ex = X(tv.edge); g.strokeStyle = "rgba(255,255,255,.75)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(ex + .5, RULER); g.lineTo(ex + .5, H); g.stroke(); g.setLineDash([]);
      g.font = "600 12px system-ui"; const txt = tv.label, tw = g.measureText(txt).width + 12, lx = Math.min(W - tw - 4, Math.max(4, X(tv.cursor) + 10));
      g.fillStyle = "rgba(10,10,10,.82)"; g.fillRect(lx, RULER + 4, tw, 20); g.fillStyle = tv.open ? "#7fe3d8" : "#ff8a7a"; g.fillText(txt, lx + 6, RULER + 18); }
    for (const m of B.audio.markers) { const x = X(m.t); if (x < -8 || x > W + 8) continue; g.fillStyle = "#e5473b"; g.fillRect(x - 1, RULER, 2, H - RULER); g.beginPath(); g.moveTo(x, RULER); g.lineTo(x + 8, RULER + 4.5); g.lineTo(x, RULER + 9); g.fill(); }
    const ph = head();
    if (ph != null) { const x = X(ph); g.fillStyle = B.rec ? "#ff5a4d" : "#f5ecd6"; g.fillRect(x - 1, 0, 2, H); if (B.rec) { g.shadowColor = "#ff3b57"; g.shadowBlur = 12; g.fillRect(x - 1, 0, 2, H); g.shadowBlur = 0; } }
  }
  // lane colours come from the theme (read once per theme)
  function colors() {
    const th = document.documentElement.dataset.theme || "ledger";
    if (B.col && B.col.th === th) return B.col;
    const cs = getComputedStyle(document.body), v = k => cs.getPropertyValue(k).trim();
    const rgb = h => { h = (h || "#c9a45a").replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
    return B.col = { th, lane: v("--lane") || "#1d1810", lane2: v("--lane2") || "#241d14", tick: v("--tick") || "#6b5a44", tickInk: v("--tick-ink") || "#b8a98c", w1: rgb(v("--wave")), w2: rgb(v("--wave2")) };
  }
  // mouse on the waveform: click = playhead, drag = select, drag a take's label strip (or ⌥-drag) = move the take
  function bindWave(cv) {
    if (cv._bound) return; cv._bound = true;
    const pos = e => { const r = cv.getBoundingClientRect(), v = view(), n = B.audio.tracks.length, LH = (r.height - RULER) / n; const y = e.clientY - r.top; return { t: v.t0 + (e.clientX - r.left) / v.pps, ti: Math.max(0, Math.min(n - 1, Math.floor((y - RULER) / LH))), y, LH }; };
    // what's under the pointer: a fade dot, a clip edge, or nothing special
    const hitTest = e => {
      const r = cv.getBoundingClientRect(), v = view(), n = B.audio.tracks.length, LH = (r.height - RULER) / n, x = e.clientX - r.left, y = e.clientY - r.top;
      if (y < RULER) return null;
      const ti = Math.max(0, Math.min(n - 1, Math.floor((y - RULER) / LH))), top = RULER + ti * LH, clips = B.audio.tracks[ti].clips, X = t => (t - v.t0) * v.pps;
      for (const m of B.audio.markers) if (!m.done && !m.slot) { const z = pkZone(m); if (Math.abs(x - X(z.a)) <= 5) return { kind: "pz", side: "a", id: m.id }; if (Math.abs(x - X(z.b)) <= 5) return { kind: "pz", side: "b", id: m.id }; }
      if (LH >= 30 && Math.abs(y - (top + LH - 8)) <= 8) for (let ci = 0; ci < clips.length; ci++) {
        const c = clips[ci], xa = X(c.at), xb = X(c.at + c.dur); if (xb - xa <= 44) continue;
        if (Math.abs(x - (xa + 10 + (c.fi || 0) * v.pps)) <= 7) return { kind: "fade", side: "in", ti, ci, xa, xb };
        if (Math.abs(x - (xb - 10 - (c.fo || 0) * v.pps)) <= 7) return { kind: "fade", side: "out", ti, ci, xa, xb };
      }
      let best = null;
      for (let ci = 0; ci < clips.length; ci++) for (const edge of ["start", "end"]) {
        const px = X(edge === "start" ? clips[ci].at : clips[ci].at + clips[ci].dur), d = Math.abs(x - px);
        if (d <= 5 && (!best || d < best.d)) best = { kind: "edge", edge, ti, ci, d };
      }
      return best;
    };
    // snap a dragged edge to other clips' edges and the markers (within 8 px)
    const snapTo = (t, ti, ci) => { const v = view(), pts = [0]; B.audio.tracks.forEach((tr, k) => tr.clips.forEach((c, j) => { if (k === ti && j === ci) return; pts.push(c.at, c.at + c.dur); })); B.audio.markers.forEach(m => pts.push(m.t)); let best = t, bd = 8 / v.pps; for (const q of pts) { const d = Math.abs(q - t); if (d < bd) { bd = d; best = q; } } return best; };
    cv.onpointerdown = e => {
      if (!B || B.rec) return;
      const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t), inStrip = (p.y - RULER) % p.LH < 16, h = hitTest(e);
      cv.setPointerCapture(e.pointerId);
      if (h && h.kind === "pz") { pushUndo(); B.dragging = Object.assign(h, { x0: e.clientX, moved: false }); return; }
      if (h && h.kind === "fade") { pushUndo(); B.dragging = Object.assign(h, { x0: e.clientX, moved: false }); B.track = h.ti; return; }
      if (h && h.kind === "edge") { const c = B.audio.tracks[h.ti].clips[h.ci]; pushUndo(); B.dragging = Object.assign(h, { x0: e.clientX, moved: false, orig: JSON.stringify(B.audio), src: srcDurOf(c.file), t0: h.edge === "start" ? c.at : c.at + c.dur }); B.track = h.ti; return; }
      if (ci >= 0 && (inStrip || e.altKey)) {
        const c = B.audio.tracks[p.ti].clips[ci];
        B.dragging = { kind: "move", ti: p.ti, ci, grab: p.t - c.at, x0: e.clientX, co: !!c.line };
        B.ghost = { at: c.at, ti: p.ti, dur: c.dur };
        if (c.line) B.dragging.pz = quietRanges(p.ti);
      } else B.dragging = { kind: "sel", a: p.t, x0: e.clientX, ti: p.ti };
      drawWave();
    };
    cv.onpointermove = e => {
      const d = B && B.dragging; if (!d) { if (B && !B.rec) { const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t), h = hitTest(e); cv.style.cursor = h ? (h.kind === "fade" ? "grab" : "ew-resize") : ci >= 0 && ((p.y - RULER) % p.LH < 16 || e.altKey) ? "grab" : "crosshair"; } return; }
      const p = pos(e);
      if (d.kind === "pz") {
        const m = B.audio.markers.find(x => x.id === d.id); if (!m) return; d.moved = true; pkZone(m); cv.style.cursor = "ew-resize";
        const t = Math.max(0, Math.min(len(), p.t));
        if (d.side === "a") m.zone.da = +Math.min(m.zone.db - 0.2, t - m.t).toFixed(3); else m.zone.db = +Math.max(m.zone.da + 0.2, t - m.t).toFixed(3);
        drawWave(); return;
      }
      if (d.kind === "fade") {
        const v = view(), c = B.audio.tracks[d.ti].clips[d.ci], r = cv.getBoundingClientRect(), x = e.clientX - r.left; if (!c) return; d.moved = true;
        const f = d.side === "in" ? (x - (d.xa + 10)) / v.pps : ((d.xb - 10) - x) / v.pps, val = +Math.max(0, Math.min(10, c.dur / 2, f)).toFixed(3);
        if (d.side === "in") { if (val) c.fi = val; else delete c.fi; } else { if (val) c.fo = val; else delete c.fo; }
        drawWave(); return;
      }
      if (d.kind === "edge") {
        if (Math.abs(e.clientX - d.x0) > 2) d.moved = true; if (!d.moved) return;
        const v = view(); let dd = (e.clientX - d.x0) / v.pps; dd = snapTo(d.t0 + dd, d.ti, d.ci) - d.t0;
        B.chap.audio[B.readingAs] = B.audio = T().normalize(JSON.parse(d.orig));
        d.applied = T().trimEdge(B.audio, d.ti, d.ci, d.edge, dd, !e.altKey, d.src); cv.style.cursor = "ew-resize";
        { const ap = d.applied, oe = d.t0, open = d.edge === "end" ? ap > 0 : ap < 0, a = d.edge === "end" ? oe : oe, b = d.edge === "end" ? oe + ap : oe - ap;
          B.trimView = Math.abs(ap) < 0.005 ? null : { a: Math.min(a, b), b: Math.max(a, b), open, lanes: e.altKey ? [d.ti] : B.audio.tracks.map((_, i) => i), edge: oe, cursor: view().t0 + (e.clientX - cv.getBoundingClientRect().left) / view().pps,
            label: (open ? "+" : "−") + Math.abs(ap).toFixed(2) + " s" + (e.altKey ? " · this take only" : " · everything after moves") }; }
        drawWave(); return;
      }
      if (d.kind === "move") {
        let at = Math.max(0, p.t - d.grab); B.ghost.ti = p.ti; cv.style.cursor = "grabbing";
        if (d.co) { B.ghost.ti = d.ti; const v = view(), pz = (d.pz || []).filter(q => Math.abs((q.a + q.b) / 2 - at) < Math.max(1, 30 / v.pps)).sort((x, y) => Math.abs((x.a + x.b) / 2 - at) - Math.abs((y.a + y.b) / 2 - at))[0];
          const c0 = B.audio.tracks[d.ti].clips[d.ci], near = c0 && at > c0.at - c0.dur && at < c0.at + c0.dur;
          if (near) B.ghost.mode = "move"; else if (pz) { at = (pz.a + pz.b) / 2; B.ghost.mode = "snap"; } else B.ghost.mode = "open"; }
        B.ghost.at = at;
      }
      else if (Math.abs(e.clientX - d.x0) > 3) { B.selTake = null; B.sel = { a: Math.max(0, Math.min(d.a, p.t)), b: Math.min(len(), Math.max(d.a, p.t)) }; }
      drawWave();
    };
    cv.onpointerup = e => {
      const d = B && B.dragging; if (!d) return; B.dragging = null;
      const p = pos(e);
      if (d.kind === "pz") { if (!d.moved) { B.undo.pop(); return; } Store.saveBook(B.book); renderSide(); return; }
      if (d.kind === "fade" || d.kind === "edge") {
        B.trimView = null;
        if (!d.moved) { B.undo.pop(); if (d.kind === "edge") { const c = B.audio.tracks[d.ti].clips[d.ci]; if (c) selectTake(d.ti, d.ci); } return; }
        edited(); B.peaks = B.peaks || {};
        if (d.kind === "edge" && d.applied) notice((d.applied > 0 ? "Opened " : "Tightened ") + Math.abs(d.applied).toFixed(2) + " s" + (e.altKey ? " on this track only." : ", everything after moved with it."));
        return;
      }
      if (d.kind === "move" && d.co && Math.abs(e.clientX - d.x0) > 3) {     // a co-narrator line: lift it out, drop it into a pause, open room for it
        const g = B.ghost; B.ghost = null; pushUndo();
        const c0 = B.audio.tracks[d.ti].clips[d.ci], oa = c0.at, ob = c0.at + c0.dur; let at = g.at;
        if (g.mode === "move") { T().moveClip(B.audio, d.ti, d.ci, d.ti, at); edited(); notice("👥 Line moved " + (at > oa ? "later" : "earlier") + " by " + Math.abs(at - oa).toFixed(2) + " s."); return; }
        const c = B.audio.tracks[d.ti].clips.splice(d.ci, 1)[0];
        if ((d.pz || []).some(q => q.a <= oa + 0.05 && q.b >= ob - 0.05)) { T().deleteRange(B.audio, oa, ob); if (at >= ob) at -= c.dur; }
        T().insertGap(B.audio, at, c.dur); T().overwrite(B.audio, d.ti, [Object.assign({}, c, { at: 0 })], at);
        edited(); notice("👥 Line moved to " + clock(at) + (g.mode === "snap" ? ", into the pause." : ", with room opened for it."));
        return;
      }
      if (d.kind === "move") {
        const g = B.ghost; B.ghost = null;
        if (Math.abs(e.clientX - d.x0) > 3 || g.ti !== d.ti) { pushUndo(); T().moveClip(B.audio, d.ti, d.ci, g.ti, g.at); B.track = g.ti; edited(); }
        else selectTake(d.ti, d.ci);
        return;
      }
      if (Math.abs(e.clientX - d.x0) <= 3) { B.sel = null; B.selTake = null; B.track = d.ti; seek(p.t); renderEditBar(); return; }
      if (B.sel && B.sel.b - B.sel.a < 0.02) B.sel = null;
      B.track = d.ti; renderEditBar(); renderTransport();
    };
    cv.ondblclick = e => { if (!B || B.rec) return; const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t); if (ci >= 0) { const c = B.audio.tracks[p.ti].clips[ci]; selectTake(p.ti, ci); B.sel = { a: c.at, b: c.at + c.dur }; renderTransport(); } };
    cv.onwheel = e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) { setZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); return; } const v = view(); v.t0 = Math.max(0, v.t0 + (e.deltaX || e.deltaY) / v.pps); B.dragging = null; drawWave(); };
  }
  function animate() {
    if (!B) return;
    drawWave(); drawVoice(); if (B.rec) duetLive();
    const tt = $("#bd-time"); if (tt) tt.textContent = clock(B.rec ? B.rec.clip.at + B.rec.clip.dur : B.player.playing ? B.player.time : len());
    meters();
    if (B.rec || B.player.playing) B.raf = requestAnimationFrame(animate); else B.raf = null;
  }
  function meters() {
    const db = B.mic.isOpen ? B.mic.level : -90, pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100)), cls = db > -3 ? "hot" : db > -12 ? "ok" : "";
    const lv = $("#bd-lvl"); if (lv) { lv.style.width = pct + "%"; lv.className = cls; }
    const lf = $("#lm-fill"); if (lf) { lf.style.width = (B.lmOn || B.rec ? pct : 0) + "%"; lf.className = "lm-fill " + cls; }
    const lm = $("#lm-msg"); if (lm && (B.lmOn || B.rec)) { const h = B.mic.peakHold; lm.textContent = B.mic.clip ? "Clipping — lower the gain" : h < -40 ? "Say a line…" : h > -3 ? "Too hot" : h > -12 ? "Good level" : "Too quiet"; if (Date.now() - (B.lmT || 0) > 2500) { B.mic.peakHold = -90; B.mic.clip = false; B.lmT = Date.now(); } }
  }
  function startAnim() { if (B && !B.raf) B.raf = requestAnimationFrame(animate); }
  // ↓ / ↑: the start of your next / previous line (a run of your words, or a new paragraph of them)
  // manual pacing (per person): the text only moves on past a sentence when you say so
  function nextSentence() {
    const old = B.f.pos; B.f.next(); prog().pos = B.f.pos;
    if (B.rec) { advanced(old, B.f.pos); B.rec.lastW = null; }
    markPos(true); renderStats();
    if (!B.rec) { const t = T().timeOfWord(B.audio, B.f.pos); if (t != null && t <= len()) seek(Math.max(0, t - 0.3)); }
  }
  function renderPacer() {
    let el = document.getElementById("fnext");
    if (!B || !pacerManual()) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("button"); el.id = "fnext"; el.className = "fnext"; el.onclick = () => { el.blur(); nextSentence(); }; document.body.appendChild(el); }
    const done = B.f.atEnd();
    el.classList.toggle("ready", done);
    el.innerHTML = (done ? "Next sentence ▶" : "Skip to next ▶") + ` <span>${esc(kl("nextLine").replace("ArrowDown", "↓").replace("ArrowRight", "→"))}</span>`;
    el.title = done ? "Done with this sentence? Move on (re-read it as often as you like first)." : "Move on without finishing this sentence";
  }
  function jumpLine(dir) {
    const toks = B.toks, mine = B.mine, isStart = i => mine[i] && (i === 0 || !mine[i - 1] || toks[i].p !== toks[i - 1].p);
    let cur = B.f.pos; while (cur > 0 && !isStart(cur) && mine[cur]) cur--;
    let i = dir > 0 ? B.f.pos + 1 : cur - 1;
    while (i >= 0 && i < toks.length && !isStart(i)) i += dir;
    if (i < 0 || i >= toks.length) return;
    B.f.set(i); prog().pos = B.f.pos; markPos(true);
    if (!B.rec) { const t = T().timeOfWord(B.audio, i); if (t != null && t <= len()) seek(Math.max(0, t - 0.3)); }
    if (B.rec) B.rec.lastW = null;
  }
  // ⌥← / ⌥→: slide the selected take (handy for a co-narrator line that landed a hair early or late)
  function nudge(d) {
    if (B.rec || !B.selTake) return; const { ti, ci } = B.selTake, c = B.audio.tracks[ti] && B.audio.tracks[ti].clips[ci]; if (!c) return;
    pushUndo(); const at = Math.max(0, c.at + d); T().moveClip(B.audio, ti, ci, ti, at);
    const k = B.audio.tracks[ti].clips.findIndex(x => Math.abs(x.at - at) < 1e-4); B.selTake = k >= 0 ? { ti, ci: k } : null; Store.saveBook(B.book); drawWave();
  }
  function setZoom(f) { const v = view(); v.pps = Math.max(0.2, Math.min(400, v.pps * f)); Store.lsSet("lr-pps", v.pps.toFixed(2)); drawWave(); }
  function fitZoom() { const cv = $("#wave"), v = view(), W = cv ? cv.getBoundingClientRect().width : 1000, L = Math.max(10, len() + (B.audio.pad || 0)); v.pps = Math.max(0.2, (W - 24) / L); v.t0 = 0; Store.lsSet("lr-pps", v.pps.toFixed(2)); drawWave(); }
  function laneSize(f) { B.laneH = Math.max(34, Math.min(200, Math.round(B.laneH * f))); Store.lsSet("lr-laneh", B.laneH); renderTransport(); }
  function setHint(s) { const h = $(`.trk-head[data-t="${B.track}"] .th-sub`); if (h) h.textContent = s; }

  // ======================= export =======================
  function exportDialog(afterComplete) {
    if (B.rec) return;
    const S = Store.settings, pat = S.namePattern || "{book} - {nn} - {chapter}";
    const st = B.exp = B.exp || { fmt: localStorage.getItem("lr-xfmt") || "wav", dest: "folder" };
    st.proof = Store.lsGet("lr-xproof") === "1"; st.space = Store.lsGet("lr-xspace") === "1";
    const ov = document.createElement("div"); ov.className = "overlay";
    const draw = () => {
      const base = LRExport.fileName(st.pat || pat, B.book, B.chap, B.ci), ext = st.fmt === "mp3" ? ".mp3" : ".wav";
      ov.innerHTML = `<div class="card reader" style="max-width:600px"><h2>⤓ Export ${esc(B.chap.title)}</h2>
        <div class="xfmt">${[["wav", "WAV · 44.1 kHz, 16-bit", "ACX-ready delivery"], ["mp3", "MP3 · 192 kbps, 44.1 kHz", "ACX-ready delivery"], ["raw", "Raw WAV · 48 kHz, 24-bit", "Untouched, for Auphonic or your editor"]]
          .map(([k, l, s]) => `<button class="xopt ${st.fmt === k ? "on" : ""}" data-f="${k}"><b>${l}</b><span>${s}</span></button>`).join("")}</div>
        <label style="display:flex;margin-top:12px">File name<input id="xname" value="${esc(base)}"></label>
        <label style="display:flex;margin-top:8px">Naming pattern<input id="xpat" value="${esc(st.pat || pat)}"></label>
        <p class="small muted">{book} {chapter} {title} {n} {nn} {nnn}. ${B.audio.tracks.length > 1 ? "All audible tracks are mixed down at their volumes. " : ""}${st.fmt !== "mp3" && B.audio.markers.some(m => m.note) ? "Named markers are written into the WAV." : ""}</p>
        <div class="xbefore"><div class="section-label">Before it exports</div>
          <label class="check"><input type="checkbox" id="xproof" ${st.proof ? "checked" : ""}> 🔎 Proof the chapter: listen through it and flag anything misread first</label>
          <label class="check"><input type="checkbox" id="xspace" ${st.space ? "checked" : ""}> ⏱ Even out pauses: ${pz().head} s head, ${pz().heading} s after the heading, ${pz().scene} s at scene breaks, ${pz().tail} s tail, long gaps down to ${pz().cap} s</label></div>
        <div id="xmsg"></div>
        <div class="row" style="margin-top:6px"><label class="check"><input type="radio" name="xd" value="folder" ${st.dest === "folder" ? "checked" : ""}> The book's exports folder</label><label class="check"><input type="radio" name="xd" value="choose" ${st.dest === "choose" ? "checked" : ""}> Choose where to save…</label></div>
        <div id="xprog" class="bar hidden" style="margin-top:12px"><i style="width:0;background:var(--accent)"></i></div>
        <div class="row" style="margin-top:12px"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" id="xgo">Export ${esc(ext.slice(1).toUpperCase())}</button></div></div>`;
      $$("[data-f]", ov).forEach(b => b.onclick = () => { st.fmt = b.dataset.f; localStorage.setItem("lr-xfmt", st.fmt); draw(); });
      $("#xpat", ov).onchange = e => { st.pat = e.target.value; Store.settings.namePattern = e.target.value; Store.saveSettings(); draw(); };
      $$("[name=xd]", ov).forEach(r => r.onchange = () => { st.dest = r.value; });
      $("#xproof", ov).onchange = e => { st.proof = e.target.checked; Store.lsSet("lr-xproof", st.proof ? "1" : "0"); };
      $("#xspace", ov).onchange = e => { st.space = e.target.checked; Store.lsSet("lr-xspace", st.space ? "1" : "0"); };
      $("[data-x]", ov).onclick = () => ov.remove();
      $("#xgo", ov).onclick = () => before($("#xname", ov).value.trim() || base, ext, false);
    };
    // the ticks first: even the pauses, proof the chapter (and stop to review if it found anything)
    const before = async (name, ext, anyway) => {
      const msg = $("#xmsg", ov), bt = $("#xgo", ov), bar = $("#xprog", ov), fill = $("#xprog i", ov);
      if (!anyway && (st.space || st.proof)) {
        bt.disabled = true;
        try {
          if (st.space) { bt.textContent = "Evening out pauses…"; await evenPauses(false); }
          if (st.proof) {
            bt.textContent = "Proofing…"; bar.classList.remove("hidden");
            const n = await proofChapter(p => { fill.style.width = Math.round(p * 100) + "%"; });
            bar.classList.add("hidden"); fill.style.width = "0";
            if (n) {
              msg.innerHTML = `<div class="xwarn"><b>🔎 ${n} spot${n === 1 ? "" : "s"} to check</b> before this goes out. They're underlined in the text and listed in Pickups.<div class="row" style="margin-top:8px"><button class="btn primary" data-rev>Review them</button><button class="btn" data-anyway>Export anyway</button></div></div>`;
              $("[data-rev]", msg).onclick = () => { ov.remove(); B.side = null; B.tab = "pickups"; act("tools"); };
              $("[data-anyway]", msg).onclick = () => { msg.innerHTML = ""; before(name, ext, true); };
              bt.disabled = false; bt.textContent = "Export " + ext.slice(1).toUpperCase(); return;
            }
            msg.innerHTML = `<div class="small" style="color:var(--good);margin:6px 0">🔎 Proofed: it matches your text ✓</div>`;
          }
        } catch (e) { toast("Couldn't finish the checks: " + e.message + ". Exporting anyway is up to you."); bt.disabled = false; bt.textContent = "Export " + ext.slice(1).toUpperCase(); return; }
        bt.disabled = false;
      }
      return go(name, ext);
    };
    const go = async (name, ext) => {
      name = name.replace(/[\\/:*?"<>|]+/g, "").replace(/\.(wav|mp3)$/i, "") + ext;
      let fh;
      try {
        if (st.dest === "choose" && window.showSaveFilePicker) fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext === ".mp3" ? "MP3 audio" : "WAV audio", accept: ext === ".mp3" ? { "audio/mpeg": [".mp3"] } : { "audio/wav": [".wav"] } }] });
        else { const bd = await Store.studio.getDirectoryHandle(B.book.folder, { create: true }); const xd = await bd.getDirectoryHandle("exports", { create: true }); fh = await xd.getFileHandle(name, { create: true }); }
      } catch (e) { if (e.name !== "AbortError") toast(e.message); return; }
      const bar = $("#xprog", ov), fill = $("#xprog i", ov); bar.classList.remove("hidden"); $("#xgo", ov).disabled = true; $("#xgo", ov).textContent = "Exporting…";
      try {
        await LRExport.exportChapter(await mix(), len() + (B.audio.pad || 0), st.fmt, fh, B.audio.markers, p => { fill.style.width = Math.round(p * 100) + "%"; });
        B.chap.exportedAt = new Date().toISOString();
        const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"];
        if (order.indexOf(B.chap.status) < 2) B.chap.status = "edited";
        Store.saveBook(B.book, true);
        ov.remove(); notice("Exported " + name + (st.dest === "folder" ? " to the book's exports folder." : "."));
      } catch (e) { toast("Export failed: " + e.message); $("#xgo", ov).disabled = false; $("#xgo", ov).textContent = "Try again"; }
    };
    draw(); document.body.appendChild(ov);
  }

  // ======================= chapter complete =======================
  // daily goals: each one celebrated once a day, the first time it's reached (goals already met when you open the Booth stay quiet)
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function goalsNow() {
    const S = Store.settings, nar = (S.narrators || []).find(n => n.name === B.readingAs) || (S.narrators || [])[0] || { pace: 4000 }, hrs = S.boothHoursPerDay || 6;
    return { words: Math.round((nar.pace || 4000) * hrs), booth: hrs * 3600, earn: +S.goalEarn || 0, pace: nar.pace || 4000 };
  }
  function checkGoals(prime) {
    if (!B || !window.LRCele) return;
    let st; try { st = statsNow(); } catch (e) { return; }
    const G = goalsNow(), today = new Date().toISOString().slice(0, 10), key = "lr-goals-" + B.readingAs;
    let met = {}; try { met = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
    if (met.day !== today) met = { day: today, primed: false };
    const hit = { words: G.words && st.wordsToday >= G.words, booth: G.booth && st.boothToday >= G.booth, earn: G.earn && st.earnedToday >= G.earn };
    const msg = { words: ["DAILY WORDS: DONE", num(st.wordsToday) + " of your own words today"], booth: ["BOOTH GOAL HIT", hm(st.boothToday) + " in the booth today"], earn: ["EARNINGS GOAL HIT", "$" + Math.round(st.earnedToday) + " earned today"] };
    for (const k in hit) if (hit[k] && !met[k]) { met[k] = true; if (met.primed && !prime) LRCele.celebrate({ title: msg[k][0], sub: msg[k][1], level: 2 }); }
    met.primed = true;
    try { localStorage.setItem(key, JSON.stringify(met)); } catch (e) {}
  }
  function paceCheer() {
    const p = prog(), words = B.counts[B.ci].mine, sec = p.boothSec || 0;
    if (!window.LRCele || sec < 600 || !words) return;
    const pace = Math.round(words / (sec / 3600)), G = goalsNow(), bestKey = "lr-bestpace-" + B.readingAs, best = +localStorage.getItem(bestKey) || 0;
    if (pace > best && best) { LRCele.celebrate({ title: "PERSONAL BEST PACE", sub: num(pace) + " words an hour on " + B.chap.title, level: 2 }); }
    else if (pace >= G.pace * 1.05) LRCele.celebrate({ title: "PACE " + num(pace), sub: "words an hour, " + Math.round((pace / G.pace - 1) * 100) + "% over your usual", level: 1, noConfetti: true });
    if (pace > best) try { localStorage.setItem(bestKey, String(pace)); } catch (e) {}
  }
  async function chapterComplete(manual) {
    const p = prog();
    if (p.done && !manual) return;
    if (pz().onComplete && len() && !B.rec) await evenPauses(false);
    p.done = true; p.readTo = Math.max(p.readTo, B.toks.length);
    delete B.bRun[B.ci];                         // Finished Hour: marking the chapter complete stops its booth clock
    const readers = Object.keys(Prep.wordsByReader(B.chap, B.book)).filter(r => r !== "?");
    const allDone = !readers.length || readers.every(r => ((B.chap.prog || {})[r] || {}).done);
    const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"];
    if (allDone && order.indexOf(B.chap.status) < 1) B.chap.status = "recorded";
    Store.saveBook(B.book, true); bookCounts();
    const finish = async () => {
      if (B.rec) await stopRecording();
      bookCounts();
      const bookMineDone = B.counts.every((k, i) => !B.book.chapters[i].included || !k.mine || ((B.book.chapters[i].prog || {})[B.readingAs] || {}).done);
      if (window.LRCele) {
        LRCele.celebrate({ title: "CHAPTER DONE", sub: B.chap.title + " · " + num(B.counts[B.ci].mine) + " words" + (prog().boothSec ? " in " + hm(prog().boothSec) : ""), level: 2 });
        paceCheer();
        if (bookMineDone) LRCele.celebrate({ title: "BOOK RECORDED", sub: "Every one of your lines in " + B.book.title + ". Go outside. Briefly.", level: 3 });
      } else cheer("chapterRecorded");
      const next = B.book.chapters.findIndex((c, i) => i > B.ci && c.included && myCount(B.book, c).mine > 0);
      const has = T().hasAudio(B.audio), sendable = has && !amLead() && myRuns().length > 0;
      const ov = document.createElement("div"); ov.className = "overlay";
      ov.innerHTML = `<div class="card reader" style="max-width:480px;text-align:center"><div style="font-size:2.2rem">🎉</div><h2>${esc(B.chap.title)} is done!</h2>
        <p class="muted">${!allDone ? "Your part is done. It's marked Recorded once every reader has finished theirs. " : ""}${has ? (B.chap.exportedAt ? "You've already exported this one. Export again if you changed anything." : "Export it now while it's fresh, or move on and export later.") : ""}</p>
        ${sendable ? `<p class="small" style="margin:4px 0 10px">You're co-narrating: send your lines to ${esc(Prep.readerOf("n", B.chap, B.book) || "the lead")} so they drop into the chapter.</p>` : ""}
        <div class="row" style="justify-content:center">${sendable ? `<button class="btn primary" data-send>📤 Send my lines</button>` : ""}${has ? `<button class="btn ${sendable ? "" : "primary"}" data-exp>Export this chapter</button>` : ""}${next >= 0 ? `<button class="btn" data-next>Next chapter →</button>` : ""}<button class="btn quiet" data-stay>Stay here</button></div></div>`;
      document.body.appendChild(ov);
      $("[data-stay]", ov).onclick = () => { ov.remove(); render(); };
      const nb = $("[data-next]", ov); if (nb) nb.onclick = () => { ov.remove(); openChapter(next); };
      const xb = $("[data-exp]", ov); if (xb) xb.onclick = () => { ov.remove(); render(); exportDialog(true); };
      const sb = $("[data-send]", ov); if (sb) sb.onclick = async () => { sb.disabled = true; sb.textContent = "Sending…"; await sendLines(); sb.textContent = "Sent ✓"; };
    };
    finish();
  }

  // ======================= keys =======================
  function onKey(e) {
    if (!B) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !/^(checkbox|radio|button|range|color)$/i.test(t.type)));
    if (typing) return;
    if (document.querySelector(".overlay")) return;
    const code = e.code || "", mod = e.metaKey || e.ctrlKey;
    if (t && /^(BUTTON|SELECT|INPUT|A)$/.test(t.tagName) && !mod) t.blur();
    // fixed keys: 1–6 pick a track (while recording, carry the take onto it); ⌥1–6 record on that track
    if (!mod && /^Digit[1-6]$/.test(code) && !e.shiftKey) {
      e.preventDefault(); B.lastAct = Date.now(); const ti = +code.slice(5) - 1;
      if (e.altKey) return B.rec ? switchTrackLive(ti) : recordToggle(ti);
      if (B.rec) return switchTrackLive(ti);
      if (ti < B.audio.tracks.length) { B.track = ti; renderEditBar(); renderTransport(); } else toast("Track " + (ti + 1) + " doesn't exist yet. Add it with + Track (" + kl("addTrack") + ").");
      return;
    }
    const combo = comboOf(e); if (!combo) return;
    const K = keys(), name = Object.keys(ACTIONS).find(a => K[a] === combo); if (!name) return;
    if (name === "copy" && !B.sel) return;                // nothing selected: let the browser copy text
    e.preventDefault(); B.lastAct = Date.now();
    if (e.repeat && !["bigger", "smaller", "zoomIn", "zoomOut", "nextFlag", "prevFlag", "textSmaller", "textBigger"].includes(name)) return;
    act(name);
  }

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

  // ======================= outside cast & pickups =======================
  // other readers' runs in any chapter (the same rule theirRuns uses for the open one)
  function runsIn(chap) {
    if (chap === B.chap) return theirRuns();
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
        (missing.length ? ` <b>${missing.length} line${missing.length === 1 ? "" : "s"} missing</b> from the file: Co-narrator lists them, with Mark as pickups.` : "") +
        (checks ? ` ${checks} marked “check”.` : "") + (B.audio.markers.some(m => m.slot) ? " Splice all fills your slots." : ""));
      return { n, mode, clicks, segs: segs.length, want: targets.length };
    } catch (e) { console.error(e); toast("Couldn't read that file: " + e.message); }
    finally { B.busy = null; busyNote(""); renderSide(); }
  }
  // listen to each stretch and line them up with the script: in order, skipping missed lines, keeping the last of several takes
  async function matchByWords(x, segs, targets, r) {
    const R = LRAudio.RATE, heard = [];
    for (let i = 0; i < segs.length; i++) { busyNote("Listening to " + r + "'s file… " + (i + 1) + " / " + segs.length); heard.push(LRProof.split(await LRProof.hear(x.slice(Math.round(segs[i].a * R), Math.round(segs[i].b * R)), "careful"))); }
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
        const run = theirRuns().find(x => x.r === q.to && x.from === q.w0) || theirRuns().find(x => x.r === q.to && x.text === q.text);
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
  async function playPickupReply(q) {
    const rep = Store.pickupReply(B.book, q); if (!rep) return;
    try { const d = await Store.pickupsDir(B.book, q.to); const x = await LRAudio.renderRange(d, [{ file: rep.file, off: 0, dur: rep.dur, at: 0 }], 0, rep.dur); stopLine();
      const ctx = new AudioContext({ sampleRate: LRAudio.RATE }), buf = ctx.createBuffer(1, x.length, LRAudio.RATE); buf.copyToChannel(x, 0); const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start(); B.coPlay = ctx; } catch (e) { toast(e.message); }
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
        return `<div class="pk-who"><b>${esc(r)}</b> <span class="muted">${waiting ? waiting + " waiting" : "nothing waiting"}</span>${isNarrator(r) ? "" : `<div class="fx-chips"><button class="stu-btn" data-p="pkcopy:${esc(r)}" ${waiting ? "" : "disabled"}>📋 Copy the list</button><button class="stu-btn" data-p="pkdrop:${esc(r)}" ${dis} ${waiting ? "" : "disabled"}>🎧 Drop in their pickups…</button></div>`}</div>` +
          qs.map(q => { const rep = Store.pickupReply(B.book, q), here = q.chapterId === B.chap.id, st = q.status === "in" ? "in" : rep ? "arrived" : "waiting";
            return `<div class="co-line ${st === "in" ? "placed" : st === "arrived" ? "" : "slot"}"><span class="n">${st === "in" ? "✓" : st === "arrived" ? "⬇" : "…"}</span><span>${esc(qt(short(q.text, 14)))}<br><i>${esc(q.chapter || "")} · ${st}${q.note ? " · “" + esc(short(q.note, 10)) + "”" : ""}</i></span>
              <span class="fx-chips">${rep ? `<button class="stu-btn" data-p="pkplay:${q.id}" title="Listen">▶</button>` : ""}${st === "arrived" ? (here ? `<button class="stu-btn stu-rec" data-p="pkin" ${dis}>Put in</button>` : `<button class="stu-btn" data-ci="${chIndex(q.chapterId)}" title="Open that chapter: it goes in">go</button>`) : ""}${q.status === "open" ? `<button class="stu-btn" data-p="pkcancel:${q.id}" title="Never mind">✕</button>` : ""}</span></div>`; }).join("");
      }).join("") + `</div>`;
    }
    return h;
  }

  window.Booth = { open, close, get state() { return B; }, ACTIONS, keyLabel: a => kl(a), _test: { trackSet, pkZone, heard, nextSentence, chapterComplete, mapChapter, findInBook, goHit, replaceSel, unpackOrig, proofChapter, skipLine, recutOf, swapRecut, selLine, renderLineEd, liveDrop, selectTake: (a,b) => selectTake(a,b), act, cutTakes, findPauses, evenPauses, learnTone, addSpace, drawWave,  castDrop, castPickupDrop, askPickup, applyPickups, pickupRecorder, pkForMe, pkMine, copyCastList, castPickupList, runsIn, decodeFile, theirRuns, myRuns, sendLines, bringLines, spliceAll, duetClick, checkGoals, chapterComplete, amLead, applyFx, armFx, previewFx, deleteTake, selectTake, gainSel, acxCheck, setReader, fxLast, act, keys, swapAlt, nextRecStart0, undo, redo, heard, flub, punchAt, stopRecording, startRecording, recordToggle, addMarker, clickWord, switchTrackLive, cut, copy, paste, deleteSel, splitHere, selectAll, addTrack, exportDialog, mix, len, seek, clockState } };
})();
