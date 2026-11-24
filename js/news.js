/* The Lamp Room — What's new.
   After an update, the Dashboard shows a short card with the changes that matter to whoever is working here.
   Roles: "team" (the Library's own narrators: Settings ▸ Narrators), and "narrator", "cast", "editor" from the
   people lists of shared books. "all" reaches everyone. "Got it" clears the card for that person on this computer.
   Add the newest entry at the top. Keep each one to a line or two, in plain words: what changed and where to find it. */
(function () {
  "use strict";
  const NEWS = [
    { id: "2026-11-24f", roles: ["team"], title: "New cuts: you choose", body: "A re-send no longer changes the chapter by itself. Collaborate offers Replace the list (the new cuts become the list; your clips stay put), Re-splice with new cuts (each of their clips swapped for its new cut where it sits, doubled-up copies out), or Keep mine. 🔁 Re-splice is there any time, and Undo puts it all back." },
    { id: "2026-11-24e", roles: ["team"], title: "Auphonic, round two", body: "Chapters now go to Auphonic as a lossless FLAC, about a third of the size, uploading in the background with progress on the Dashboard while you keep working. Results come home through Google Drive: connect Drive in Auphonic, then Settings ▸ This computer ▸ Auphonic ▸ pick it and show the Lamp Room the folder. They're filed into Studio ▸ Mastered under their delivery names." },
    { id: "2026-11-24d", roles: ["team"], title: "Assign lines in your own copy", body: "Anyone can select words and pick who reads them again. If you're not the Lead, it changes your copy only (your counts, pacer and lines); the Lead's choice still changes the book for everyone. Text edits stay with the Lead." },
    { id: "2026-11-24c", roles: ["team"], title: "Re-sends and ✂ marks", body: "Re-sends no longer trip up Google Drive. Drag a ✂ mark along the ruler to move it; right-click to remove it." },
    { id: "2026-11-24b", roles: ["team"], title: "Steadier pacer", body: "The pacer no longer jumps ahead on a re-read or a single stray word: a jump needs two words in a row to agree. Pickups can wear one of your tracks' effects (or a voice preset) before they're sent." },
    { id: "2026-11-24a", roles: ["team"], title: "Tidier days", body: "The Almanac's calendar shows the days you recorded, logged or not. Heads up items can be dismissed. The chapter-done card leads with Send my lines for a co-narrator; Export is a small link. People is now just who works in this Library (Settings ▸ Books & money); cast live on each book." },
    { id: "2026-11-23c", roles: ["team"], title: "Booth time logs itself", body: "Recording time from the Booth now counts in the planner by itself: each day's hours, the title's recording stage, Today's card and the Daybook (🎙 chips, and a card of its own on days nobody logged). Log only everything else. If you do log recording for the same book that day, the larger of the two counts, never both." },
    { id: "2026-11-23b", roles: ["team"], title: "🎚 Master with Auphonic", body: "Paste your Auphonic API key once (Settings ▸ This computer ▸ Auphonic; it stays on this computer). Then Export ▸ 🎚 Master with Auphonic sends the chapter with your preset, and the result comes back to Studio ▸ Mastered ▸ the book, named for delivery, while you keep working. Love scenes: tick Each reader as their own track and give each reader their own preset (Breathy for one, Normal Breath for the other)." },
    { id: "2026-11-23a", roles: ["team"], title: "No editor role: share, bring in, splice", body: "📤 Share my takes replaces Send to Editor, and nothing locks: share again whenever you re-record. Anyone on a shared book can Bring in everyone's takes (yours are shared first) to listen or splice. A co-narrator's lines also reach the lead through the shared folder, even from another Library, to drop in as they read. Anyone listed as Editor is now Outside; an outside editor gets files from Export, as before." },
    { id: "2026-11-22o", roles: ["team"], title: "Casting sheet fills in the cast", body: "New book (or a book's Who reads what): 📋 Use a casting sheet… reads your Character / Actor CSV, works out which colour is whom from the dialogue tags, keeps you two as yourselves and gives hired actors a Cast slot with their real name. A full cast goes on the schedule as C, paid per word (Settings ▸ Money: cast pay)." },
    { id: "2026-11-22n", roles: ["team"], title: "What an hour really pays", body: "Titles tab, under the catalog: each finished title's net ÷ every hour you both put in (booth time counted automatically, plus editing, pickups and admin from your logs), by client and arrangement, and where the hours went. Titles in progress show what they'll pay if the rest goes to estimate." },
    { id: "2026-11-22m", roles: ["team"], title: "Goals live on the Goals page", body: "Yearly FH goal, the 2025 baseline and FH already paid this year are set on the Goals page (Both of us); the planner points there." },
    { id: "2026-11-22l", roles: ["team"], title: "One setting each", body: "Words per finished hour is measured from your finished books (Settings ▸ Money shows what's in use); hours a day is set once per person in People. The booth, Dashboard and planner all read the same two." },
    { id: "2026-11-22k", roles: ["team"], title: "Pace is measured, per series", body: "Estimates use your real booth pace: a series' own once it has an hour of reading (Sunfire runs slower), else your pace over the last 60 days, else what's typed in People. Each book says which it's using." },
    { id: "2026-11-22j", roles: ["editor", "team"], title: "Lines follow-along missed still land", body: "Bring in finds lines follow-along missed or caught late by the pause before each one, places everyone else's lines around them, and flags each for a listen." },
    { id: "2026-11-22i", roles: ["editor"], title: "Lines end at the reader's ✂ mark", body: "When a reader marks their line ends (C), Bring in cuts each line there instead of running on to their next line; and their lines still land even where follow-along missed them." },
    { id: "2026-11-22h", roles: ["all"], title: "FX Guide", body: "A printable guide to effects in the help desk (? ▸ 🎚 FX guide): your saved voices, a pitch ladder for a cast, and gentle recipes for echoes, ghosts and gods." },
    { id: "2026-11-22g", roles: ["all"], title: "Update armed says so", body: "In Effects, the button reads ✓ Updated while what's armed matches the settings, and ↻ Update armed again as soon as you change one." },
    { id: "2026-11-22f", roles: ["editor"], title: "Markers come with the sends", body: "Each reader's flubs, named markers and ✂ line ends arrive in your timeline when you bring in the sends, labelled with whose they were." },
    { id: "2026-11-22e", roles: ["team", "narrator", "cast"], title: "Your markers stay put", body: "✂ line-end markers (C) no longer vanish when you leave a chapter, and every marker now goes to the editor with your send." },
    { id: "2026-11-22d", roles: ["team", "narrator", "cast"], title: "All your booth time counts again", body: "When Google Drive split a month's booth sessions into a “(1)” copy, the app only read one of them. It reads and backs up every copy now." },
    { id: "2026-11-22c", roles: ["team"], title: "Read by on character scripts", body: "Each script on a book page says who reads its lines. The Lead sees any lines where the script and the highlighting disagree, with a Go button." },
    { id: "2026-11-22b", roles: ["team"], title: "Who's here", body: "A quiet line at the top when someone else has the same book open, and where." },
    { id: "2026-11-22a", roles: ["all"], title: "Every book has a Lead", body: "Only the Lead changes a book's text, chapters, who reads what and credits. Everyone else: Ask the Lead to fix something, on the book page or the Booth's ✎ button." },
    { id: "2026-11-22", roles: ["team"], title: "People", body: "Settings ▸ Me ▸ People: one record per person, with full name, credit name and other spellings. Cast boxes suggest names from it." },
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
