/* The Lamp Room — celebrations.
   · celebrate({ title, sub, level, color, live }) — huge glowing words that scale up in the middle of the screen, a spark
     burst behind them and confetti from both bottom corners. level 1 = a moment, 2 = a goal or a chapter, 3 = a whole book.
     Anything that isn't marked live waits while you're recording and plays the moment you press Stop.
   · Combo meter (Finished Hour's): every 100 of your own words without a long break raises the combo a level, through
     twenty named tiers; each level-up flashes its name, and from Overdrive up the screen joins in.
   · cheer(kind) and toast(msg) as before.
   Settings: celebrations, combo, confetti, calm (keep the words, drop the effects), encouragement (the small lines). */
(function () {
  "use strict";
  const LINES = {
    bookCreated: ["New book on the ledger. The lamp is lit.", "Manuscript in. Chapters counted. The fun part starts now.", "Another world to give a voice to."],
    chapterRecorded: ["Chapter in the can.", "That's a chapter. Water, then the next.", "Recorded. The voice lives to read another day."],
    chapterDone: ["Chapter delivered. One less voice in your head.", "That one's out the door.", "Delivered. Pour something.", "Another chapter carried across the threshold."],
    bookDone: ["Every chapter delivered. That's a whole book.", "The book is finished. Go outside. Briefly.", "Final chapter delivered. The ledger closes on this one."]
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const S = () => (window.Store && Store.settings) || {};
  const on = k => S()[k] !== false;
  const calm = () => !!S().calm || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const recording = () => !!(window.Booth && Booth.state && Booth.state.rec);
  const cssv = k => getComputedStyle(document.body).getPropertyValue(k).trim();

  // Notices. Warnings always show. Anything else that turns up while you're recording waits until you stop.
  // Confirmations ("copied", "fades set", "lines spliced"…) go through note(), and only show if you've switched them on.
  const WARN = /^(⚠|🎤)|couldn't|failed|isn't|is off|need|clipp|glitch|microphone|blocked|not available|limit/i;
  let held = [];
  function toast(msg, force) {
    if (!force && recording() && !WARN.test(msg)) { if (!held.includes(msg)) held.push(msg); return; }
    showToast(msg);
  }
  function note(msg) { if (S().confirmations !== true) return; toast(msg); }
  function flushNotes() { const h = held.slice(-3); held = []; h.forEach((m, i) => setTimeout(() => showToast(m), i * 350)); }
  function showToast(msg) {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add("out"), 3600);
    setTimeout(() => t.remove(), 4200);
  }

  // ---------- one canvas for sparks, lightning, stars and the rainbow ----------
  let cv, g, parts = [], bolts = [], stars = [], arcs = [], raf = 0;
  function layer() {
    if (!cv) { cv = document.createElement("canvas"); cv.id = "cele-fx"; document.body.appendChild(cv); g = cv.getContext("2d"); }
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(innerWidth * dpr)) { cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0; if (!g) return;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.vy = p.vy * 0.985 + p.grav; p.life -= p.d;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, p.life * 1.4); g.fillStyle = p.c; g.shadowColor = p.c; g.shadowBlur = 12;
      g.beginPath(); g.arc(p.x, p.y, p.s * (0.5 + p.life / 2), 0, 7); g.fill();
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.life -= 0.035; if (b.life <= 0) { bolts.splice(i, 1); continue; }
      const flick = b.life > 0.6 ? 1 : (Math.random() < 0.5 ? b.life : b.life * 0.3);
      g.globalAlpha = flick; g.lineJoin = "round";
      for (const [w, c, bl] of [[9, b.c, 40], [3.5, b.c, 18], [1.4, "#fff", 6]]) { g.lineWidth = w; g.strokeStyle = c; g.shadowColor = b.c; g.shadowBlur = bl; g.beginPath(); b.pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
    }
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i]; s.x += s.vx; s.y += s.vy; s.life -= 0.012; if (s.life <= 0 || s.x > innerWidth + 200) { stars.splice(i, 1); continue; }
      const gr = g.createLinearGradient(s.x, s.y, s.x - s.vx * 18, s.y - s.vy * 18); gr.addColorStop(0, "#fff"); gr.addColorStop(0.2, s.c); gr.addColorStop(1, "transparent");
      g.globalAlpha = Math.min(1, s.life * 2); g.strokeStyle = gr; g.lineWidth = 3; g.shadowColor = s.c; g.shadowBlur = 16; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - s.vx * 18, s.y - s.vy * 18); g.stroke();
      if (Math.random() < 0.5) spark(s.x, s.y, s.c, 1, 1.2, 0.04);
    }
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i]; a.t += 0.012; if (a.t > 1.6) { arcs.splice(i, 1); continue; }
      const grow = Math.min(1, a.t * 1.6), fade = a.t > 1 ? 1 - (a.t - 1) / 0.6 : 1, cx = innerWidth / 2, cy = innerHeight * 0.95, R = Math.min(innerWidth, innerHeight * 1.6) * 0.48;
      ["#ff3d3d", "#ff9a3c", "#ffe14d", "#4dff88", "#3fb8ff", "#7a5cff", "#d15cff"].forEach((c, k) => {
        g.globalAlpha = 0.55 * fade; g.strokeStyle = c; g.lineWidth = 9; g.shadowColor = c; g.shadowBlur = 20;
        g.beginPath(); g.arc(cx, cy, R - k * 10, Math.PI, Math.PI + Math.PI * grow); g.stroke();
      });
    }
    g.globalAlpha = 1; g.shadowBlur = 0;
    if (parts.length || bolts.length || stars.length || arcs.length) raf = requestAnimationFrame(frame);
  }
  function spark(x, y, c, n, speed, decay) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (0.5 + Math.random()) * (speed || 6);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, grav: 0.06, life: 1, d: decay || (0.012 + Math.random() * 0.012), s: 1.4 + Math.random() * 2.8, c: Array.isArray(c) ? pick(c) : c }); }
    layer();
  }
  function lightning(n, c) {
    for (let k = 0; k < n; k++) setTimeout(() => {
      let x = innerWidth * (0.1 + Math.random() * 0.8), y = 0; const pts = [[x, y]], bottom = innerHeight * (0.55 + Math.random() * 0.35);
      while (y < bottom) { y += 25 + Math.random() * 45; x += (Math.random() - 0.5) * 70; pts.push([x, y]); }
      bolts.push({ pts, life: 1, c: c || "#bfe9ff" }); spark(x, y, [c || "#bfe9ff", "#fff"], 18, 5); layer();
    }, k * 180);
  }
  function shootingStars(n, c) { for (let k = 0; k < n; k++) setTimeout(() => { stars.push({ x: -100, y: innerHeight * (0.05 + Math.random() * 0.35), vx: 14 + Math.random() * 8, vy: 3 + Math.random() * 3, life: 1, c: c || "#fff6cc" }); layer(); }, k * 260); }
  function rainbow() { arcs.push({ t: 0 }); layer(); }
  function confettiBurst(level, colors) {
    if (typeof window.confetti !== "function" || !on("confetti") || calm()) return;
    const n = level >= 3 ? 220 : level === 2 ? 140 : 70, base = { colors, disableForReducedMotion: true, ticks: 260, scalar: level >= 2 ? 1.25 : 1 };
    window.confetti(Object.assign({ particleCount: n, angle: 60, spread: 65, startVelocity: 62, origin: { x: 0, y: 1 } }, base));
    window.confetti(Object.assign({ particleCount: n, angle: 120, spread: 65, startVelocity: 62, origin: { x: 1, y: 1 } }, base));
    if (level >= 3) for (let k = 1; k <= 5; k++) setTimeout(() => window.confetti(Object.assign({ particleCount: 120, spread: 360, startVelocity: 34, origin: { x: 0.15 + Math.random() * 0.7, y: 0.2 + Math.random() * 0.3 }, shapes: ["star", "circle"] }, base)), k * 450);
  }
  const themeColors = () => [cssv("--accent"), cssv("--accent2") || cssv("--accent-hi"), cssv("--accent-hi"), cssv("--good"), cssv("--warn"), "#ffffff"].filter(Boolean);

  // ---------- the big words ----------
  const queue = [];
  let showing = false;
  function celebrate(o) {
    if (!o || !on("celebrations")) { if (o && o.sub && on("encouragement")) toast(o.title + (o.sub ? " — " + o.sub : "")); return; }
    if (!o.live && recording()) { if (queue.length < 6) queue.push(o); return; }
    if (showing && !o.live) { queue.push(o); return; }
    show(o);
  }
  function show(o) {
    showing = true;
    const lvl = o.level || 1, col = o.color || cssv("--accent") || "#c9a45a", hold = o.hold || (lvl >= 3 ? 4200 : lvl === 2 ? 2800 : 1900);
    let el = document.getElementById("cele-words"); if (el) el.remove();
    el = document.createElement("div"); el.id = "cele-words"; el.className = "lvl" + lvl + (calm() ? " calm" : "");
    el.style.setProperty("--cc", col);
    el.innerHTML = `<div class="cw-title">${esc(o.title)}</div>${o.sub ? `<div class="cw-sub">${esc(o.sub)}</div>` : ""}`;
    document.body.appendChild(el);
    if (!calm()) {
      const cx = innerWidth / 2, cy = innerHeight * 0.42;
      setTimeout(() => spark(cx, cy, [col, "#fff", ...themeColors()], lvl >= 3 ? 140 : lvl === 2 ? 90 : 46, lvl >= 2 ? 9 : 6), 120);
      if (!o.noConfetti) confettiBurst(lvl, [col, ...themeColors()]);
      if (lvl >= 3) { lightning(2, col); setTimeout(() => shootingStars(3, col), 600); setTimeout(rainbow, 900); }
      if (o.flash) flash(col);
    }
    setTimeout(() => el.classList.add("out"), hold);
    setTimeout(() => { el.remove(); showing = false; if (queue.length && !recording()) show(queue.shift()); }, hold + 700);
  }
  function flash(col) { const f = document.createElement("div"); f.id = "cele-flash"; f.style.setProperty("--cc", col || "#fff"); document.body.appendChild(f); setTimeout(() => f.remove(), 750); }
  function flush() { if (!showing && queue.length && !recording()) show(queue.shift()); }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- combo meter (Finished Hour's tiers, as they were) ----------
  const TIERS = { 1: ["WARMING UP", "#e0a83f"], 2: ["HEATING UP", "#e0813f"], 3: ["ON FIRE", "#e0563f"], 4: ["BLAZING", "#c1443a"], 5: ["UNSTOPPABLE", "#e63d5c"],
    6: ["RAMPAGE", "#e63dc0"], 7: ["GODLIKE", "#a03de6"], 8: ["LEGENDARY", "#7fd6ff"], 9: ["OVERDRIVE", "#ffd700"], 10: ["SUPERCHARGED", "#ffe45c"],
    11: ["RADIANT", "#fff6cc"], 12: ["TRANSCENDENT", "#ff3d7a"], 13: ["ZENITH", "#f3f3ff"], 14: ["LIMIT BREAK", "#00e5ff"], 15: ["OVERCLOCKED", "#5b4dff"],
    16: ["CATACLYSMIC", "#ff2e4d"], 17: ["SINGULARITY", "#b026ff"], 18: ["PARAGON", "#00ffa2"], 19: ["MYTHIC", "#ff6ec7"], 20: ["OMEGA", "#fff8dc"] };
  const EFFECTS = { 9: { l: 1 }, 10: { l: 2 }, 11: { l: 1, s: 1 }, 12: { s: 2 }, 13: { r: 1 }, 14: { l: 3 }, 15: { l: 2, s: 1 }, 16: { s: 3 }, 17: { s: 2, r: 1 }, 18: { r: 1, l: 1 }, 19: { r: 1, s: 2 }, 20: { l: 3, s: 3, r: 1 } };
  const mult = w => Math.floor(Math.max(w - 1, 0) / 100) + 1;
  const tierOf = m => m <= 1 ? 0 : m <= 9 ? m - 1 : Math.min(20, 9 + Math.floor((m - 10) / 5));
  const BREAK_MS = 10000;
  const C = { words: 0, score: 0, last: 0, tier: 0, hold: 0 };
  const best = () => { try { return JSON.parse(Store.lsGet("lr-combo-best") || "null") || { score: 0 }; } catch (e) { return { score: 0 }; } };
  function comboWords(n) {
    if (!on("combo") || n <= 0) return;
    const now = Date.now();
    if (C.last && now - C.last > BREAK_MS && now > C.hold) comboEnd();
    for (let i = C.words + 1; i <= C.words + n; i++) C.score += mult(i);
    C.words += n; C.last = now;
    const t = tierOf(mult(C.words));
    if (t > C.tier) {
      C.tier = t; const [name, col] = TIERS[t];
      celebrate({ title: name, color: col, live: true, level: t >= 9 ? 2 : 1, noConfetti: t < 9, flash: t >= 9, hold: 1600 });
      const fx = EFFECTS[t]; if (fx && !calm()) { if (fx.l) lightning(fx.l, col); if (fx.s) shootingStars(fx.s, col); if (fx.r) rainbow(); }
    }
    drawCombo(true);
  }
  // while the co-narrator's line plays, the clock that breaks a combo waits
  function comboHold(ms) { C.hold = Math.max(C.hold, Date.now() + ms); }
  function comboEnd() {
    if (C.score > 0) {
      const b = best();
      if (C.score > b.score) {
        try { Store.lsSet("lr-combo-best", JSON.stringify({ score: C.score, words: C.words, when: Date.now() })); } catch (e) {}
        if (b.score > 0) celebrate({ title: "NEW BEST COMBO", sub: C.score.toLocaleString() + " points · " + C.words.toLocaleString() + " words", level: 2 });
      }
    }
    C.words = 0; C.score = 0; C.last = 0; C.tier = 0; drawCombo(false);
  }
  function comboTick() { if (C.last && Date.now() - C.last > BREAK_MS && Date.now() > C.hold) comboEnd(); }
  function drawCombo(pop) {
    let el = document.getElementById("combo-box");
    const inBooth = document.body.classList.contains("booth-on");
    if (!on("combo") || !inBooth || S().comboHidden) { if (el) el.remove(); setGlow(0); return; }
    if (!el) { el = document.createElement("div"); el.id = "combo-box"; el.title = "Combo: your own words without a 10-second break. Click to hide."; el.onclick = () => { S().comboHidden = true; Store.saveSettings(); drawCombo(); toast("Combo meter hidden. Bring it back in Settings."); }; document.body.appendChild(el); }
    const t = C.tier, col = t ? TIERS[t][1] : "var(--muted)", b = best();
    el.style.setProperty("--cc", col); el.className = t ? "tier" : "";
    el.innerHTML = `<div class="cb-l">${t ? TIERS[t][0] : "COMBO"}</div><div class="cb-n">${C.score.toLocaleString()}<small> pts</small></div><div class="cb-s">×${mult(C.words || 1)} · ${C.words.toLocaleString()} words${b.score ? " · best " + b.score.toLocaleString() : ""}</div>`;
    if (pop) { el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
    setGlow(t);
  }
  function setGlow(t) {
    let gl = document.getElementById("combo-glow");
    if (t < 6 || calm()) { if (gl) gl.remove(); return; }
    if (!gl) { gl = document.createElement("div"); gl.id = "combo-glow"; document.body.appendChild(gl); }
    gl.style.setProperty("--cc", TIERS[t][1]); gl.style.setProperty("--gs", Math.min(1, (t - 5) / 10).toFixed(2));
  }
  setInterval(comboTick, 1000);

  // ---------- the small ones ----------
  window.cheer = function (kind) {
    const s = S();
    if (kind === "bookCreated") { if (on("celebrations")) celebrate({ title: "NEW BOOK", sub: pick(LINES.bookCreated), level: 1 }); else if (s.encouragement) toast(pick(LINES.bookCreated)); return; }
    if (kind === "chapterDone") return celebrate({ title: "DELIVERED", sub: pick(LINES.chapterDone), level: 2 });
    if (kind === "bookDone") return celebrate({ title: "BOOK DELIVERED", sub: pick(LINES.bookDone), level: 3 });
    if (s.encouragement && LINES[kind]) toast(pick(LINES[kind]));
  };
  window.toast = toast; window.note = note; window.flushNotes = flushNotes;
  window.LRCele = { celebrate, flush, comboWords, comboEnd, comboHold, drawCombo, lightning, shootingStars, rainbow, spark, TIERS, state: C };
})();
