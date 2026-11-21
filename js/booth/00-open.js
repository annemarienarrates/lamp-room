/* booth/00-open.js — Shared helpers and state; opening and closing the Booth; the chapter & tracks model.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
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
    if (book.shared && book.sharedOwner !== Store.me()) { try { if (await Store.refreshFromShared(book)) toast("📦 " + (book.sharedOwner || "The owner") + " updated the book's text; it's in."); } catch (e) { } }
    if (book.shared) { try { if (await Store.sharedHandle(book)) await Store.loadPickups(book); } catch (e) { } }
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
  async function close() { try { stopLine(); stopSample(); } catch (e) {} { const le = document.getElementById("line-ed"); if (le) le.remove(); const fn = document.getElementById("fnext"); if (fn) fn.remove(); }
    if (!B) return;
    if (B.rec) await stopRecording();
    stopListening(); B.player.stop(); stopPreview(); hidePartPop(); B.mic.close();
    clearInterval(B.tick); clearInterval(B.anchorTimer);
    document.removeEventListener("keydown", onKey);
    ["pointerdown", "keydown", "wheel"].forEach(ev => document.removeEventListener(ev, markActive, true));
    window.removeEventListener("beforeunload", flushSession);
    window.removeEventListener("hashchange", onLeave);
    try { if (Store._timers[B.book.id]) await Store.saveBook(B.book, true); } catch (e) {}   // leave nothing unsaved behind
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
  // the chapter's own name for buttons ("Chapter 3", "Opening Credits"), never its place in the file list
  const safeName = n => String(n || "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "Me";
  function chLabel() { const t = String((B && B.chap && B.chap.title) || "").split(/[:—–]/)[0].trim() || "this chapter"; return t.length > 22 ? t.slice(0, 21) + "…" : t; }
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
    if (amLead() && !isEditor() && theirRuns().length) setTimeout(async () => { if (B && B.ci === ci) { await bringLines(null, true).catch(() => {}); if (B && B.ci === ci) applyPickups(true).catch(() => {}); } }, 400);
    if (pkForMe().some(q => !Store.pickupReply(B.book, q)) && !B.pkTold) { B.pkTold = true; const n = pkForMe().filter(q => !Store.pickupReply(B.book, q)).length; const who = pkForMe()[0].asker; setTimeout(() => { if (B) toast("🔁 " + who + " asked you for " + n + " pickup" + (n === 1 ? "" : "s") + " in this book. Tools ▸ Pickups."); }, 900); }
    if (B.mine.every(m => !m) && !(B.book.shared && isEditor()) && !B.assembling) toast("Nothing in this chapter is yours to read as " + B.readingAs + ".");
  }

