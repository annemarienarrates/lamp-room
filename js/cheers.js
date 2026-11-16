/* The Lamp Room — confetti and encouragement. Both can be switched off in Settings. */
(function () {
  "use strict";
  const LINES = {
    bookCreated: ["New book on the ledger. The lamp is lit.", "Manuscript in. Chapters counted. The fun part starts now.", "Another world to give a voice to."],
    chapterRecorded: ["Chapter in the can.", "That's a chapter. Water, then the next.", "Recorded. The voice lives to read another day."],
    chapterDone: ["Chapter delivered. One less voice in your head.", "That one's out the door.", "Delivered. Pour something.", "Another chapter carried across the threshold."],
    bookDone: ["Every chapter delivered. That's a whole book.", "The book is finished. Go outside. Briefly.", "Final chapter delivered. The ledger closes on this one."]
  };
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function toast(msg) {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add("out"), 3600);
    setTimeout(() => t.remove(), 4200);
  }

  function burst(big) {
    if (typeof window.confetti !== "function") return;
    const css = getComputedStyle(document.documentElement);
    const colors = ["--accent", "--good", "--warn", "--ink"].map(v => css.getPropertyValue(v).trim()).filter(Boolean);
    window.confetti({ particleCount: big ? 220 : 90, spread: big ? 110 : 70, origin: { y: 0.7 }, colors, disableForReducedMotion: true });
    if (big) setTimeout(() => window.confetti({ particleCount: 140, angle: 60, spread: 70, origin: { x: 0 }, colors }), 250),
             setTimeout(() => window.confetti({ particleCount: 140, angle: 120, spread: 70, origin: { x: 1 }, colors }), 400);
  }

  // kind: bookCreated | chapterDone | bookDone
  window.cheer = function (kind) {
    const s = (window.Store && Store.settings) || {};
    if (s.confetti) burst(kind === "bookDone");
    if (s.encouragement && LINES[kind]) toast(pick(LINES[kind]));
  };
  window.toast = toast;
})();
