/* booth/03-record.js — The chapter clock, follow-along and recording.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
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
      if (inf.rate && inf.rate !== LRAudio.RATE && !B.rateWarned) { B.rateWarned = true; toast("🎤 Your microphone is running at " + (inf.rate / 1000) + " kHz. For the cleanest takes, " + LRPlat.rateHelp() + "."); }
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
