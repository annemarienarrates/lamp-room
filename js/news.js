/* The Lamp Room — What's new.
   After an update, the Dashboard shows a short card with the changes that matter to whoever is working here.
   Roles: "team" (the Library's own narrators: Settings ▸ Narrators), and "narrator", "cast", "editor" from the
   people lists of shared books. "all" reaches everyone. "Got it" clears the card for that person on this computer.
   Add the newest entry at the top. Keep each one to a line or two, in plain words: what changed and where to find it. */
(function () {
  "use strict";
  const NEWS = [
    { id: "2026-11-21d", roles: ["all"], title: "Settings in four tabs", body: "Me, This computer, Books & money and Look, with a search box that looks through all of them." },
    { id: "2026-11-21c", roles: ["all"], title: "A tidier Tools drawer", body: "The Booth's Tools list shows only what this book uses; the rest wait under ＋ More. It opens on the tab you last used in each book." },
    { id: "2026-11-21b", roles: ["team", "narrator", "cast"], title: "Smoother while recording", body: "Word counts no longer re-read the whole book every few seconds, so the page has more room to keep up with you." },
    { id: "2026-11-21a", roles: ["all"], title: "Daily backups", body: "Once a day your computer saves a copy of the books, everyone's progress and the planner. Settings ▸ This computer ▸ Backups. A book's Lead can restore it." },
    { id: "2026-11-21", roles: ["all"], title: "Problem log", body: "If something misbehaves: Settings ▸ This computer ▸ Problem log ▸ Copy for Claude, and paste it into the chat." },
    { id: "2026-11-20", roles: ["team"], title: "Read my note works on this computer", body: "The planner's note reader is a simple word-matcher now, with no API key and nothing sent anywhere. Check the lines before saving." }
  ];
  const key = () => "lr-news-seen@" + (Store.me() || "");

  function roles() {
    const me = Store.me(), out = new Set(["all"]);
    if ((Store.settings.narrators || []).some(n => Store.samePerson(n.name, me))) out.add("team");
    for (const b of Store.books) for (const p of (b.sharedPeople || [])) if (Store.samePerson(p.name, me)) {
      if (p.role === "lead" || p.role === "narrator") out.add("narrator");
      if (p.role === "cast" || p.role === "outside") out.add("cast");
      if (p.role === "editor") out.add("editor");
    }
    return out;
  }
  function seen() { try { return localStorage.getItem(key()); } catch (e) { return null; } }
  function unseen() {
    if (!Store.me()) return [];
    let s = seen();
    if (s === null) {                              // someone new here: only the last week's news, not the whole history
      s = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);   // ids start with their date, so they compare as text
    }
    const r = roles();
    return NEWS.filter(n => n.id > s && n.roles.some(x => r.has(x))).slice(0, 6);
  }
  function card() {
    const list = unseen(); if (!list.length) return "";
    const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    return `<div class="card news-card" id="newsCard"><div class="news-head"><h3>What's new</h3><button class="btn small" data-news-ok>Got it</button></div>
      <ul>${list.map(n => `<li><b>${esc(n.title)}.</b> ${esc(n.body)}</li>`).join("")}</ul></div>`;
  }
  function wire(root) {
    const b = root && root.querySelector("[data-news-ok]"); if (!b) return;
    b.onclick = () => { try { localStorage.setItem(key(), NEWS[0].id); } catch (e) {} const c = document.getElementById("newsCard"); if (c) c.remove(); };
  }
  window.LRNews = { NEWS, card, wire, roles, unseen };
})();
