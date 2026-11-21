/* booth/01-render.js — Drawing the Booth (Finished Hour layout) and the partner-line editor.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= render (Finished Hour layout) =======================
  const ICON = { rec: "●", stop: "■", play: "▶", pause: "❚❚", punch: "⤓", flag: "⚑", pin: "⌖", users: "👥", undo: "↶", redo: "↷", split: "✂", home: "⏮", end: "⏭", chevL: "‹", chevR: "›", kbd: "⌨", check: "✓", menu: "☰", dl: "⤓", reset: "↺", rows: "☰", sliders: "⚙" };
  const zoom = () => num0(Store.lsGet("lr-tzoom"), 1);
  function render() {
    document.body.classList.add("booth-on");
    const c = B.chap;
    $("#main").innerHTML = `
      <div id="booth-editbar" class="bbar"></div>
      <div id="stats-bar" class="bbar"></div>
      <div id="ms-wrap"><div id="cue-win" class="hidden"></div><div id="ms-page"><div class="ms-head"><span class="ms-book">${esc(B.book.title)}</span>${c.pov ? `<span class="ms-pov">${esc(c.pov)}'s POV</span>` : ""}</div>
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
      <div class="bd-grp">${bt("readHere", ICON.dl + " Read from here", { dis: rec, tip: "Move your reading position to the start of this chapter" })}${bt("resetCh", ICON.reset + " Reset " + chLabel(), { dis: rec, tip: "Clear read marks, booth time and completion on this chapter (recordings are kept)" })}</div>
      <label class="bd-fld" title="How much of the lead-in plays before a punch-in starts recording"><span>Pre-roll</span><select class="stu-sel" data-b="pre">${[0, 1, 2, 3, 4, 5, 8, 10, 15, 20, 30].map(v => `<option value="${v}" ${v === B.prerollSec ? "selected" : ""}>${v ? v + " s" : "Off"}</option>`).join("")}</select></label>
      <span style="flex:1"></span>
      ${bt("chDone", ICON.check + " " + (done ? "Completed · reopen" : "Mark " + chLabel() + " complete"), { cls: done ? "" : "bd-done", dis: rec, tip: done ? "This chapter is marked complete. Click to reopen it." : "Mark this chapter complete: stops its booth clock and offers to export it" })}
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
    if (a === "resetCh") { if (!confirm(`Clear read marks, booth time and completion on ${chLabel()} for ${B.readingAs}? Recordings are kept.`)) return; B.chap.prog[B.readingAs] = { pos: 0, readTo: 0, done: false, boothSec: 0 }; delete B.bRun[B.ci]; Store.saveBook(B.book); openChapter(B.ci); return; }
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
    marker: ["Drop a flub marker", "M"], custom: ["Drop a named marker (goes into your WAV export)", "N"], click: ["Collaborate: drop their next line in now (or mark a slot if it hasn't arrived; not recording: at the playhead)", "C"],
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
  const LOCK_EDITS = new Set(["rec", "punch", "flub", "fxLast", "cut", "paste", "pasteOver", "del", "split", "addSpace", "addTrack", "nudgeL", "nudgeR", "click", "undo", "redo"]);
  function act(name) {
    const playhead = () => B.playhead != null ? B.playhead : len();
    if (LOCK_EDITS.has(name) && lockedHere()) { lockNote(); return; }
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

