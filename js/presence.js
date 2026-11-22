/* The Lamp Room — who else has this book open.
   Each person on each computer keeps one small file, Library/Presence/<Name>.json: which book they have open, where
   (its page or the Booth, and which chapter) and when they last said so. It's refreshed about once a minute while a
   book is open and cleared when they leave it. Anyone else on the same book sees a quiet line at the top of the page.
   Only for people sharing this Library (outside cast work in their own Lamp Rooms). */
(function () {
  "use strict";
  const FRESH = 150e3, BEAT = 60e3, LOOK = 25e3;
  let last = "", lastAt = 0, others = [];
  const safe = s => String(s || "").replace(/[\\/:*?"<>|]/g, "_");
  function here() {
    const m = location.hash.match(/^#\/(book|booth)\/([^/?]+)(?:\/(\d+))?/); if (!m) return null;
    const book = Store.books.find(b => b.id === m[2]); if (!book) return null;
    const ci = m[1] === "booth" ? (window.Booth && Booth.state && Booth.state.book && Booth.state.book.id === book.id ? Booth.state.ci : +(m[3] || 0)) : null;
    return { book: book.id, title: book.title, where: m[1], ci, chapter: ci != null && book.chapters[ci] ? book.chapters[ci].title : "" };
  }
  async function dir() { return Store.root.getDirectoryHandle("Presence", { create: true }); }
  async function say(force) {
    if (!Store.root || !Store.me()) return;
    const h = here(), sig = JSON.stringify(h);
    if (!force && sig === last && Date.now() - lastAt < BEAT) return;
    last = sig; lastAt = Date.now();
    try { const d = await dir(), fh = await d.getFileHandle(safe(Store.me()) + ".json", { create: true }), w = await fh.createWritable();
      await w.write(JSON.stringify(Object.assign({ who: Store.me(), at: new Date().toISOString() }, h || { book: null }))); await w.close(); } catch (e) {}
  }
  async function look() {
    if (!Store.root || !Store.me()) return;
    const out = [];
    try { const d = await dir(); for await (const [n, fh] of d.entries()) {
      if (fh.kind !== "file" || !n.endsWith(".json")) continue;
      try { const j = JSON.parse(await (await fh.getFile()).text()); if (j.book && j.who && !Store.samePerson(j.who, Store.me()) && Date.now() - Date.parse(j.at) < FRESH) out.push(j); } catch (e) {}
    } } catch (e) {}
    others = out; draw();
  }
  function draw() {
    const h = here(), el = document.getElementById("presence");
    const on = h ? others.filter(o => o.book === h.book) : [];
    if (!on.length) { if (el) el.remove(); return; }
    const txt = on.map(o => o.who + " has this book open" + (o.where === "booth" ? " (Booth" + (o.chapter ? ", " + o.chapter : "") + ")" : " (its page)")).join(" · ");
    let x = el; if (!x) { x = document.createElement("div"); x.id = "presence"; x.setAttribute("role", "status"); document.body.appendChild(x); }
    x.textContent = "👥 " + txt;
  }
  function start() {
    window.addEventListener("hashchange", () => { say(true); draw(); });
    setInterval(() => { if (document.visibilityState === "visible") say(false); }, 15e3);
    setInterval(() => { if (document.visibilityState === "visible") look(); }, LOOK);
    window.addEventListener("focus", () => { say(true); look(); });
    // a closed tab can't write on its way out; its file goes stale and drops off after FRESH
    say(true); look();
  }
  window.LRPresence = { start, look, say, others: () => others };
})();
