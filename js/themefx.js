/* The Lamp Room — theme effects that need more than CSS: Phosphor's digital rain, Signal's neon horizon, Sanguine's candlelit chamber, and the "motion off" switch.
   They sit behind every panel (never behind the text you read), and stop while you record or when the tab is hidden. */
(function () {
  "use strict";
  const html = document.documentElement;
  let cv = null, g = null, raf = 0, last = 0, kind = null;
  const calm = () => !!(window.Store && Store.settings && Store.settings.calm) || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const which = () => calm() ? null : html.dataset.theme === "phosphor" ? "rain" : html.dataset.theme === "signal" ? "grid" : html.dataset.theme === "sanguine" ? "candle" : null;
  const paused = () => document.hidden || document.body.classList.contains("booth-recording");

  // ---------- Phosphor: digital rain ----------
  const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z:・.\"=*+-<>¦";
  const FS = 16;
  let cols = [];
  function rain(now) {
    if (now - last < 55) return; last = now;
    g.fillStyle = "rgba(3,10,5,0.12)"; g.fillRect(0, 0, innerWidth, innerHeight);
    g.font = FS + "px 'Share Tech Mono', monospace";
    for (let i = 0; i < cols.length; i++) {
      const y = cols[i] * FS, ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      g.fillStyle = Math.random() < 0.04 ? "#f4ff3a" : Math.random() < 0.5 ? "#8dffaa" : "#39ff6a"; g.fillText(ch, i * FS, y);
      cols[i] = y > innerHeight && Math.random() > 0.975 ? 0 : cols[i] + 1;
    }
  }

  // ---------- Signal: a neon horizon — sliced sun, a grid rolling toward you, stars, the odd glitch ----------
  let stars = [], t0 = 0, glitch = 0;
  function gridInit() { stars = Array.from({ length: Math.round(innerWidth * innerHeight / 9000) }, () => ({ x: Math.random(), y: Math.random() * 0.6, p: Math.random() * 6.28, s: Math.random() < 0.15 ? 1.6 : 1 })); }
  function grid(now) {
    if (now - last < 33) return; last = now;
    const W = innerWidth, H = innerHeight, hz = Math.round(H * 0.6), t = (now - t0) / 1000;
    g.fillStyle = "#050505"; g.fillRect(0, 0, W, H);
    // sky glow
    let gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, "#050505"); gr.addColorStop(0.7, "#1a0512"); gr.addColorStop(1, "#3a0726");
    g.fillStyle = gr; g.fillRect(0, 0, W, hz);
    // stars
    for (const s of stars) { const a = 0.25 + 0.35 * Math.sin(t * 1.3 + s.p); g.fillStyle = `rgba(255,230,240,${a.toFixed(2)})`; g.fillRect(s.x * W, s.y * H, s.s, s.s); }
    // the sun, sliced, its bands drifting down
    const R = Math.min(W, H) * 0.2, cx = W / 2, cy = hz - R * 0.35;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    gr = g.createLinearGradient(0, cy - R, 0, cy + R); gr.addColorStop(0, "#ffe600"); gr.addColorStop(0.55, "#ff7a3d"); gr.addColorStop(1, "#ff2a9d");
    g.fillStyle = gr; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.fillStyle = "#1a0512";
    for (let k = 0; k < 9; k++) { const f = ((k + (t * 0.25) % 1) / 9), y = cy + f * R, h = 1 + f * R * 0.09; if (y > cy - R * 0.1) g.fillRect(cx - R, y, R * 2, h); }
    g.restore();
    g.save(); g.shadowColor = "#ff2a9d"; g.shadowBlur = 40; g.globalAlpha = 0.35; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = "#ff6ec0"; g.lineWidth = 2; g.stroke(); g.restore();
    // ground
    gr = g.createLinearGradient(0, hz, 0, H); gr.addColorStop(0, "#22041a"); gr.addColorStop(1, "#050505");
    g.fillStyle = gr; g.fillRect(0, hz, W, H - hz);
    // the grid: horizontal lines rushing in, verticals meeting at the vanishing point
    g.save(); g.strokeStyle = "#ff2a9d"; g.shadowColor = "#ff2a9d"; g.shadowBlur = 8;
    const N = 18, sp = (t * 0.55) % 1;
    for (let i = 0; i < N; i++) { const z = (i + sp) / N, y = hz + (H - hz) * z * z; g.globalAlpha = Math.min(1, 0.15 + z); g.lineWidth = 0.6 + z * 1.6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.globalAlpha = 0.6; g.lineWidth = 1;
    for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(cx + i * (W / 28) * 0.08, hz); g.lineTo(cx + i * (W / 14) * 1.6, H); g.stroke(); }
    g.restore();
    // horizon line
    g.save(); g.strokeStyle = "#ffe600"; g.shadowColor = "#ffe600"; g.shadowBlur = 14; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, hz); g.lineTo(W, hz); g.stroke(); g.restore();
    // now and then, the signal slips
    if (!glitch && Math.random() < 0.004) glitch = 6;
    if (glitch) { glitch--; const y = Math.random() * H, h = 6 + Math.random() * 30; try { g.drawImage(cv, 0, y * (cv.width / W), cv.width, h * (cv.width / W), (Math.random() - 0.5) * 40, y, W, h); } catch (e) {} g.fillStyle = Math.random() < 0.5 ? "rgba(255,42,157,.12)" : "rgba(255,230,0,.10)"; g.fillRect(0, y, W, h); }
  }

  // ---------- Sanguine: a candlelit chamber — embers rising, candles at the edges, smoke, a slow heartbeat, the rare falling petal ----------
  let embers = [], petals = [], smoke = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  function candleInit() {
    const W = innerWidth, H = innerHeight;
    embers = Array.from({ length: Math.round(W * H / 16000) + 16 }, () => newEmber(true));
    smoke = Array.from({ length: 4 }, (_, i) => ({ x: rnd(0, W), y: rnd(H * 0.3, H), r: rnd(220, 420), v: rnd(4, 10) * (i % 2 ? 1 : -1) }));
    petals = [newPetal(), newPetal()]; petals.forEach(p => p.y = rnd(0, H * 0.6));
  }
  function newEmber(anyY) { const W = innerWidth, H = innerHeight; return { x: rnd(0, W), y: anyY ? rnd(0, H) : H + rnd(0, 40), v: rnd(10, 32), sw: rnd(0.4, 1.4), ph: rnd(0, 6.28), r: rnd(1, 2.6), gold: Math.random() < 0.12, life: rnd(0.6, 1) }; }
  function newPetal() { return { x: rnd(0.05, 0.95) * innerWidth, y: -30, v: rnd(14, 26), sw: rnd(20, 50), ph: rnd(0, 6.28), rot: rnd(0, 6.28), spin: rnd(-1, 1), s: rnd(9, 15), glint: 0 }; }
  // lub-dub, about 40 beats a minute
  function beat(t) { const p = (t % 1.5) / 1.5; const k = x => Math.exp(-Math.pow(x / 0.045, 2)); return k(p - 0.06) + 0.6 * k(p - 0.22); }
  function candle(now) {
    if (now - last < 33) return; const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    const W = innerWidth, H = innerHeight, t = (now - t0) / 1000, hb = beat(t);
    g.fillStyle = "#070203"; g.fillRect(0, 0, W, H);
    // smoke, slow
    for (const m of smoke) { m.x += m.v * dt; if (m.x < -m.r) m.x = W + m.r; if (m.x > W + m.r) m.x = -m.r;
      const gr = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r); gr.addColorStop(0, "rgba(70,10,20,.16)"); gr.addColorStop(1, "rgba(70,10,20,0)"); g.fillStyle = gr; g.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2); }
    // candles just out of view, flickering at the lower corners
    for (const [cx, ph] of [[-W * 0.02, 0], [W * 1.02, 2.1]]) {
      const f = 0.75 + 0.12 * Math.sin(t * 7.3 + ph) + 0.08 * Math.sin(t * 13.1 + ph * 2) + rnd(-0.05, 0.05), R = H * 0.55 * f;
      const gr = g.createRadialGradient(cx, H * 1.02, 0, cx, H * 1.02, R); gr.addColorStop(0, `rgba(255,140,60,${(0.22 * f).toFixed(3)})`); gr.addColorStop(0.35, `rgba(200,30,40,${(0.12 * f).toFixed(3)})`); gr.addColorStop(1, "rgba(120,0,20,0)");
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // the heartbeat: the red at the edges swells and settles
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(150,0,25,0)"); vg.addColorStop(1, `rgba(150,0,25,${(0.18 + 0.22 * hb).toFixed(3)})`); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    // embers
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < embers.length; i++) { const e = embers[i];
      e.y -= e.v * dt; e.x += Math.sin(t * e.sw + e.ph) * 12 * dt; e.life -= dt * 0.05;
      if (e.y < -10 || e.life <= 0) { embers[i] = newEmber(false); continue; }
      const a = Math.max(0, Math.min(1, e.life)) * (0.7 + 0.3 * Math.sin(t * 5 + e.ph)), c = e.gold ? "255,200,90" : "255,70,40";
      const gr = g.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 5); gr.addColorStop(0, `rgba(${c},${a.toFixed(3)})`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(e.x - e.r * 5, e.y - e.r * 5, e.r * 10, e.r * 10); }
    g.restore();
    // the rare petal: a handful at most, turning as it falls
    if (petals.length < 4 && Math.random() < 0.006) petals.push(newPetal());
    for (let i = petals.length - 1; i >= 0; i--) { const p = petals[i];
      p.y += p.v * dt; p.ph += dt * 0.9; p.rot += p.spin * dt; const x = p.x + Math.sin(p.ph) * p.sw, flip = Math.cos(p.ph * 1.3);
      if (p.y > H + 40) { petals.splice(i, 1); continue; }
      if (!p.glint && Math.random() < 0.002) p.glint = 1; if (p.glint) p.glint = Math.max(0, p.glint - dt * 1.2);
      g.save(); g.translate(x, p.y); g.rotate(p.rot); g.scale(0.35 + 0.65 * Math.abs(flip), 1);
      const gr = g.createLinearGradient(0, -p.s, 0, p.s); gr.addColorStop(0, "#7a0614"); gr.addColorStop(0.6, "#b0122a"); gr.addColorStop(1, "#4a020c");
      g.fillStyle = gr; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(0, -p.s); g.bezierCurveTo(p.s * 0.9, -p.s * 0.6, p.s * 0.7, p.s * 0.7, 0, p.s); g.bezierCurveTo(-p.s * 0.7, p.s * 0.7, -p.s * 0.9, -p.s * 0.6, 0, -p.s); g.fill();
      if (p.glint) { g.globalAlpha = p.glint * 0.9; g.fillStyle = "#ffd27a"; g.beginPath(); g.ellipse(p.s * 0.15, -p.s * 0.3, p.s * 0.18, p.s * 0.45, 0.4, 0, 6.28); g.fill(); }
      g.restore(); }
  }

  function size() {
    if (!cv) return; const d = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; g.setTransform(d, 0, 0, d, 0, 0);
    cols = Array.from({ length: Math.ceil(innerWidth / FS) }, () => Math.floor(Math.random() * innerHeight / FS)); gridInit(); candleInit();
  }
  function start(k) {
    if (cv && kind === k) return; stop();
    kind = k; t0 = performance.now(); last = 0;
    cv = document.createElement("canvas"); cv.id = "lr-rain"; cv.className = "fx-" + k; cv.setAttribute("aria-hidden", "true"); document.body.prepend(cv); g = cv.getContext("2d"); size();
    addEventListener("resize", size); raf = requestAnimationFrame(frame);
  }
  function stop() { if (!cv) return; cancelAnimationFrame(raf); removeEventListener("resize", size); cv.remove(); cv = null; kind = null; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused()) return;
    if (kind === "rain") rain(now); else if (kind === "grid") grid(now); else if (kind === "candle") candle(now);
  }
  function sync() { html.classList.toggle("fx-calm", calm()); const k = which(); if (k) start(k); else stop(); }
  new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
  setInterval(sync, 1500);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", sync); else sync();
})();
