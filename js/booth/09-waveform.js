/* booth/09-waveform.js — The waveform: zoomed window, lanes, mouse.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
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
  // lane geometry: each track is B.laneH tall, or a thin strip when it's collapsed
  const COLLAPSED_H = 16;
  function laneHs() { const ts = trackSet(); return B.audio.tracks.map((_, i) => (ts[i] || {}).collapsed ? COLLAPSED_H : B.laneH); }
  function laneTop(i, hs) { hs = hs || laneHs(); let y = RULER; for (let k = 0; k < i; k++) y += hs[k]; return y; }
  function laneAt(y, hs) { hs = hs || laneHs(); let top = RULER; for (let k = 0; k < hs.length; k++) { if (y < top + hs[k]) return k; top += hs[k]; } return hs.length - 1; }
  const lanesH = () => laneHs().reduce((a, b) => a + b, 0);
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
    const v = view(), t0 = v.t0, pps = v.pps, X = t => (t - t0) * pps, n = B.audio.tracks.length, HS = laneHs(), C = colors();
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
      const LH = HS[ti], top = laneTop(ti, HS), mid = top + LH / 2, amp = LH / 2 * 0.88, st = ts[ti] || {}, audible = !st.mute && (!solo || st.solo);
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
    if (B.ghost) { const gx = X(B.ghost.at), gw = B.ghost.dur * pps, top = laneTop(B.ghost.ti, HS), LH = HS[B.ghost.ti]; g.strokeStyle = "rgba(245,236,214,.9)"; g.setLineDash([4, 3]); g.strokeRect(gx, top + 1, gw, LH - 2); g.setLineDash([]);
      if (B.ghost.mode) { g.fillStyle = B.ghost.mode === "snap" ? "rgba(90,200,190,.25)" : "rgba(255,190,90,.22)"; g.fillRect(gx, top + 1, gw, LH - 2); g.fillStyle = "#fff"; g.font = "11px system-ui"; g.fillText(B.ghost.mode === "snap" ? "👥 drops into this pause" : B.ghost.mode === "move" ? "👥 slides the line (nothing else moves)" : "👥 opens space here", Math.max(4, gx + 6), top + 14); } }
    if (B.trimView) { const tv = B.trimView, xa = X(tv.a), xb = X(tv.b);
      g.fillStyle = tv.open ? "rgba(70,200,190,.32)" : "rgba(229,71,59,.35)";
      for (const ln of tv.lanes) g.fillRect(Math.min(xa, xb), laneTop(ln, HS), Math.max(2, Math.abs(xb - xa)), HS[ln]);
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
    const pos = e => { const r = cv.getBoundingClientRect(), v = view(), hs = laneHs(); const y = e.clientY - r.top, ti = laneAt(y, hs); return { t: v.t0 + (e.clientX - r.left) / v.pps, ti, y, LH: hs[ti], ly: y - laneTop(ti, hs) }; };
    // what's under the pointer: a fade dot, a clip edge, or nothing special
    const hitTest = e => {
      const r = cv.getBoundingClientRect(), v = view(), hs = laneHs(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (y < RULER) return null;
      const ti = laneAt(y, hs), LH = hs[ti], top = laneTop(ti, hs), clips = B.audio.tracks[ti].clips, X = t => (t - v.t0) * v.pps;
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
      const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t), inStrip = p.ly < 16, h = hitTest(e);
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
      const d = B && B.dragging; if (!d) { if (B && !B.rec) { const p = pos(e), ci = T().clipAt(B.audio, p.ti, p.t), h = hitTest(e); cv.style.cursor = h ? (h.kind === "fade" ? "grab" : "ew-resize") : ci >= 0 && (p.ly < 16 || e.altKey) ? "grab" : "crosshair"; } return; }
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

