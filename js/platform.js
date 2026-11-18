/* The Lamp Room — Mac or PC. The shortcuts already work with Ctrl as well as ⌘; on a PC this swaps the Mac key symbols
   in everything on screen (⌘ → Ctrl+, ⌥ → Alt+, ⇧ → Shift+) and gives PC wording for the few Mac-only instructions.
   It guesses from the browser; Settings can override it for this computer. */
(function () {
  "use strict";
  const guess = () => { const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || ""; return /mac|iphone|ipad/i.test(p) ? "mac" : "pc"; };
  const pick = () => { try { return localStorage.getItem("lr-platform") || ""; } catch (e) { return ""; } };
  const plat = () => pick() || guess();
  const swap = s => String(s).replace(/Shift ⇧/g, "Shift").replace(/Command ⌘/g, "Ctrl").replace(/Option ⌥/g, "Alt").replace(/⌘⇧/g, "Ctrl+Shift+").replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+").replace(/Ctrl\+ /g, "Ctrl ").replace(/Alt\+ /g, "Alt ");
  const has = s => /[⌘⌥⇧]/.test(s);
  function fix(node) {
    if (node.nodeType === 3) { if (has(node.nodeValue)) node.nodeValue = swap(node.nodeValue); return; }
    if (node.nodeType !== 1 || node.tagName === "SCRIPT" || node.tagName === "STYLE") return;
    for (const a of ["title", "placeholder", "aria-label"]) { const v = node.getAttribute && node.getAttribute(a); if (v && has(v)) node.setAttribute(a, swap(v)); }
    if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") return;
    for (const c of node.childNodes) fix(c);
  }
  let obs = null;
  function start() {
    document.documentElement.dataset.platform = plat();
    if (plat() !== "pc") { if (obs) { obs.disconnect(); obs = null; } return; }
    fix(document.body);
    obs = obs || new MutationObserver(ms => { for (const m of ms) { if (m.type === "characterData") fix(m.target); else if (m.type === "attributes") fix(m.target); else m.addedNodes.forEach(fix); } });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "placeholder", "aria-label"] });
  }
  window.LRPlat = {
    get pc() { return plat() === "pc"; }, get mac() { return plat() === "mac"; }, get which() { return plat(); }, guess, chosen: pick, swap,
    set(v) { try { if (v) localStorage.setItem("lr-platform", v); else localStorage.removeItem("lr-platform"); } catch (e) { } location.reload(); },
    // Mac-only instructions, said the PC way
    rateHelp: () => plat() === "pc" ? "set it to 48,000 Hz in Windows Sound settings (Sound ▸ your microphone ▸ Properties ▸ Advanced ▸ Default format), then reload" : "set it to 48,000 Hz in Audio MIDI Setup (Applications ▸ Utilities), then reload",
    refresh: () => plat() === "pc" ? "Ctrl+Shift+R" : "⌘⇧R"
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
})();
