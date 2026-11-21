/* The Lamp Room — problem log.
   Quietly keeps the last 100 things that went wrong on this computer (errors, failed saves,
   "couldn't…" messages) so they can be copied for Claude later. No alerts, no dot. Nothing leaves
   this computer unless you press Copy and paste it somewhere yourself. */
(function () {
  "use strict";
  const KEY = "lr-problems", MAX = 100;
  const ver = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=(\d+)/);
  const VERSION = ver ? ver[1] : "dev";
  const BAD = /couldn.?t|could not|failed|didn.?t work|went wrong|not found|error/i;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) {} }

  function where() {
    const h = (location.hash || "#/").replace(/\?.*$/, "");
    return h.replace(/\/[^/]*[A-Za-z0-9]{12,}[^/]*/g, "/…"); // drop long ids, keep the page name
  }
  function add(kind, msg, stack) {
    msg = String(msg || "").slice(0, 500); if (!msg) return;
    const list = read(), last = list[list.length - 1], now = Date.now();
    if (last && last.msg === msg && now - last.t < 5000) { last.n = (last.n || 1) + 1; write(list); return; }
    list.push({ t: now, kind, msg, where: where(), v: VERSION, stack: stack ? String(stack).split("\n").slice(0, 4).join("\n").slice(0, 600) : undefined });
    write(list);
  }

  window.addEventListener("error", e => {
    if (!e.message && e.target && e.target !== window) { add("load", "Couldn't load " + (e.target.src || e.target.href || e.target.tagName)); return; }
    add("error", e.message + (e.filename ? " (" + e.filename.replace(/^.*\//, "").replace(/\?.*$/, "") + ":" + e.lineno + ")" : ""), e.error && e.error.stack);
  }, true);
  window.addEventListener("unhandledrejection", e => { const r = e.reason || {}; add("error", r.message || String(r), r.stack); });
  document.addEventListener("lr-save-error", e => { const r = e.detail || {}; add("save", "Save failed: " + (r.message || r), r.stack); });

  // Messages shown on screen that report a problem. toast is defined later, so wrap it once it exists.
  function wrapToast() {
    if (!window.toast || window.toast._logged) return;
    const orig = window.toast;
    window.toast = function (m) { if (typeof m === "string" && BAD.test(m)) add("message", m.replace(/<[^>]+>/g, "")); return orig.apply(this, arguments); };
    window.toast._logged = true;
  }
  document.addEventListener("DOMContentLoaded", wrapToast);
  window.addEventListener("load", wrapToast);

  function stamp(t) { const d = new Date(t); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }

  function forClaude() {
    const list = read();
    const ua = navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/g) || [];
    const os = /Mac/.test(navigator.platform) ? "Mac" : /Win/.test(navigator.platform) ? "Windows" : navigator.platform;
    const head = `Lamp Room problem log — version ${VERSION}, ${os}, ${ua.join(" ")}\n${list.length} entr${list.length === 1 ? "y" : "ies"}, oldest first.\n`;
    return head + list.map(p => `\n[${new Date(p.t).toISOString()}] ${p.kind} on ${p.where} (v${p.v})${p.n > 1 ? " ×" + p.n : ""}\n  ${p.msg}${p.stack ? "\n  " + p.stack.replace(/\n/g, "\n  ") : ""}`).join("\n");
  }

  window.LRProblems = { add, read, clear() { write([]); }, forClaude, stamp, VERSION };
})();
