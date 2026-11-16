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
  async function open(bookId, ci) {
    const book = Store.byId(bookId);
    if (!book) { location.hash = "#/library"; return; }
    if (B && B.book !== book) await close();
    const me = Store.me() || (Store.settings.narrators[0] || {}).name || "Me";
    if (!B) {
      B = { book, readingAs: me, mic: new LRAudio.Mic(), player: new LRAudio.Player(), listening: false, rec: null, playhead: null,
        prerollSec: num0(localStorage.getItem("lr-preroll"), 3), follow: localStorage.getItem("lr-follow") !== "0",
        edit: false, sessions: [], session: null, peaks: {}, bRun: {}, clockPaused: false, lastAct: Date.now(),
        track: 0, sel: null, laneH: num0(localStorage.getItem("lr-laneh"), 72), undo: [], redo: [], fxOpen: {}, fxp: {} };
      let fp = {}; try { fp = JSON.parse(localStorage.getItem("lr-fxp") || "{}") || {}; } catch (e) {}
      for (const k in LRFx.KINDS) B.fxp[k] = Object.assign({}, LRFx.KINDS[k].def, fp[k] || {});
      try { B.sessions = await Store.sessions(B.readingAs, 2); } catch (e) { B.sessions = []; }
      B.tick = setInterval(tick, 1000);
      B.anchorTimer = setInterval(sampleAnchor, 200);
      document.addEventListener("keydown", onKey);
      ["pointerdown", "keydown", "wheel"].forEach(ev => document.addEventListener(ev, markActive, true));
      window.addEventListener("beforeunload", flushSession);
      window.addEventListener("hashchange", onLeave);
    }
    try { localStorage.setItem("lr-last-book", book.id); const o = JSON.parse(localStorage.getItem("lr-opened") || "{}"); o[book.id] = Date.now(); localStorage.setItem("lr-opened", JSON.stringify(o)); } catch (e) {}
    if (ci == null || isNaN(ci)) ci = firstUnfinished(book);
    await openChapter(Math.max(0, Math.min(book.chapters.length - 1, ci)));
  }
  const markActive = () => { if (B) B.lastAct = Date.now(); };
  function firstUnfinished(book) {
    const i = book.chapters.findIndex(c => c.included && !((c.prog || {})[B ? B.readingAs : Store.me()] || {}).done && myCount(book, c).mine > 0);
    return i >= 0 ? i : book.chapters.findIndex(c => c.included);
  }
  function onLeave() { if (!/^#\/booth\//.test(location.hash)) close(); }
  async function close() {
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
  async function mix() { return LRAudio.mixer(await dir(), B.audio, trackSet()); }

  async function openChapter(ci) {
    if (B.rec) await stopRecording();
    B.player.stop();
    B.ci = ci; B.chap = B.book.chapters[ci];
    B.toks = Prep.tokens(B.chap);
    B.mine = B.toks.map(t => isMine(t, B.chap));
    B.f = Prep.makeFollower(B.toks, B.mine, prog().pos || 0);
    B.audio = audioOf(B.chap);
    B.playhead = null; B.sel = null; B.selTake = null; B.view = null; B.undo = []; B.redo = []; hidePartPop();
    B.track = Math.min(B.track, B.audio.tracks.length - 1);
    bookCounts();
    B.peaks = {};
    render();
    loadPeaks();
    if (B.mine.every(m => !m)) toast("Nothing in this chapter is yours to read as " + B.readingAs + ".");
  }

  // ======================= render (Finished Hour layout) =======================
  const ICON = { rec: "●", stop: "■", play: "▶", pause: "❚❚", punch: "⤓", flag: "⚑", pin: "⌖", users: "👥", undo: "↶", redo: "↷", split: "✂", home: "⏮", end: "⏭", chevL: "‹", chevR: "›", kbd: "⌨", check: "✓", menu: "☰", dl: "⤓", reset: "↺", rows: "☰", sliders: "⚙" };
  const zoom = () => num0(localStorage.getItem("lr-tzoom"), 1);
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
      <div id="bd-side"></div>`;
    applyReadFont();
    renderEditBar(); renderManuscript(); renderTransport(); renderStats(); renderSide(); layout();
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
      g.onpointerup = () => { g.onpointermove = null; g.onpointerup = null; localStorage.setItem("lr-laneh", B.laneH); };
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
    ({ cut, copy, paste: () => paste(false), pasteOver: () => paste(true), del: deleteSel, track: nextTrack, addTrack }[a] || (() => {}))();
  }
  function barChange(e) { const t = e.target; if (t.dataset.b === "pre") { B.prerollSec = +t.value; localStorage.setItem("lr-preroll", B.prerollSec); } t.blur(); }

  function navMenu(btn) {
    const r = btn.getBoundingClientRect(), m = document.createElement("div"); m.className = "pop";
    m.style.left = r.left + "px"; m.style.top = (r.bottom + 4) + "px";
    m.innerHTML = [["#/library", "Dashboard"], ["#/book/" + B.book.id, "This book's page"], ["#/import", "+ New Project"], ["#/calc", "Tools"], ["#/settings", "Settings"]].map(([h, l]) => `<a href="${h}">${l}</a>`).join("");
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener("click", function off() { m.remove(); document.removeEventListener("click", off); }), 0);
  }
  // Every hotkey, like Finished Hour's: one table of actions, each with a default key you can change (stored per computer).
  const ACTIONS = {
    rec: ["Record · pause / resume (on the selected track)", "R"], stop: ["Stop (finish take / stop playback)", "S"], play: ["Play / stop playback (plays the selection if there is one)", "Space"],
    punch: ["Punch in at the playhead", "Shift+R"], flub: ["Flub: back to the start of the sentence, pre-roll, record", "F"],
    fxLast: ["Apply the last effect you used (to the selection, or the take at the playhead)", "E"],
    marker: ["Drop a flub marker", "M"], custom: ["Drop a named marker (goes into your WAV export)", "N"], click: ["Co-narrator: drop in their next line (arrives with duet clips)", "C"],
    undo: ["Undo", "Ctrl+Z"], redo: ["Redo", "Ctrl+Shift+Z"], cut: ["Cut selection", "Ctrl+X"], copy: ["Copy selection", "Ctrl+C"], paste: ["Paste at the playhead (insert)", "Ctrl+V"],
    pasteOver: ["Paste over (replace)", "Ctrl+Shift+V"], del: ["Delete the selection, or the selected take", "Delete"], selAll: ["Select the whole chapter", "Ctrl+A"],
    selToStart: ["Select from the playhead to the start", "Shift+Home"], selToEnd: ["Select from the playhead to the end", "Shift+End"],
    split: ["Split the take at the playhead", "B"], track: ["Next track", "T"], addTrack: ["Add a track", "Shift+T"],
    smaller: ["Shorter tracks", "["], bigger: ["Taller tracks", "]"], zoomOut: ["Zoom out (time)", "-"], zoomIn: ["Zoom in (time)", "="],
    textSmaller: ["Smaller manuscript text", "Ctrl+-"], textBigger: ["Larger manuscript text", "Ctrl+="],
    home: ["Playhead to the start", "Home"], end: ["Playhead to the end", "End"], prevFlag: ["Previous flag", ","], nextFlag: ["Next flag", "."],
    tools: ["Open / close the Tools panel", "Shift+P"], escape: ["Stop playback, clear the selection", "Escape"]
  };
  const KEY_ALIAS = { Equal: "=", Minus: "-", Comma: ",", Period: ".", BracketLeft: "[", BracketRight: "]", Space: "Space", Slash: "/", Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\" };
  let KEYS = null;
  function keys() {
    if (KEYS) return KEYS;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem("lr-keys") || "{}") || {}; } catch (e) {}
    KEYS = {}; for (const a in ACTIONS) KEYS[a] = saved[a] != null ? saved[a] : ACTIONS[a][1];
    return KEYS;
  }
  const saveKeys = () => { try { localStorage.setItem("lr-keys", JSON.stringify(KEYS)); } catch (e) {} };
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
        <p class="small muted">Click a key, then press the new combination (Esc cancels). Giving a key to a second action takes it off the first. Fixed: <b>1–6</b> select a track (while recording: carry the take onto it), <b>⌥1–6</b> record on that track.</p>
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
      if (e.target.closest("[data-reset]")) { KEYS = null; localStorage.removeItem("lr-keys"); draw(); return; }
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
      case "play": return togglePlay();
      case "punch": return punchAt(playhead());
      case "flub": return flub();
      case "fxLast": return fxLast();
      case "marker": return addMarker();
      case "custom": return customMarker();
      case "click": return toast("Co-narrator lines arrive with duet clips, the next phase of the Studio.");
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
      case "track": return nextTrack();
      case "addTrack": return addTrack();
      case "smaller": return laneSize(1 / 1.3);
      case "bigger": return laneSize(1.3);
      case "zoomOut": return setZoom(1 / 1.5);
      case "zoomIn": return setZoom(1.5);
      case "textSmaller": return textZoom(-0.1);
      case "textBigger": return textZoom(0.1);
      case "home": return seek(0);
      case "end": return seek(len());
      case "prevFlag": return jumpFlag(-1);
      case "nextFlag": return jumpFlag(1);
      case "tools": B.side = B.side === "tools" ? null : "tools"; return renderSide();
      case "escape": B.player.stop(); stopPreview(); B.sel = null; B.selTake = null; hidePartPop(); renderEditBar(); renderTransport(); return;
    }
  }
  function textZoom(d) {
    const z = Math.max(0.7, Math.min(2.2, zoom() + d)); localStorage.setItem("lr-tzoom", z.toFixed(2));
    const ms = $("#ms"); if (ms) ms.style.fontSize = (BASE_TEXT * z).toFixed(2) + "rem";
    $$(".bd-zl").forEach(x => x.textContent = Math.round(z * 100) + "%");
    markPos(true);
  }

  // ---------------- side panels: Chapters & Tools ----------------
  const TOOL_TABS = [["fx", "🎛 Effects"], ["chain", "Track sound"], ["takes", "Takes"], ["levels", "Levels & checks"], ["mic", "Mic & reading"]];
  function renderSide() {
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
        body = `<select class="stu-sel bd-tabsel" data-tab>${TOOL_TABS.map(([k, l]) => `<option value="${k}" ${tab === k ? "selected" : ""}>${l}${k === "takes" && (B.audio.alts || []).length ? " (" + B.audio.alts.length + " kept)" : ""}</option>`).join("")}</select>
          <div class="bd-toolbody">${({ fx: fxTabHtml, chain: chainTabHtml, takes: takesTabHtml, levels: levelsTabHtml, mic: micTabHtml }[tab] || fxTabHtml)()}</div>`;
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
    }
  }
  function sideChange(e) {
    const t = e.target;
    if (t.dataset.tab != null) { B.tab = t.value; renderSide(); t.blur(); return; }
    if (t.id === "b-as") return switchReader(t.value);
    if (t.dataset.pk) { const [k, f] = t.dataset.pk.split("."); B.fxp[k][f] = t.value; saveFxp(); renderSide(); return; }
    if (t.dataset.ch) { const st = trackSet()[B.fxTrack]; st.chain = LRFx.chainOf(st); const [g, f] = t.dataset.ch.split("."); if (f) st.chain[g][f] = t.type === "checkbox" ? t.checked : +t.value; else st.chain[g] = t.checked; Store.saveBook(B.book); chainChanged(); renderSide(); return; }
    if (t.dataset.pref) { Store.settings[t.dataset.pref] = t.value; Store.saveSettings(); applyReadFont(); if (t.dataset.pref === "theme") { document.documentElement.dataset.theme = t.value; B.col = null; drawWave(); } return; }
  }
  function sideInput(e) {
    const t = e.target;
    if (t.dataset.pv) { const [k, f] = t.dataset.pv.split("."); B.fxp[k][f] = +t.value; const o = t.parentNode.querySelector(".fxv"); if (o) o.textContent = fmtV(+t.value, +t.step) + (t.dataset.u || ""); saveFxp(); return; }
    if (t.dataset.ch && t.type === "range") { const o = t.parentNode.querySelector(".fxv"); if (o) o.textContent = fmtV(+t.value, +t.step) + (t.dataset.u || ""); }
  }
  const fmtV = (v, step) => (+v).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  const rng = (attr, label, min, max, step, val, unit) => `<label class="fxr"><span>${label}</span><input type="range" ${attr} min="${min}" max="${max}" step="${step}" value="${val}" data-u="${esc(unit || "")}"><b class="fxv">${fmtV(val, step)}${esc(unit || "")}</b></label>`;
  function saveFxp() { try { localStorage.setItem("lr-fxp", JSON.stringify(B.fxp)); } catch (e) {} }
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
    return `<div class="bd-sec"><b>Gain</b><div class="stu-note">Raises or lowers ${B.sel ? "the selection" : B.selTake ? "the selected take" : "a selection or take (select one first)"} on track ${B.track + 1}. Nothing is re-recorded or rewritten.</div>
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
      <div class="bd-sec"><b>Microphone</b><button class="stu-btn" data-p="mic">🎙 ${esc(B.mic.label ? B.mic.label.slice(0, 34) : "Choose microphone")}</button></div>
      <div class="bd-sec"><b>Look</b><label class="fxr"><span>Theme</span><select class="stu-sel" data-pref="theme">${[["ledger", "Ledger"], ["archive", "Archive"], ["lamp", "Lamp"], ["nocturne", "Nocturne"], ["foundry", "Foundry"], ["afterglow", "Afterglow"], ["velvet", "Velvet"], ["signal", "Signal"]].map(([k, l]) => `<option value="${k}" ${(S.theme || "ledger") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="fxr"><span>Reading font</span><select class="stu-sel" data-pref="readFont"><option value="sans" ${S.readFont !== "serif" ? "selected" : ""}>Sans (clean)</option><option value="serif" ${S.readFont === "serif" ? "selected" : ""}>Serif (book)</option></select></label>
        <div class="stu-note">Text size: A− / A+ in the bar above, ${esc(kl("textSmaller"))} / ${esc(kl("textBigger"))}, or ⌘ + scroll over the text.</div></div>
      <a class="stu-btn" href="#/book/${esc(B.book.id)}">Book page →</a>`;
  }
  async function switchReader(name) { await flushSession(); B.session = null; B.readingAs = name; try { B.sessions = await Store.sessions(B.readingAs, 2); } catch (er) { B.sessions = []; } openChapter(B.ci); }

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
    toast("🔁 Swapped the take at " + clock(al.a) + ". Swap again to go back.");
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
        B.toks = Prep.tokens(c); B.mine = B.toks.map(t => isMine(t, c)); const pos = B.f.pos; B.f = Prep.makeFollower(B.toks, B.mine, pos);
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
    markPos(true);
  }
  function markPos(scroll) {
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
      G("", bt("marker", ICON.flag + " Marker", { tip: "Flub marker (" + kl("marker") + ")" }) + bt("custom", ICON.pin + " Custom", { tip: "Named marker (" + kl("custom") + ") — goes into your WAV export" }) + bt("click", ICON.users + " Click", { tip: "Co-narrator: drop in their next line (" + kl("click") + ") — arrives with duet clips" })) +
      `<div class="bd-lcd bd-booth ${cs.on ? "" : "paused"}" data-b="clock" role="button" tabindex="0" title="Booth time on this chapter: starts the first time you press Record on it and stops when you mark the chapter complete. It keeps running when you press Stop (playing back, punching in) and pauses after ${IDLE_MIN} idle minutes. Click to ${cs.label === "booth" ? "pause" : "start"} the clock."><span class="bd-time" id="bd-booth">${clock(prog().boothSec)}</span><span class="bd-bl" id="bd-bl">${cs.label}</span></div>` +
      `<div class="bd-lcd" title="Finished time of this chapter (what you've recorded; the take in progress while recording)"><i class="bd-recdot ${rec && !rec.paused ? "on" : ""}"></i><span class="bd-bl">FH</span><span class="bd-time" id="bd-time">${clock(L)}</span><span class="stu-bar"><i id="bd-lvl"></i></span></div>` +
      `<div class="bd-lcd bd-lm" title="Raw-audio level check. Speak at narration volume: aim for the green band (peaks between −12 and −6 dB)."><button class="stu-btn ${B.lmOn ? "stu-rec" : ""}" data-b="level" ${rec ? "disabled" : ""}>🎚 ${B.lmOn ? "Level on" : "Level"}</button><span class="lm-track"><i class="lm-fill" id="lm-fill"></i><b class="lm-band"></b></span><span class="stu-chip" id="lm-msg">${B.lmOn || rec ? "Say a line…" : "Meter off"}</span></div>` +
      (B.sel ? `<span class="bd-selchip">Selected ${clock(B.sel.b - B.sel.a)}</span>` : "") +
      `<label class="bd-link" title="Start and stop follow-along together with recording"><input type="checkbox" data-b="link" ${B.follow ? "checked" : ""}> with listening</label>` +
      `<div class="bd-right">` + G("", bt("home", ICON.home, { tip: "Playhead to start (Home)", dis: rec }) + bt("end", ICON.end, { tip: "Playhead to end (End)", dis: rec })) +
        G("", bt("undo", ICON.undo, { tip: "Undo (⌘Z)", dis: rec || !B.undo.length }) + bt("redo", ICON.redo, { tip: "Redo (⌘⇧Z)", dis: rec || !B.redo.length }) + bt("split", ICON.split + " Split", { tip: "Split the take at the playhead (B)", dis: rec || !has })) +
        G("", bt("prevFlag", ICON.chevL, { tip: "Previous flag (,)", dis: rec || !flags }) + `<button class="stu-btn" data-b="flags" title="See every flag in this chapter">${ICON.flag} ${flags} flag${flags === 1 ? "" : "s"}</button>` + bt("nextFlag", ICON.chevR, { tip: "Next flag (.)", dis: rec || !flags })) +
      `</div></div>`;
    tp.onclick = dockClick;
    tp.onchange = e => { if (e.target.dataset.b === "link") { B.follow = e.target.checked; localStorage.setItem("lr-follow", B.follow ? "1" : "0"); if (!B.follow) stopListening(); else if (B.rec) startListening(); } e.target.blur(); };
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
      clock: clockClick, level: levelToggle, split: splitHere, click: () => act("click"),
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
      <span style="flex:1"></span><span class="sb-as">Reading as <b>${esc(B.readingAs)}</b></span>`;
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
    B.session = { id: Prep.uid(), person: B.readingAs, date: Prep.ymd(now), start: now.toISOString(), end: now.toISOString(),
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
      if (n) {
        ensureSession();
        const perWord = B.bookMine ? valueOfMyPart() / B.bookMine : 0;
        B.session.words += n; B.session.value += n * perWord;
        if (!B.session.chapters.includes(B.chap.id)) B.session.chapters.push(B.chap.id);
        B.counts[B.ci].done = Math.min(B.counts[B.ci].mine, B.counts[B.ci].done + n); B.bookDone += n;
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
    if (B.mic.ctx) return true;
    try { await B.mic.open(localStorage.getItem("lr-mic") || undefined); return true; }
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

  // R: on track 1 carries on from the end of the chapter; on another track records from the playhead (or the end)
  // Finished Hour's rules: R on track 1 carries on from the end of track 1 — or from the end of a take you just made
  // on another track, if that's later. On any other track, recording is a punch at the playhead.
  function nextRecStart0() {
    const base = T().trackLen(B.audio.tracks[0]), le = B.lastRecEnd, all = len();
    return (le && le.ci === B.ci && le.track > 0 && le.t > base && le.t <= all + 0.05) ? le.t : base;
  }
  async function recordToggle(onTrack) {
    if (B.rec && onTrack == null) { B.rec.paused = !B.rec.paused; if (!B.rec.paused) B.rec.lastW = null; renderTransport(); return; }
    let at = B.playhead;
    if (B.player.playing) { at = B.player.time; B.player.stop(); }
    if (onTrack != null) B.track = onTrack;
    if (B.track === 0 && onTrack == null) return startRecording(nextRecStart0(), false);
    if (B.track === 0 && !T().hasAudio(B.audio)) return startRecording(0, false);
    return startRecording(at != null ? at : (B.track === 0 ? nextRecStart0() : len()), true);
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
    B.rec = { writer, clip, file: name, paused: false, dir: d, lastW: null, start: at, track: B.track, punch: !!punched || B.track > 0, anchors: [], clipFlags: 0, lastClipT: -9 };
    B.peaks[name] = { mm: writer.mm };
    B.mic.onFrames = f => {
      const r = B && B.rec; if (!(r && r.writer === writer && !r.paused)) return;
      let hot = 0; for (let i = 0; i < f.length; i++) if (f[i] >= 0.999 || f[i] <= -0.999) hot++;
      writer.push(f); r.clip.dur = writer.duration - r.clip.off;
      // Finished Hour flagged clipping as you went
      if (hot > 1) { r.clipFlags += hot; const t = r.clip.at + r.clip.dur; if (t - r.lastClipT > 3) { r.lastClipT = t; B.audio.markers.push({ id: Prep.uid(), t, w: B.f.pos, ctx: "", note: "Clipped — too loud here", auto: true, done: false }); } }
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
    toast("🎙 Now recording on track " + (ti + 1) + (trackSet()[ti] ? " · " + trackSet()[ti].name : ""));
    renderEditBar(); renderTransport();
  }
  async function stopRecording() {
    if (!B || !B.rec) return;
    const r = B.rec; B.rec = null; B.mic.onFrames = null; document.body.classList.remove("booth-recording"); drawVoice();
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
    B.lastRecEnd = { ci: B.ci, track: r.track, t: end };
    if (r.punch && end < len() - 0.05) B.playhead = end;     // Finished Hour: after a punch the playhead sits at the end of it
    if (r.clipFlags) toast("⚠️ That take clipped (" + r.clipFlags + " samples at full scale). The spots are flagged — consider lowering the gain and re-reading them.");
    stopListening();
    renderEditBar(); renderTransport();
    if (trackSet().some(t => t && t.armed && t.armed.length)) {
      B.busy = "armed";
      try { if (await processArmed(r.file)) toast("🎛 Armed effects applied to the new take. Undo takes the take away; the dry recording is kept in your Studio folder."); }
      catch (e) { console.error(e); toast("Armed effects failed: " + e.message + ". The take is kept dry."); }
      B.busy = null; renderTransport();
    }
    Store.saveBook(B.book, true);
    flushSession();
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
    B.f.set(s); prog().pos = B.f.pos; markPos(true);
    T().truncate(B.audio, t);
    await startRecording(t, false, pre);
  }
  function addMarker(note) {
    const t = B.rec ? B.rec.clip.at + B.rec.clip.dur : (B.playhead != null ? B.playhead : len());
    const ctx = B.toks.slice(Math.max(0, B.f.pos - 5), B.f.pos + 3).map(x => x.w).join(" ");
    B.audio.markers.push({ id: Prep.uid(), t, w: B.f.pos, ctx, note: note || "", done: false });
    B.audio.markers.sort((a, b) => a.t - b.t);
    Store.saveBook(B.book);
    toast("⚑ " + (note ? note + " · " : "Marker at ") + clock(t) + " — “…" + ctx + "…”");
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
  function copy() { if (!B.sel || B.rec) return false; B.clip = B.audio.tracks.map((_, ti) => T().extract(B.audio, ti, B.sel.a, B.sel.b)); B.clipLen = B.sel.b - B.sel.a; toast("Copied " + clock(B.clipLen) + "."); renderEditBar(); return true; }
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
  function busyNote(txt) { B.busyTxt = txt; const n = $("#bd-busy"); if (n) n.textContent = txt || ""; }
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
      toast("🎛 " + list.map(e => LRFx.KINDS[e.k].name).join(" + ") + " applied. Undo brings the original back.");
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
    if (on) { st.armed.push({ k: kind, p: Object.assign({}, B.fxp[kind]) }); toast("⏻ " + LRFx.KINDS[kind].name + " armed on " + (st.name || "track " + (fxTi() + 1)) + ": new takes there get it when you press Stop."); }
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
        busyNote("Armed effects on track " + (ti + 1) + "…"); toast("🎛 Applying armed effects to the take on track " + (ti + 1) + "…");
        const nc = await processRegion(list, { ti, a: c.at, b: c.at + c.dur });
        Object.assign(c, { file: nc.file, off: 0, dur: nc.dur, fx: nc.fx, src: { file: file, off: c.off, dur: c.dur } });
        done++;
      }
    }
    busyNote("");
    return done;
  }
  function chainChanged() { if (B.player.playing) { B.playhead = B.player.time; togglePlay(true); } }
  function savePreset() {
    const st = trackSet()[fxTi()], name = (prompt("Name this voice preset (it saves the track's armed effects and track sound):", st.name || "") || "").trim(); if (!name) return;
    const ps = Store.settings.fxPresets = Store.settings.fxPresets || {};
    ps[name] = { armed: JSON.parse(JSON.stringify(st.armed || [])), chain: JSON.parse(JSON.stringify(LRFx.chainOf(st))) };
    Store.saveSettings(); renderSide(); toast("Saved the voice preset “" + name + "”.");
  }
  function loadPreset(name) {
    const pr = (Store.settings.fxPresets || {})[name]; if (!pr) return;
    const st = trackSet()[fxTi()]; st.armed = JSON.parse(JSON.stringify(pr.armed || [])); st.chain = JSON.parse(JSON.stringify(pr.chain || LRFx.CHAIN_DEFAULT()));
    Store.saveBook(B.book); chainChanged(); renderSide(); renderHeads(); toast("“" + name + "” is on " + (st.name || "track " + (fxTi() + 1)) + ".");
  }

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
    toast("🗑 Take deleted" + (shared ? " (left as silence so the other tracks stay in sync)" : "") + ". Undo brings it back.");
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
    document.body.appendChild(pop);
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, rect.left + rect.width / 2 - pop.offsetWidth / 2)) + "px";
    pop.style.top = Math.max(8, rect.top - pop.offsetHeight - 8) + "px";
    pop.onmousedown = e => e.preventDefault();
    pop.onclick = e => { const b = e.target.closest("[data-who]"); if (!b) return; const w = b.dataset.who; hidePartPop(); window.getSelection().removeAllRanges(); if (w !== "__x") setReader(from, to, w); };
  }
  function hidePartPop() { const p = $("#part-pop"); if (p) p.remove(); }
  function setReader(from, to, who) {
    const parts = B.book.parts = B.book.parts || {};
    let part = "n";
    if (who !== "__n") { part = Object.keys(parts).find(k => k !== "n" && parts[k] === who); if (!part) { part = "r:" + who; parts[part] = who; } }
    Prep.setPart(B.chap, from, to, part);
    const pos = B.f.pos; B.toks = Prep.tokens(B.chap); B.mine = B.toks.map(t => isMine(t, B.chap)); B.f = Prep.makeFollower(B.toks, B.mine, pos);
    Store.saveBook(B.book); bookCounts(); renderManuscript(); renderStats();
    toast((to - from + 1) + " word" + (to > from ? "s" : "") + " now read by " + (who === "__n" ? "the narrator" : who) + ". Select them again to change it.");
  }

  // ======================= the voice waveform over the page while you record (Finished Hour drew one too) =======================
  function drawVoice() {
    const cv = $("#voice-wave"), an = B.mic && B.mic.analyser;
    if (!cv) return;
    const on = !!(B.rec && !B.rec.paused && an);
    cv.classList.toggle("on", on); if (!on) { B.sparks = []; return; }
    const wrap = $("#ms-wrap"), r = wrap.getBoundingClientRect(), W = Math.round(Math.min(r.width, 900)), H = 220, dpr = window.devicePixelRatio || 2;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px"; }
    cv.style.left = Math.round(r.left + r.width / 2 - W / 2) + "px"; cv.style.top = Math.round(r.top + r.height * 0.72 - H / 2) + "px";
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const buf = B.vbuf = B.vbuf && B.vbuf.length === an.fftSize ? B.vbuf : new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf);
    let pk = 0, px = 0, py = H / 2; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; }
    const vol = Math.min(1, pk * 3.2), col = (getComputedStyle(document.body).getPropertyValue("--accent") || "#c9a45a").trim();
    g.lineWidth = 4; g.lineJoin = "round"; g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 8 + vol * 24; g.beginPath();
    for (let i = 0; i < buf.length; i++) {
      const x = i / (buf.length - 1) * W, edge = Math.sin(Math.PI * i / (buf.length - 1)), y = H / 2 + buf[i] * H * 1.1 * edge;   // tapered at the ends
      if (Math.abs(y - H / 2) > Math.abs(py - H / 2)) { px = x; py = y; }
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke(); g.shadowBlur = 0;
    const sp = B.sparks = B.sparks || [];
    if (vol > 0.3 && Math.random() < vol * 0.5) for (let k = 0; k < 1 + Math.floor(Math.random() * 3); k++) sp.push({ x: px + (Math.random() - .5) * 30, y: py + (Math.random() - .5) * 20, vx: (Math.random() - .5) * 3, vy: -Math.random() * 2.2 - .4, life: 1, d: .02 + Math.random() * .025, s: 1.5 + Math.random() * 2.5 });
    for (let k = sp.length - 1; k >= 0; k--) { const q = sp[k]; q.x += q.vx; q.y += q.vy; q.vy += .02; q.life -= q.d; if (q.life <= 0) { sp.splice(k, 1); continue; } g.globalAlpha = q.life; g.fillStyle = col; g.beginPath(); g.arc(q.x, q.y, q.s, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  }

  // ======================= waveform: a zoomed window that follows the head, one lane per track =======================
  async function loadPeaks() {
    if (!T().hasAudio(B.audio) || (await Store.studioStatus()) !== "ready") { drawWave(); return; }
    const d = await dir();
    for (const tr of B.audio.tracks) for (const c of tr.clips) if (!B.peaks[c.file]) { const p = await LRAudio.loadPeaks(d, c); if (p) B.peaks[c.file] = p; }
    drawWave();
  }
  const view = () => B.view || (B.view = { t0: 0, pps: num0(localStorage.getItem("lr-pps"), 40) });
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
        if (LH >= 30 && xb - xa > 46) { g.fillStyle = "rgba(255,255,255,.55)"; g.font = "10px system-ui"; g.fillText(live ? "● Recording" : (c.fx ? "🎛 " : "") + "Take " + (ci + 1) + (c.g ? "  " + (c.g > 0 ? "+" : "") + c.g + " dB" : ""), Math.max(xa, 0) + 6, top + 10); }
      });
      g.restore();
    });
    if (B.sel) { const xa = X(B.sel.a), xb = X(B.sel.b); g.fillStyle = "rgba(245,236,214,.16)"; g.fillRect(xa, RULER, xb - xa, H - RULER); g.fillStyle = "rgba(245,236,214,.7)"; g.fillRect(xa, RULER, 1, H - RULER); g.fillRect(xb - 1, RULER, 1, H - RULER); }
    if (B.ghost) { const gx = X(B.ghost.at), gw = B.ghost.dur * pps, top = RULER + B.ghost.ti * LH; g.strokeStyle = "rgba(245,236,214,.9)"; g.setLineDash([4, 3]); g.strokeRect(gx, top + 1, gw, LH - 2); g.setLineDash([]); }
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
    cv.onpointerdown = e => {
      if (!B || B.rec) return;
      const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t), inStrip = (p.y - RULER) % p.LH < 16;
      cv.setPointerCapture(e.pointerId);
      if (ci >= 0 && (inStrip || e.altKey)) {
        const c = B.audio.tracks[p.ti].clips[ci];
        B.dragging = { kind: "move", ti: p.ti, ci, grab: p.t - c.at, x0: e.clientX };
        B.ghost = { at: c.at, ti: p.ti, dur: c.dur };
      } else B.dragging = { kind: "sel", a: p.t, x0: e.clientX, ti: p.ti };
      drawWave();
    };
    cv.onpointermove = e => {
      const d = B && B.dragging; if (!d) { if (B && !B.rec) { const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t); cv.style.cursor = ci >= 0 && ((p.y - RULER) % p.LH < 16 || e.altKey) ? "grab" : "crosshair"; } return; }
      const p = pos(e);
      if (d.kind === "move") { B.ghost.at = Math.max(0, p.t - d.grab); B.ghost.ti = p.ti; cv.style.cursor = "grabbing"; }
      else if (Math.abs(e.clientX - d.x0) > 3) { B.selTake = null; B.sel = { a: Math.max(0, Math.min(d.a, p.t)), b: Math.min(len(), Math.max(d.a, p.t)) }; }
      drawWave();
    };
    cv.onpointerup = e => {
      const d = B && B.dragging; if (!d) return; B.dragging = null;
      const p = pos(e);
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
    cv.onwheel = e => { e.preventDefault(); if (e.ctrlKey || e.metaKey) { setZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2); return; } const v = view(); v.t0 = Math.max(0, v.t0 + (e.deltaX || e.deltaY) / v.pps); B.dragging = null; drawWave(); };
  }
  function animate() {
    if (!B) return;
    drawWave(); drawVoice();
    const tt = $("#bd-time"); if (tt) tt.textContent = clock(B.rec ? B.rec.clip.at + B.rec.clip.dur : B.player.playing ? B.player.time : len());
    meters();
    if (B.rec || B.player.playing) B.raf = requestAnimationFrame(animate); else B.raf = null;
  }
  function meters() {
    const db = B.mic.ctx ? B.mic.level : -90, pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100)), cls = db > -3 ? "hot" : db > -12 ? "ok" : "";
    const lv = $("#bd-lvl"); if (lv) { lv.style.width = pct + "%"; lv.className = cls; }
    const lf = $("#lm-fill"); if (lf) { lf.style.width = (B.lmOn || B.rec ? pct : 0) + "%"; lf.className = "lm-fill " + cls; }
    const lm = $("#lm-msg"); if (lm && (B.lmOn || B.rec)) { const h = B.mic.peakHold; lm.textContent = B.mic.clip ? "Clipping — lower the gain" : h < -40 ? "Say a line…" : h > -3 ? "Too hot" : h > -12 ? "Good level" : "Too quiet"; if (Date.now() - (B.lmT || 0) > 2500) { B.mic.peakHold = -90; B.mic.clip = false; B.lmT = Date.now(); } }
  }
  function startAnim() { if (B && !B.raf) B.raf = requestAnimationFrame(animate); }
  function setZoom(f) { const v = view(); v.pps = Math.max(2, Math.min(400, v.pps * f)); localStorage.setItem("lr-pps", v.pps.toFixed(1)); drawWave(); }
  function laneSize(f) { B.laneH = Math.max(34, Math.min(200, Math.round(B.laneH * f))); localStorage.setItem("lr-laneh", B.laneH); renderTransport(); }
  function setHint(s) { const h = $(`.trk-head[data-t="${B.track}"] .th-sub`); if (h) h.textContent = s; }

  // ======================= export =======================
  function exportDialog(afterComplete) {
    if (B.rec) return;
    const S = Store.settings, pat = S.namePattern || "{book} - {nn} - {chapter}";
    const st = B.exp = B.exp || { fmt: localStorage.getItem("lr-xfmt") || "wav", dest: "folder" };
    const ov = document.createElement("div"); ov.className = "overlay";
    const draw = () => {
      const base = LRExport.fileName(st.pat || pat, B.book, B.chap, B.ci), ext = st.fmt === "mp3" ? ".mp3" : ".wav";
      ov.innerHTML = `<div class="card reader" style="max-width:600px"><h2>⤓ Export ${esc(B.chap.title)}</h2>
        <div class="xfmt">${[["wav", "WAV · 44.1 kHz, 16-bit", "ACX-ready delivery"], ["mp3", "MP3 · 192 kbps, 44.1 kHz", "ACX-ready delivery"], ["raw", "Raw WAV · 48 kHz, 24-bit", "Untouched, for Auphonic or your editor"]]
          .map(([k, l, s]) => `<button class="xopt ${st.fmt === k ? "on" : ""}" data-f="${k}"><b>${l}</b><span>${s}</span></button>`).join("")}</div>
        <label style="display:flex;margin-top:12px">File name<input id="xname" value="${esc(base)}"></label>
        <label style="display:flex;margin-top:8px">Naming pattern<input id="xpat" value="${esc(st.pat || pat)}"></label>
        <p class="small muted">{book} {chapter} {title} {n} {nn} {nnn}. ${B.audio.tracks.length > 1 ? "All audible tracks are mixed down at their volumes. " : ""}${st.fmt !== "mp3" && B.audio.markers.some(m => m.note) ? "Named markers are written into the WAV." : ""}</p>
        <div class="row" style="margin-top:6px"><label class="check"><input type="radio" name="xd" value="folder" ${st.dest === "folder" ? "checked" : ""}> The book's exports folder</label><label class="check"><input type="radio" name="xd" value="choose" ${st.dest === "choose" ? "checked" : ""}> Choose where to save…</label></div>
        <div id="xprog" class="bar hidden" style="margin-top:12px"><i style="width:0;background:var(--accent)"></i></div>
        <div class="row" style="margin-top:12px"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" id="xgo">Export ${esc(ext.slice(1).toUpperCase())}</button></div></div>`;
      $$("[data-f]", ov).forEach(b => b.onclick = () => { st.fmt = b.dataset.f; localStorage.setItem("lr-xfmt", st.fmt); draw(); });
      $("#xpat", ov).onchange = e => { st.pat = e.target.value; Store.settings.namePattern = e.target.value; Store.saveSettings(); draw(); };
      $$("[name=xd]", ov).forEach(r => r.onchange = () => { st.dest = r.value; });
      $("[data-x]", ov).onclick = () => ov.remove();
      $("#xgo", ov).onclick = () => go($("#xname", ov).value.trim() || base, ext);
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
        await LRExport.exportChapter(await mix(), len(), st.fmt, fh, B.audio.markers, p => { fill.style.width = Math.round(p * 100) + "%"; });
        B.chap.exportedAt = new Date().toISOString();
        const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"];
        if (order.indexOf(B.chap.status) < 2) B.chap.status = "edited";
        Store.saveBook(B.book, true);
        ov.remove(); toast("Exported " + name + (st.dest === "folder" ? " to the book's exports folder." : "."));
      } catch (e) { toast("Export failed: " + e.message); $("#xgo", ov).disabled = false; $("#xgo", ov).textContent = "Try again"; }
    };
    draw(); document.body.appendChild(ov);
  }

  // ======================= chapter complete =======================
  function chapterComplete(manual) {
    const p = prog();
    if (p.done && !manual) return;
    p.done = true; p.readTo = Math.max(p.readTo, B.toks.length);
    delete B.bRun[B.ci];                         // Finished Hour: marking the chapter complete stops its booth clock
    const readers = Object.keys(Prep.wordsByReader(B.chap, B.book)).filter(r => r !== "?");
    const allDone = !readers.length || readers.every(r => ((B.chap.prog || {})[r] || {}).done);
    const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"];
    if (allDone && order.indexOf(B.chap.status) < 1) B.chap.status = "recorded";
    Store.saveBook(B.book, true); bookCounts();
    const finish = async () => {
      if (B.rec) await stopRecording();
      cheer("chapterRecorded");
      const next = B.book.chapters.findIndex((c, i) => i > B.ci && c.included && myCount(B.book, c).mine > 0);
      const has = T().hasAudio(B.audio);
      const ov = document.createElement("div"); ov.className = "overlay";
      ov.innerHTML = `<div class="card reader" style="max-width:480px;text-align:center"><div style="font-size:2.2rem">🎉</div><h2>${esc(B.chap.title)} is done!</h2>
        <p class="muted">${!allDone ? "Your part is done. It's marked Recorded once every reader has finished theirs. " : ""}${has ? (B.chap.exportedAt ? "You've already exported this one. Export again if you changed anything." : "Export it now while it's fresh, or move on and export later.") : ""}</p>
        <div class="row" style="justify-content:center">${has ? `<button class="btn primary" data-exp>Export this chapter</button>` : ""}${next >= 0 ? `<button class="btn" data-next>Next chapter →</button>` : ""}<button class="btn quiet" data-stay>Stay here</button></div></div>`;
      document.body.appendChild(ov);
      $("[data-stay]", ov).onclick = () => { ov.remove(); render(); };
      const nb = $("[data-next]", ov); if (nb) nb.onclick = () => { ov.remove(); openChapter(next); };
      const xb = $("[data-exp]", ov); if (xb) xb.onclick = () => { ov.remove(); render(); exportDialog(true); };
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

  window.Booth = { open, close, get state() { return B; }, _test: { applyFx, armFx, previewFx, deleteTake, selectTake, gainSel, acxCheck, setReader, fxLast, act, keys, swapAlt, nextRecStart0, undo, redo, heard, flub, punchAt, stopRecording, startRecording, recordToggle, addMarker, clickWord, switchTrackLive, cut, copy, paste, deleteSel, splitHere, selectAll, addTrack, exportDialog, mix, len, seek, clockState } };
})();
