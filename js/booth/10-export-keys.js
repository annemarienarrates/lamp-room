/* booth/10-export-keys.js — Export, chapter complete, and keys.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ======================= export =======================
  function exportDialog(afterComplete) {
    if (B.rec) return;
    const S = Store.settings, pat = (window.LRCredits && LRCredits.pattern(B.book)) || (S.namePattern && S.namePattern !== "{book} - {nn} - {chapter}" ? S.namePattern : "{seq}_{name}");
    const toShared = !!B.expShared; B.expShared = false;
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
        <div class="row" style="margin-top:6px"><label class="check"><input type="radio" name="xd" value="folder" ${st.dest === "folder" ? "checked" : ""}> Your exports folder for this book (Studio ▸ book ▸ exports ▸ ${esc(safeName(B.readingAs || Store.me() || "Me"))})</label><label class="check"><input type="radio" name="xd" value="choose" ${st.dest === "choose" ? "checked" : ""}> Choose where to save…</label></div>
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
        if (toShared) { const fd = await Store.sharedFinishedDir(B.book); if (!fd) throw new Error("Connect this computer to the shared folder first."); fh = await fd.getFileHandle(name, { create: true }); }
        else if (st.dest === "choose" && window.showSaveFilePicker) fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext === ".mp3" ? "MP3 audio" : "WAV audio", accept: ext === ".mp3" ? { "audio/mpeg": [".mp3"] } : { "audio/wav": [".wav"] } }] });
        else { const bd = await Store.studio.getDirectoryHandle(B.book.folder, { create: true }); const xd = await (await bd.getDirectoryHandle("exports", { create: true })).getDirectoryHandle(safeName(B.readingAs || Store.me() || "Me"), { create: true }); fh = await xd.getFileHandle(name, { create: true }); }
      } catch (e) { if (e.name !== "AbortError") toast(e.message); return; }
      const bar = $("#xprog", ov), fill = $("#xprog i", ov); bar.classList.remove("hidden"); $("#xgo", ov).disabled = true; $("#xgo", ov).textContent = "Exporting…";
      try {
        await LRExport.exportChapter(await mix(), len() + (B.audio.pad || 0), st.fmt, fh, B.audio.markers, p => { fill.style.width = Math.round(p * 100) + "%"; });
        B.chap.exportedAt = new Date().toISOString();
        const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"];
        if (order.indexOf(B.chap.status) < 2) B.chap.status = "edited";
        Store.saveBook(B.book, true);
        ov.remove(); notice("Exported " + name + (toShared ? " to the shared Finished folder." : st.dest === "folder" ? " to your exports folder for this book (Studio ▸ " + B.book.folder + " ▸ exports ▸ " + safeName(B.readingAs || Store.me() || "Me") + ")." : "."));
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
      const has = T().hasAudio(B.audio), sendable = has && !B.book.shared && !amLead() && myRuns().length > 0, shSend = has && B.book.shared && !isEditor() && !(B.chap.sent && B.chap.sent[Store.me() || B.readingAs]);
      const ov = document.createElement("div"); ov.className = "overlay";
      ov.innerHTML = `<div class="card reader" style="max-width:480px;text-align:center"><div style="font-size:2.2rem">🎉</div><h2>${esc(B.chap.title)} is done!</h2>
        <p class="muted">${!allDone ? "Your part is done. It's marked Recorded once every reader has finished theirs. " : ""}${has ? (B.chap.exportedAt ? "You've already exported this one. Export again if you changed anything." : "Export it now while it's fresh, or move on and export later.") : ""}</p>
        ${sendable ? `<p class="small" style="margin:4px 0 10px">You're co-narrating: send your lines to ${esc(Prep.readerOf("n", B.chap, B.book) || "the lead")} so they drop into the chapter.</p>` : ""}
        ${shSend ? `<p class="small" style="margin:4px 0 10px"><b>Export</b> saves it to your own Studio folder, as usual. <b>Send to Editor</b> puts your tracks in the book's shared folder for the editor; after that this chapter stays as sent, and any changes come back to you as pickups. You can do both, or send later from Tools ▸ 📦 Shared.</p>` : ""}
        <div class="row" style="justify-content:center">${has ? `<button class="btn ${sendable ? "" : "primary"}" data-exp>Export this chapter</button>` : ""}${shSend ? `<button class="btn" data-shs>📤 Send to Editor</button>` : ""}${sendable ? `<button class="btn primary" data-send>📤 Send my lines</button>` : ""}${next >= 0 ? `<button class="btn" data-next>Next chapter →</button>` : ""}<button class="btn quiet" data-stay>Stay here</button></div></div>`;
      document.body.appendChild(ov);
      $("[data-stay]", ov).onclick = () => { ov.remove(); render(); };
      const nb = $("[data-next]", ov); if (nb) nb.onclick = () => { ov.remove(); openChapter(next); };
      const xb = $("[data-exp]", ov); if (xb) xb.onclick = () => { ov.remove(); render(); exportDialog(true); };
      const ss = $("[data-shs]", ov); if (ss) ss.onclick = async () => { ss.disabled = true; ss.textContent = "Sending…"; ss.textContent = (await sendToShared(true)) ? "Sent ✓" : "Not sent"; };
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

