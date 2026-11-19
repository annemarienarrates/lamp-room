/* The Lamp Room — theme effects that need more than CSS: Phosphor's digital rain, Signal's neon horizon, and the "motion off" switch.
   They sit behind every panel (never behind the text you read), and stop while you record or when the tab is hidden. */
(function () {
  "use strict";
  const html = document.documentElement;
  let cv = null, g = null, raf = 0, last = 0, kind = null;
  const calm = () => !!(window.Store && Store.settings && Store.settings.calm) || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const which = () => calm() ? null : html.dataset.theme === "phosphor" ? "rain" : html.dataset.theme === "signal" ? "grid" : null;
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

  function size() {
    if (!cv) return; const d = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; g.setTransform(d, 0, 0, d, 0, 0);
    cols = Array.from({ length: Math.ceil(innerWidth / FS) }, () => Math.floor(Math.random() * innerHeight / FS)); gridInit();
  }
  function start(k) {
    if (cv && kind === k) return; stop();
    kind = k; t0 = performance.now();
    cv = document.createElement("canvas"); cv.id = "lr-rain"; cv.className = "fx-" + k; cv.setAttribute("aria-hidden", "true"); document.body.prepend(cv); g = cv.getContext("2d"); size();
    addEventListener("resize", size); raf = requestAnimationFrame(frame);
  }
  function stop() { if (!cv) return; cancelAnimationFrame(raf); removeEventListener("resize", size); cv.remove(); cv = null; kind = null; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused()) return;
    if (kind === "rain") rain(now); else if (kind === "grid") grid(now);
  }
  function sync() { html.classList.toggle("fx-calm", calm()); const k = which(); if (k) start(k); else stop(); }
  new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
  setInterval(sync, 1500);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", sync); else sync();
})();
