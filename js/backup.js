/* The Lamp Room — daily backups.
   Once a day each person's computer zips the Library's small files into Library/Backups/<date> <Name>.zip:
   every book.json and people file, the planner (Ledger), booth sessions and shared settings. Recordings are
   too big and live in the Studio folder, so they are not in here. Each person writes only their own zip,
   so two computers never write the same file in Drive. The last 14 daily zips per person are kept.
   Restore puts one book (or the planner) back as it was; a fresh backup is made first, so a restore can be undone. */
(function () {
  "use strict";
  const KEEP = 14, DIR = "Backups";
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const safe = s => String(s || "Me").replace(/[\\/:*?"<>|]/g, "_").trim() || "Me";
  const RE = /^(\d{4}-\d{2}-\d{2}) (.+?)( before restore \d{4})?\.zip$/;

  async function dir(create) { return Store.root.getDirectoryHandle(DIR, { create: !!create }); }
  async function put(d, name, data) { const fh = await d.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
  async function sub(d, name) { try { return await d.getDirectoryHandle(name); } catch (e) { return null; } }

  // Whoever leads a book may restore it: the "Lead narrator" on its share list, else the share owner,
  // else whoever reads the narration. A book with none of these can be restored by anyone in the Library.
  function leadOf(book) { return Store.leadOf ? Store.leadOf(book) : ""; }
  function canRestore(book) { const lead = leadOf(book); return !lead || Store.samePerson(lead, Store.me()); }

  // ---- making one ----
  async function addFolder(zip, d, path, deep) {
    for await (const [n, h] of d.entries()) {
      // Drive's "(1)" copies go in too: for sessions they can be the only copy of a month
      if (h.kind === "file" && n.endsWith(".json")) zip.file(path + n, await (await h.getFile()).text());
      else if (h.kind === "directory" && deep) await addFolder(zip, h, path + n + "/", deep);
    }
  }
  async function make(note) {
    if (!Store.root || !window.JSZip) throw new Error("No Library folder open.");
    const zip = new JSZip(), books = [];
    const booksDir = await Store.root.getDirectoryHandle("Books", { create: true });
    for await (const [folder, h] of booksDir.entries()) {
      if (h.kind !== "directory") continue;
      const copies = await Store.newestOf(h, "book", ".json"); if (!copies.length) continue;
      const text = await copies[0].f.text(); zip.file("Books/" + folder + "/book.json", text);
      let b = {}; try { b = JSON.parse(text); } catch (e) {}
      const people = [], pd = await sub(h, "people");
      if (pd) {
        const bases = new Set(); for await (const [n, fh] of pd.entries()) if (fh.kind === "file" && n.endsWith(".json")) bases.add(n.replace(/ \(\d+\)\.json$/, ".json"));
        for (const base of bases) { const c = await Store.newestOf(pd, base.replace(/\.json$/, ""), ".json"); if (!c.length) continue; zip.file("Books/" + folder + "/people/" + base, await c[0].f.text()); people.push(base.replace(/\.json$/, "")); }
      }
      books.push({ folder, id: b.id, title: b.title || folder, lead: leadOf(b), chapters: (b.chapters || []).length, updated: b.updated || "", people });
    }
    const led = await sub(Store.root, "Ledger"); if (led) await addFolder(zip, led, "Ledger/", true);
    const ses = await sub(Store.root, "Sessions"); if (ses) await addFolder(zip, ses, "Sessions/", true);
    try { zip.file("lamp-room.json", await (await (await Store.root.getFileHandle("lamp-room.json")).getFile()).text()); } catch (e) {}
    const now = new Date();
    zip.file("backup.json", JSON.stringify({ v: 1, made: now.toISOString(), by: Store.me(), note: note || "daily", app: (window.LRProblems && LRProblems.VERSION) || "", books, planner: !!led }, null, 1));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const name = dayKey(now) + " " + safe(Store.me()) + (note === "before restore" ? " before restore " + pad(now.getHours()) + pad(now.getMinutes()) : "") + ".zip";
    await put(await dir(true), name, blob);
    try { localStorage.setItem("lr-backup-last@" + Store.me(), now.toISOString()); } catch (e) {}
    await prune();
    return { name, size: blob.size, books: books.length };
  }

  // keep each person's 14 latest daily zips, and their before-restore zips for 14 days; never touch anyone else's
  async function prune() {
    const me = safe(Store.me()), d = await dir(true), mine = [], cutoff = dayKey(new Date(Date.now() - KEEP * 864e5));
    for await (const [n, h] of d.entries()) { const m = h.kind === "file" && n.match(RE); if (m && m[2].replace(/ \(\d+\)$/, "") === me) mine.push({ n, day: m[1], extra: !!m[3] }); }
    const daily = mine.filter(x => !x.extra).sort((a, b) => b.day.localeCompare(a.day));
    const gone = daily.slice(KEEP).concat(mine.filter(x => x.extra && x.day < cutoff));
    for (const x of gone) { try { await d.removeEntry(x.n); } catch (e) {} }
  }

  async function list() {
    const out = [], d = await dir(false).catch(() => null); if (!d) return out;
    for await (const [n, h] of d.entries()) {
      const m = h.kind === "file" && n.match(RE); if (!m) continue;
      const f = await h.getFile(); out.push({ name: n, day: m[1], by: m[2].replace(/ \(\d+\)$/, ""), beforeRestore: !!m[3], size: f.size, modified: f.lastModified });
    }
    return out.sort((a, b) => b.modified - a.modified);
  }
  async function open(name) {
    const f = await (await (await dir(false)).getFileHandle(name)).getFile();
    const zip = await JSZip.loadAsync(f); let info = {};
    try { info = JSON.parse(await zip.file("backup.json").async("string")); } catch (e) {}
    return { zip, info };
  }

  // ---- once a day, quietly ----
  function due() { try { const t = localStorage.getItem("lr-backup-last@" + Store.me()); return !t || dayKey(new Date(t)) !== dayKey(new Date()); } catch (e) { return true; } }
  async function existsToday() { try { await (await dir(false)).getFileHandle(dayKey(new Date()) + " " + safe(Store.me()) + ".zip"); return true; } catch (e) { return false; } }
  let timer = null;
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!Store.root || !Store.me()) return schedule(60000);
      if (window.Booth && Booth.state && Booth.state.rec) return schedule(120000);   // never while recording
      if (!due()) return schedule(3600000);
      try { if (!(await existsToday())) await make("daily"); else localStorage.setItem("lr-backup-last@" + Store.me(), new Date().toISOString()); schedule(3600000); }
      catch (e) { window.LRProblems && LRProblems.add("backup", "Daily backup failed: " + e.message, e.stack); schedule(600000); }
    }, ms);
  }
  function start() { schedule(Store.testMode ? 1500 : 20000); }

  // ---- restoring ----
  async function restoreBook(name, folder, people) {
    const { zip, info } = await open(name);
    const bf = zip.file("Books/" + folder + "/book.json"); if (!bf) throw new Error("That backup doesn't hold this book.");
    const rec = JSON.parse(await bf.async("string")), live = Store.books.find(b => b.folder === folder || (rec.id && b.id === rec.id));
    if (live && !canRestore(live)) throw new Error("Only " + leadOf(live) + " (the Lead) can restore this book.");
    if (!live && !canRestore(rec)) throw new Error("Only " + leadOf(rec) + " (the Lead) can restore this book.");
    if (window.Booth && Booth.state && Booth.state.book && live && Booth.state.book.id === live.id) throw new Error("Close the Booth on this book first.");
    const safety = await make("before restore");
    // stamp it as the newest version, so the other computer takes it rather than writing its older copy back
    rec.updated = new Date().toISOString();
    const booksDir = await Store.root.getDirectoryHandle("Books", { create: true }), h = await booksDir.getDirectoryHandle(folder, { create: true });
    await put(h, "book.json", JSON.stringify(rec, null, 1)); delete Store._written[folder + "/book.json"];
    for (const p of people || []) {
      const pf = zip.file("Books/" + folder + "/people/" + p + ".json"); if (!pf) continue;
      await put(await h.getDirectoryHandle("people", { create: true }), p + ".json", await pf.async("string")); delete Store._written[folder + "/people/" + p + ".json"];
    }
    const b = await Store.readBook(h, folder);
    const i = Store.books.findIndex(x => x.folder === folder); if (i >= 0) Store.books[i] = b; else Store.books.push(b);
    if (b.shared && Store.samePerson(b.sharedOwner, Store.me())) { try { await Store.writeProject(b); } catch (e) {} }
    document.dispatchEvent(new CustomEvent("lr-external", { detail: ["book:" + b.id] }));
    return { book: b, from: info.made, safety: safety.name };
  }
  // The planner goes back exactly as it was: entries added since then are removed (they're in the safety backup).
  async function restorePlanner(name) {
    const { zip, info } = await open(name);
    const files = Object.keys(zip.files).filter(p => p.startsWith("Ledger/") && p.endsWith(".json"));
    if (!files.length) throw new Error("That backup has no planner in it.");
    const safety = await make("before restore");
    const led = await Store.root.getDirectoryHandle("Ledger", { create: true }), keep = {};
    for (const p of files) {
      const parts = p.split("/"), fname = parts.pop(); let d = led;
      for (const s of parts.slice(1)) d = await d.getDirectoryHandle(s, { create: true });
      await put(d, fname, await zip.file(p).async("string")); delete Store._written[p];
      (keep[parts.slice(1).join("/")] = keep[parts.slice(1).join("/")] || new Set()).add(fname);
    }
    for (const c of Store.LL_COLLS) {
      const d = await sub(led, c); if (!d) continue; const k = keep[c] || new Set(), drop = [];
      for await (const [n, h] of d.entries()) if (h.kind === "file" && n.endsWith(".json") && !k.has(n)) drop.push(n);
      for (const n of drop) { try { await d.removeEntry(n); } catch (e) {} delete Store._written["Ledger/" + c + "/" + n]; }
    }
    await Store.loadLedger();
    document.dispatchEvent(new CustomEvent("lr-external", { detail: Store.LL_COLLS.concat(["config"]) }));
    return { from: info.made, safety: safety.name };
  }

  window.LRBackup = { make, list, open, prune, start, restoreBook, restorePlanner, leadOf, canRestore, last() { try { return localStorage.getItem("lr-backup-last@" + Store.me()) || ""; } catch (e) { return ""; } }, KEEP };
})();
