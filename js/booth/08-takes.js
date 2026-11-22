/* booth/08-takes.js — Pickup zones; takes, gain & checks; who reads what; the voice waveform over the page.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
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
  // who read the words a flag sits in (the editor sends the pickup to them)
  function whoRead(m) { const sw = pkSentence(m); if (!sw) return null; const t = B.toks[sw.s]; return t && t.part && t.part !== "n" ? (B.book.parts || {})[t.part] || null : Prep.readerOf("n", B.chap, B.book); }
  const pkAsked = m => pkMine().find(q => q.mark === m.id && q.status !== "cancelled");
  async function pickupAsk(id) {
    const m = B.audio.markers.find(x => x.id === id); if (!m) return; const who = whoRead(m); if (!who) { toast("Couldn't tell who read that."); return; }
    if (!m.zone) await pkSnap(m);
    const sw = pkSentence(m), list = pkMine().map(q => Object.assign({}, q)), text = sw ? B.toks.slice(sw.s, sw.e + 1).map(t => t.w).join(" ") : (m.ctx || "");
    const note = prompt("Note for " + who + " (optional):", m.note && m.note !== "Flub" ? m.note : "");
    if (note === null) return;
    list.push({ id: Prep.uid(), to: who, r: who, chapterId: B.chap.id, chapter: B.chap.title, w0: sw ? sw.s : null, w1: sw ? sw.e : null, text, ctx: sw ? B.toks.slice(Math.max(0, sw.s - 12), sw.s).map(t => t.w).join(" ") : "", note, mark: m.id, made: new Date().toISOString(), status: "open" });
    await saveMine(list); Store.saveBook(B.book); renderSide(); notice("🔁 Asked " + who + " for that pickup. When they send it, it goes back into this red zone.");
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
    const leadHere = Store.isLead(B.book), leadName = Store.leadOf(B.book);
    if (leadHere) pop.innerHTML = `<div class="pp-q">Who reads <i>“${esc(txt)}”</i>?</div><div class="fx-chips">${readersForPop().map(n => `<button class="stu-btn ${n === B.readingAs ? "stu-rec" : ""}" data-who="${esc(n)}">${esc(n)}${n === B.readingAs ? " (me)" : ""}</button>`).join("")}<button class="stu-btn" data-who="__n" title="Narration: read by whoever narrates this chapter">Narration</button><button class="stu-btn" data-who="__x">✕</button></div>`;
    else pop.innerHTML = `<div class="pp-q">Wrong reader for <i>“${esc(txt)}”</i>?</div><div class="fx-chips"><button class="stu-btn" data-asklead>Ask ${esc(leadName)} to fix it</button></div>`;
    const run = theirRuns().find(x => from >= x.from && to <= x.to);
    if (run && amLead()) pop.insertAdjacentHTML("beforeend", `<div class="fx-chips" style="margin-top:6px"><button class="stu-btn" data-ask="1">🔁 Ask ${esc(nm(run.r))} for a pickup of this line</button></div>`);
    const nm = words.map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, "").replace(/['’]s$/, "")).join(" ").trim();
    if (words.length <= 4 && nm) { const known = charFind(nm); pop.insertAdjacentHTML("beforeend", `<div class="fx-chips" style="margin-top:6px"><button class="stu-btn" data-char="${esc(nm)}">🎭 ${known ? "Open " + esc(known.name) + "'s card" : "Add “" + esc(nm) + "” to my characters"}</button></div>`); }
    document.body.appendChild(pop);
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, rect.left + rect.width / 2 - pop.offsetWidth / 2)) + "px";
    pop.style.top = Math.max(8, rect.top - pop.offsetHeight - 8) + "px";
    pop.onmousedown = e => e.preventDefault();
    pop.onclick = e => { if (e.target.closest("[data-asklead]")) { hidePartPop(); window.getSelection().removeAllRanges(); window.LRAskLead && LRAskLead(B.book, leadName, B.ci, "“" + txt + "” should be read by "); return; } const cb = e.target.closest("[data-char]"); if (cb) { hidePartPop(); window.getSelection().removeAllRanges(); charAddOrOpen(cb.dataset.char); return; } if (e.target.closest("[data-ask]")) { hidePartPop(); window.getSelection().removeAllRanges(); askPickupPrompt(run); return; } const b = e.target.closest("[data-who]"); if (!b) return; const w = b.dataset.who; hidePartPop(); window.getSelection().removeAllRanges(); if (w !== "__x") setReader(from, to, w); };
  }
  function hidePartPop() { const p = $("#part-pop"); if (p) p.remove(); }
  function setReader(from, to, who) {
    const parts = B.book.parts = B.book.parts || {};
    let part = "n";
    if (who !== "__n") { part = Object.keys(parts).find(k => k !== "n" && parts[k] === who); if (!part) { part = "r:" + who; parts[part] = who; } }
    Prep.setPart(B.chap, from, to, part);
    const pos = B.f.pos; B.toks = Prep.tokens(B.chap); B.mine = B.toks.map(t => isMine(t, B.chap)); B.f = Prep.makeFollower(B.toks, B.mine, pos); B.f.setManual(pacerManual());
    // stay where you are on the page (R, or recording, brings you back to your line)
    const wrap = $("#ms-wrap"), top = wrap ? wrap.scrollTop : 0;
    Store.saveBook(B.book); bookCounts(); B.holdScroll = true; try { renderManuscript(); } finally { B.holdScroll = false; } if (wrap) wrap.scrollTop = top; renderStats();
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


