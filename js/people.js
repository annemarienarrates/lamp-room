/* The Lamp Room — people.
   One record per person, kept in the shared settings (lamp-room.json → people):
     { id, name (short, what the app shows), full, credit, aka: [other spellings], pace (typed fallback), team (works in this Library) }
   "Settings ▸ Narrators" used to hold the team; it's now written from People (team members, in order), so everything
   that reads it carries on. Names on books (cast names, share lists, parts) still hold plain names: a record is found by
   any of its spellings, so "Anne", "Anne Marie" and "Anne Marie Lebeaur" are one person, and two Annes are two. */
(function () {
  "use strict";
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const S = () => Store.settings;
  const list = () => S().people || [];
  const uid = () => "p" + Math.random().toString(36).slice(2, 9);
  const spellings = p => [p.name, p.full, p.credit, ...(p.aka || [])].map(norm).filter(Boolean);

  function find(name) { const n = norm(name); if (!n) return null; return list().find(p => spellings(p).includes(n)) || null; }
  // true / false when both names belong to records; null when we can't tell (then the old first-name rule decides)
  function same(a, b) { const A = find(a), B = find(b); return A && B ? A === B : null; }
  function creditOf(name) { const p = find(name); return p ? (p.credit || p.full || p.name) : name; }
  function nameOf(name) { const p = find(name); return p ? p.name : name; }
  function paceOf(name) { const p = find(name); return p && +p.pace ? +p.pace : null; }

  // the team list the rest of the app reads, written from People
  function mirror() {
    const old = S().narrators || [];
    const next = list().filter(p => p.team).map(p => { const o = old.find(x => norm(x.name) === norm(p.name)) || {}; return Object.assign({}, o, { name: p.name, pace: +p.pace || o.pace || 3000, credit: p.credit || "" }); });
    if (next.length) S().narrators = next;
  }
  // every name the Library's books mention: cast names, share lists, parts
  function namesInBooks() {
    const out = [];
    for (const b of Store.books || []) {
      for (const v of Object.values(b.castNames || {})) if (v) out.push({ name: v, from: b.title });
      for (const x of b.sharedPeople || []) if (x.name) out.push({ name: x.name, from: b.title, role: x.role });
      for (const v of Object.values(b.parts || {})) if (v && !/^Cast \d+$/.test(v)) out.push({ name: v, from: b.title });
    }
    return out;
  }
  // a name nobody has yet: matches an existing record by the old first-name rule, or needs a new one
  function closest(name) { const n = norm(name), first = n.split(" ")[0]; return list().find(p => spellings(p).some(s => s === n || (s.split(" ").length === 1 || n.split(" ").length === 1) && s.split(" ")[0] === first)) || null; }
  function unknown() { const seen = new Set(), out = []; for (const x of namesInBooks()) { const k = norm(x.name); if (seen.has(k) || find(x.name)) continue; seen.add(k); out.push(x); } return out; }
  function add(rec) { const p = Object.assign({ id: uid(), name: "", full: "", credit: "", aka: [], pace: "", team: false }, rec); S().people = list().concat([p]); return p; }
  function addAka(p, name) { if (!spellings(p).includes(norm(name))) p.aka = (p.aka || []).concat([String(name).trim()]); }

  // First run: build People from the team and everyone the books mention. Later loads: add team members that only
  // exist in the old list (a tab from before People wrote them), never remove anyone.
  // People holds only who works in this Library (you, Jack). Cast and co-narrators live on each book. A Library from
  // before this kept everyone the books mentioned: those records go (the books keep the names), the team stays.
  function reconcile() {
    let changed = false;
    if (!Array.isArray(S().people) || (!S().people.length && (S().narrators || []).some(n => n.name && n.name !== "Me"))) {
      S().people = [];
      for (const n of S().narrators || []) {
        if (!n.name || n.name === "Me") continue;
        const credit = n.credit || "", full = credit.split(" ").length > 1 && norm(credit).startsWith(norm(n.name).split(" ")[0]) ? credit : "";
        add({ name: n.name, full, credit, pace: n.pace || "", team: true });
      }
      changed = true;
    } else {
      if (list().some(p => !p.team) && list().some(p => p.team)) { S().people = list().filter(p => p.team); changed = true; }
      for (const n of S().narrators || []) if (n.name && n.name !== "Me" && !find(n.name)) { add({ name: n.name, credit: n.credit || "", pace: n.pace || "", team: true }); changed = true; }
    }
    if (changed) { mirror(); Store.saveSettings().catch(() => {}); }
    return changed;
  }

  window.LRPeople = { find, same, creditOf, nameOf, paceOf, mirror, reconcile, unknown, closest, add, addAka, list, namesInBooks, norm };

  // once the Library has loaded (settings and books), make sure People is there
  const load0 = Store.load;
  // (on a computer's first run of this version, the backup below goes first and runs this after it)
  Store.load = async function () { const r = await load0.apply(this, arguments); try { if (Store.testMode || localStorage.getItem("lr-fmt2-backup")) reconcile(); } catch (e) { console.warn("people", e); } return r; };
})();

/* ---- the book's Lead ----
   Each book names its Lead (book.lead). Until a Lead saves it, it's worked out: a shared book's lead (its people list,
   else the folder's owner), else whoever reads the narration if they work here, else the first person who works here.
   Only the Lead changes the book itself; everyone keeps their own recordings, takes, progress and notes. */
