/* The Lamp Room — theme effects that need more than CSS: Phosphor's digital rain, and the "motion off" switch.
   The rain sits behind every panel (never behind the text you read), and stops while you record or when the tab is hidden. */
(function () {
  "use strict";
  const html = document.documentElement;
  let cv = null, g = null, cols = [], raf = 0, last = 0;
  const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z:・.\"=*+-<>¦";
  const FS = 16;
  const calm = () => !!(window.Store && Store.settings && Store.settings.calm) || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const want = () => html.dataset.theme === "phosphor" && !calm();
  const paused = () => document.hidden || document.body.classList.contains("booth-recording");
  function size() { if (!cv) return; const d = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * d; cv.height = innerHeight * d; cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px"; g.setTransform(d, 0, 0, d, 0, 0); cols = Array.from({ length: Math.ceil(innerWidth / FS) }, () => Math.random() * -innerHeight / FS); g.fillStyle = "#030a05"; g.fillRect(0, 0, innerWidth, innerHeight); }
  function start() {
    if (cv) return;
    cv = document.createElement("canvas"); cv.id = "lr-rain"; cv.setAttribute("aria-hidden", "true"); document.body.prepend(cv); g = cv.getContext("2d"); size();
    addEventListener("resize", size); raf = requestAnimationFrame(frame);
  }
  function stop() { if (!cv) return; cancelAnimationFrame(raf); removeEventListener("resize", size); cv.remove(); cv = null; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused() || now - last < 55) return; last = now;
    g.fillStyle = "rgba(3,10,5,0.12)"; g.fillRect(0, 0, innerWidth, innerHeight);
    g.font = FS + "px 'Share Tech Mono', monospace";
    for (let i = 0; i < cols.length; i++) {
      const y = cols[i] * FS, ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      g.fillStyle = Math.random() < 0.04 ? "#f4ff3a" : Math.random() < 0.5 ? "#8dffaa" : "#39ff6a"; g.fillText(ch, i * FS, y);
      cols[i] = y > innerHeight && Math.random() > 0.975 ? 0 : cols[i] + 1;
    }
  }
  function sync() { html.classList.toggle("fx-calm", calm()); if (want()) start(); else stop(); }
  new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
  setInterval(sync, 1500);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", sync); else sync();
})();