(function () {
  "use strict";
  function leadOf(book) {
    if (!book) return "";
    if (book.lead) return book.lead;
    const p = (book.sharedPeople || []).find(x => x.role === "lead");
    if (book.shared) return (p && p.name) || book.sharedOwner || "";
    const n = (book.parts || {}).n, team = (Store.settings.narrators || []).map(x => x.name);
    if (n && team.some(t => Store.samePerson(t, n))) return LRPeople.nameOf(n);
    return team[0] || "";
  }
  // nobody named, or no one signed in yet: don't lock anyone out
  function isLead(book) { const l = leadOf(book), me = Store.me(); return !l || !me || Store.samePerson(l, me); }
  Object.assign(Store, { leadOf, isLead });

  // ---- notes to the Lead: kept in the asker's own people file (book.asks[person]); the Lead clears them in book.json ----
  // In a shared project co-narrators and cast keep their own Lamp Rooms, so their notes also go into the book's shared
  // folder (Asks/<Name>.json), and the Lead's "done" goes back the same way (Asks/_done.json). Read on the book page.
  const remote = {};                                   // book id → { asks: { who: [..] }, done: [ids], at }
  const safeN = s => String(s || "Someone").replace(/[\\/:*?"<>|]/g, "_");
  async function asksDir(book, create) { if (!book.shared) return null; const h = await Store.sharedHandle(book); if (!h) return null; try { return await h.getDirectoryHandle("Asks", { create: !!create }); } catch (e) { return null; } }
  async function putJson(d, name, v) { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(JSON.stringify(v)); await w.close(); }
  async function pullShared(book) {
    const d = await asksDir(book, false), r = { asks: {}, done: [], at: Date.now() }; if (!d) { remote[book.id] = r; return r; }
    for await (const [n, fh] of d.entries()) {
      if (fh.kind !== "file" || !n.endsWith(".json")) continue;
      try { const v = JSON.parse(await (await fh.getFile()).text()); if (n === "_done.json") r.done = Array.isArray(v) ? v : []; else if (Array.isArray(v)) r.asks[n.replace(/\.json$/, "")] = v; } catch (e) {}
    }
    remote[book.id] = r; return r;
  }
  // after asking: true once the Lead can see it (same Library, or the shared folder took it)
  async function deliver(book) {
    if (!book.shared || Store.samePerson(book.sharedOwner, Store.me())) return true;
    const d = await asksDir(book, true); if (!d) return false;
    try { await putJson(d, safeN(Store.me()) + ".json", (book.asks || {})[Store.me()] || []); await pullShared(book); return true; } catch (e) { return false; }
  }
  async function pushDone(book) { const d = await asksDir(book, true); if (d) try { await putJson(d, "_done.json", book.asksDone || []); } catch (e) {} }
  function sig(book) { return JSON.stringify(remote[book.id] || null); }
  function openAsks(book) {
    const r = remote[book.id] || { asks: {}, done: [] }, done = new Set([...(book.asksDone || []), ...r.done]), out = [], seen = new Set();
    for (const src of [book.asks || {}, r.asks]) for (const who in src) for (const a of src[who] || []) if (!done.has(a.id) && !seen.has(a.id)) { seen.add(a.id); out.push(Object.assign({ who }, a)); }
    return out.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  }
  function ask(book, text, ch) {
    const me = Store.me() || "Someone", a = { id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), text: String(text).trim() };
    if (ch != null && book.chapters[ch]) { a.ch = book.chapters[ch].id; a.chTitle = book.chapters[ch].title; }
    book.asks = book.asks || {}; (book.asks[me] = book.asks[me] || []).push(a);
    return a;
  }
  function clearAsk(book, id) { book.asksDone = (book.asksDone || []).concat([id]); if (book.shared) pushDone(book).then(() => pullShared(book)); }
  Object.assign(window.LRPeople, { openAsks, ask, clearAsk, deliver, pullShared, sharedSig: sig, remoteAt: book => (remote[book.id] || {}).at || 0 });
})();

// The first save by a book's Lead writes their name into it, so the Lead stays put even if the parts change later.
// The format stamp: each book.json says which format wrote it (book.fmt). A tab running older code than the book's
// format won't save over it; it asks for a reload instead. Every save from here on stamps the current format.
(function () {
  const FMT = 2; Store.FMT = FMT;
  const save0 = Store.saveBook; let warned = false;
  Store.saveBook = function (book) {
    if (book && +book.fmt > FMT) { if (!warned && window.toast) { warned = true; toast("“" + book.title + "” was saved by a newer Lamp Room. Reload this page to get the update: nothing was saved."); } return; }
    try { if (book) book.fmt = FMT; if (book && !book.lead && Store.me() && Store.isLead(book) && Store.leadOf(book)) book.lead = Store.leadOf(book); } catch (e) {}
    return save0.apply(this, arguments);
  };
  // one backup on each computer before the first save in the new format
  const load1 = Store.load;
  Store.load = async function () {
    const r = await load1.apply(this, arguments);
    if (!Store.testMode && !localStorage.getItem("lr-fmt2-backup")) {
      try { if (window.LRBackup && Store.me()) await LRBackup.make("before the People update"); } catch (e) { console.warn("backup before update", e); }
      try { localStorage.setItem("lr-fmt2-backup", "1"); } catch (e) {}
      try { LRPeople.reconcile(); } catch (e) { console.warn("people", e); }
    }
    return r;
  };
})();
