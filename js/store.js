/* The Lamp Room — storage. Everything lives as plain files in a library folder the user picks (share it through
   Google Drive and both computers see the same titles, schedule, ledger and duet lines):
     <Library>/lamp-room.json                 settings
     <Library>/Books/<Book folder>/book.json   one book: manuscript, chapters, shared details
     <Library>/Books/<Book folder>/people/<Name>.json   one person's progress, timelines and tracks for that book
                                              (each computer writes only what it changed, so two people can work at once)
     <Library>/Ledger/<collection>/<id>.json  the business side, one file per record (titles, logs, bills, deposits…)
     <Library>/Covers/<title id>.jpg          cover images
     <Library>/Books/<Book folder>/manuscript/  the original file you imported
     <Library>/Books/<Book folder>/audio/       recordings (Booth & Studio, coming next)
     <Library>/Books/<Book folder>/exports/     deliverables
   The folder handle is remembered in IndexedDB so the browser can reopen it with one click. */
(function () {
  "use strict";
  const DEFAULT_SETTINGS = {
    version: 1,
    theme: "ledger",
    confetti: true,
    encouragement: true,
    wpfh: 9300,                 // words per finished hour
    boothHoursPerDay: 6,
    narrators: [{ name: "Anne", pace: 4035 }, { name: "Jack", pace: 2000 }],
    namePattern: "{book} - {nn} - {chapter}"
  };
  // Look & feel belongs to a person, not the shared folder: each of you keeps your own on each computer
  // (and two people sharing one computer each keep theirs).
  const PERSONAL = ["theme", "readFont", "confetti", "encouragement", "celebrations", "combo", "comboHidden", "calm", "goalEarn", "duet"];
  // browser-remembered things that are also personal (hotkeys, text size, track height, zoom, pre-roll…)
  const PERSONAL_LS = /^lr-(keys|tzoom|laneh|preroll|follow|pps|fxp|combo-best|last-book|opened|arch-open|dash-mode|dash-sort)$/;
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

  // ---- tiny IndexedDB key/value for the folder handle ----
  const idb = {
    db: null,
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((res, rej) => { const r = indexedDB.open("lamp-room", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      return this.db;
    },
    async get(k) { const db = await this.open(); return new Promise((res, rej) => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  };

  const safeId = s => String(s).replace(/[^\w.-]+/g, "_");
  const safeFolder = s => String(s || "Untitled").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";

  async function readJson(dir, name) {
    try { const fh = await dir.getFileHandle(name); const f = await fh.getFile(); return JSON.parse(await f.text()); }
    catch (e) { if (e.name === "NotFoundError") return null; throw e; }
  }
  async function writeFile(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
  }

  const Store = {
    root: null, settings: Object.assign({}, DEFAULT_SETTINGS), books: [], testMode: false, lastError: null,
    supported: typeof window.showDirectoryPicker === "function",

    // → "ready" | "needs-permission" | "no-folder" | "unsupported"
    async init() {
      this.testMode = /[?&]test\b/.test(location.search);
      if (this.testMode && navigator.storage && navigator.storage.getDirectory) { this.root = await navigator.storage.getDirectory(); await this.load(); return "ready"; }
      if (!this.supported) return "unsupported";
      const h = await idb.get("root").catch(() => null);
      if (!h) return "no-folder";
      this.root = h;
      if ((await h.queryPermission({ mode: "readwrite" })) === "granted") { await this.load(); return "ready"; }
      return "needs-permission";
    },
    folderName() { return this.root ? this.root.name : ""; },
    async pickFolder() {
      const h = await window.showDirectoryPicker({ id: "lamp-room-library", mode: "readwrite", startIn: "documents" });
      await idb.set("root", h); this.root = h; await this.load();
    },
    async reopen() {
      if ((await this.root.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Permission wasn't granted.");
      await this.load();
    },
    async load() {
      const s = await readJson(this.root, "lamp-room.json");
      this.setShared(s || {});
      if (!s) await this.saveSettings();
      const booksDir = await this.root.getDirectoryHandle("Books", { create: true });
      this.books = [];
      for await (const [name, h] of booksDir.entries()) {
        if (h.kind !== "directory") continue;
        try { const b = await this.readBook(h, name); if (b) this.books.push(b); }
        catch (e) { console.warn("Couldn't read", name, e); }
      }
      this.books.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
      await this.loadLedger();
    },
    // ---- a book is book.json plus one file per person ----
    _written: {},                 // path → last text this computer read or wrote (so unchanged files aren't rewritten)
    _seen: {},                    // path → lastModified when last read (to spot changes arriving from the other computer)
    async readText(dir, name, path) {
      try { const f = await (await dir.getFileHandle(name)).getFile(); const t = await f.text(); this._written[path] = t; this._seen[path] = f.lastModified; return t; }
      catch (e) { if (e.name === "NotFoundError") return null; throw e; }
    },
    async readBook(h, folder) {
      const t = await this.readText(h, "book.json", folder + "/book.json"); if (!t) return null;
      const b = JSON.parse(t); b.folder = folder;
      try {
        const pd = await h.getDirectoryHandle("people");
        for await (const [n, fh] of pd.entries()) {
          if (fh.kind !== "file" || !n.endsWith(".json")) continue;
          const pt = await this.readText(pd, n, folder + "/people/" + n); if (!pt) continue;
          const p = JSON.parse(pt), who = p.person || n.replace(/\.json$/, "");
          if (p.trackSet) { b.trackSet = b.trackSet || {}; b.trackSet[who] = p.trackSet; }
          for (const c of b.chapters || []) { const x = (p.chapters || {})[c.id]; if (!x) continue;
            if (x.prog) { c.prog = c.prog || {}; c.prog[who] = x.prog; }
            if (x.audio) { c.audio = c.audio || {}; c.audio[who] = x.audio; } }
        }
      } catch (e) { if (e.name !== "NotFoundError") console.warn(e); }
      return b;
    },
    splitBook(book) {
      const people = {}, P = n => people[n] = people[n] || { person: n, chapters: {}, trackSet: null };
      const shared = JSON.parse(JSON.stringify(book));
      delete shared.folder;
      for (const n in (shared.trackSet || {})) P(n).trackSet = shared.trackSet[n];
      delete shared.trackSet;
      for (const c of shared.chapters || []) {
        for (const n in (c.prog || {})) (P(n).chapters[c.id] = P(n).chapters[c.id] || {}).prog = c.prog[n];
        for (const n in (c.audio || {})) (P(n).chapters[c.id] = P(n).chapters[c.id] || {}).audio = c.audio[n];
        delete c.prog; delete c.audio;
      }
      return { shared, people };
    },
    async writeIfChanged(dir, name, path, text) {
      if (this._written[path] === text) return false;
      await writeFile(dir, name, text); this._written[path] = text;
      try { this._seen[path] = (await (await dir.getFileHandle(name)).getFile()).lastModified; } catch (e) {}
      return true;
    },
    async writeBook(book) {
      const d = await this.bookDir(book), { shared, people } = this.splitBook(book);
      const sharedText = JSON.stringify(shared, null, 1);
      // "updated" changes on every save; only count it as a change when something else did
      const prev = this._written[book.folder + "/book.json"];
      if (prev) { try { const o = JSON.parse(prev); o.updated = shared.updated; if (JSON.stringify(o, null, 1) === sharedText) { /* nothing shared changed */ } else await this.writeIfChanged(d, "book.json", book.folder + "/book.json", sharedText); } catch (e) { await this.writeIfChanged(d, "book.json", book.folder + "/book.json", sharedText); } }
      else await this.writeIfChanged(d, "book.json", book.folder + "/book.json", sharedText);
      const names = Object.keys(people);
      if (names.length) {
        const pd = await d.getDirectoryHandle("people", { create: true });
        for (const n of names) await this.writeIfChanged(pd, safeFolder(n) + ".json", book.folder + "/people/" + safeFolder(n) + ".json", JSON.stringify(people[n], null, 1));
      }
    },
    // shared settings from the folder, then this person's own look & feel on top
    setShared(s) {
      this._shared = clone(s) || {};
      const next = Object.assign({}, DEFAULT_SETTINGS, clone(s));
      for (const k in this.settings) delete this.settings[k];
      Object.assign(this.settings, next);
      this.applyPrefs();
    },
    prefs() { try { return JSON.parse(localStorage.getItem("lr-prefs@" + this.me()) || "null"); } catch (e) { return null; } },
    applyPrefs() {
      let p = this.prefs();
      if (!p) { p = {}; PERSONAL.forEach(k => { if (this._shared && this._shared[k] !== undefined) p[k] = clone(this._shared[k]); }); }
      PERSONAL.forEach(k => { const v = p[k] !== undefined ? clone(p[k]) : DEFAULT_SETTINGS[k]; if (v === undefined) delete this.settings[k]; else this.settings[k] = v; });
    },
    PERSONAL,
    async saveSettings() {
      const p = {}; PERSONAL.forEach(k => { if (this.settings[k] !== undefined) p[k] = clone(this.settings[k]); });
      try { if (this.me()) localStorage.setItem("lr-prefs@" + this.me(), JSON.stringify(p)); } catch (e) {}
      const shared = clone(this.settings); PERSONAL.forEach(k => { if (this._shared && this._shared[k] !== undefined) shared[k] = clone(this._shared[k]); else delete shared[k]; });
      const t = JSON.stringify(shared, null, 2); if (t === this._written["lamp-room.json"]) return;
      await writeFile(this.root, "lamp-room.json", t); this._written["lamp-room.json"] = t;
    },
    // localStorage, with the personal keys kept per person (falls back to the old shared value once)
    lsKey(k) { return PERSONAL_LS.test(k) ? k + "@" + this.me() : k; },
    lsGet(k) { try { const v = localStorage.getItem(this.lsKey(k)); return v !== null || !PERSONAL_LS.test(k) ? v : localStorage.getItem(k); } catch (e) { return null; } },
    lsSet(k, v) { try { localStorage.setItem(this.lsKey(k), v); } catch (e) {} },
    lsDel(k) { try { localStorage.removeItem(this.lsKey(k)); } catch (e) {} },

    async bookDir(book, sub) {
      const booksDir = await this.root.getDirectoryHandle("Books", { create: true });
      const d = await booksDir.getDirectoryHandle(book.folder, { create: true });
      return sub ? d.getDirectoryHandle(sub, { create: true }) : d;
    },
    _timers: {},
    // debounced save; call flush to force
    saveBook(book, now) {
      book.updated = new Date().toISOString();
      clearTimeout(this._timers[book.id]);
      const run = async () => {
        try { await this.writeBook(book); this.lastError = null; document.dispatchEvent(new CustomEvent("lr-saved")); }
        catch (e) { this.lastError = e; document.dispatchEvent(new CustomEvent("lr-save-error", { detail: e })); }
      };
      if (now) return run();
      this._timers[book.id] = setTimeout(run, 400);
    },
    async createBook(book, originalFile) {
      const booksDir = await this.root.getDirectoryHandle("Books", { create: true });
      let base = safeFolder(book.title), name = base, n = 2;
      while (true) { try { await booksDir.getDirectoryHandle(name); name = base + " (" + n++ + ")"; } catch (e) { break; } }
      book.folder = name;
      const dir = await booksDir.getDirectoryHandle(name, { create: true });
      for (const sub of ["manuscript", "audio", "exports"]) await dir.getDirectoryHandle(sub, { create: true });
      if (originalFile) { try { await writeFile(await dir.getDirectoryHandle("manuscript"), safeFolder(originalFile.name), originalFile); } catch (e) { console.warn(e); } }
      book.created = book.updated = new Date().toISOString();
      await this.writeBook(book);
      this.books.unshift(book);
      return book;
    },
    byId(id) { return this.books.find(b => b.id === id); },

    // ---- who this computer belongs to (acts as the login; remembered per computer) ----
    me() { try { return localStorage.getItem("lr-me") || ""; } catch (e) { return ""; } },
    setMe(name) {
      const was = this.me(); try { localStorage.setItem("lr-me", name); } catch (e) {}
      if (was !== name) { this.applyPrefs(); document.dispatchEvent(new CustomEvent("lr-me", { detail: { from: was, to: name } })); }
    },

    // ---- Studio folder: recordings live here, on this computer only ----
    studio: null,
    async studioStatus() {
      if (this.studio) return "ready";
      if (this.testMode) { this.studio = await this.root.getDirectoryHandle("_studio", { create: true }); return "ready"; }
      const h = await idb.get("studio").catch(() => null);
      if (!h) return "none";
      this.studio = h;
      if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return "ready";
      this.studio = null; this._studioPending = h; return "needs-permission";
    },
    async pickStudio() {
      const h = await window.showDirectoryPicker({ id: "lamp-room-studio", mode: "readwrite", startIn: "music" });
      await idb.set("studio", h); this.studio = h;
    },
    async reopenStudio() {
      const h = this._studioPending; if (!h) return this.pickStudio();
      if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Permission wasn't granted.");
      this.studio = h;
    },
    // folder for one chapter's audio: <Studio>/<Book folder>/audio/<chapter id>/
    async chapterAudioDir(book, chapter) {
      const b = await this.studio.getDirectoryHandle(book.folder, { create: true });
      const a = await b.getDirectoryHandle("audio", { create: true });
      return a.getDirectoryHandle(chapter.id, { create: true });
    },

    // ---- moving one person's recordings between computers (after sharing one booth for a while) ----
    takesOf(person) {
      const out = [];
      for (const b of this.books) for (const c of b.chapters || []) {
        const a = c.audio && c.audio[person]; if (!a) continue;
        const seen = new Set(); JSON.stringify(a).replace(/"([^"\/]+\.wav)"/g, (m, f) => { seen.add(f); return m; });
        seen.forEach(f => out.push({ book: b, chap: c, file: f }));
      }
      return out;
    },
    // copies that person's takes into dest/<Book folder>/audio/<chapter id>/ — skips files already there
    async exportTakes(person, dest, prog) {
      const list = this.takesOf(person); let done = 0, copied = 0, missing = 0;
      for (const t of list) {
        try {
          const src = await (await this.chapterAudioDir(t.book, t.chap)).getFileHandle(t.file).then(h => h.getFile());
          const d = await (await (await dest.getDirectoryHandle(t.book.folder, { create: true })).getDirectoryHandle("audio", { create: true })).getDirectoryHandle(t.chap.id, { create: true });
          let have = null; try { have = await (await d.getFileHandle(t.file)).getFile(); } catch (e) {}
          if (!have || have.size !== src.size) { await writeFile(d, t.file, src); copied++; }
        } catch (e) { missing++; }
        done++; if (prog) prog(done, list.length);
      }
      return { total: list.length, copied, missing };
    },
    // merges a copied recordings folder into this computer's Studio — never overwrites a file that's already here
    async importTakes(src, prog) {
      let copied = 0, skipped = 0;
      const walk = async (from, to) => {
        for await (const [n, h] of from.entries()) {
          if (h.kind === "directory") await walk(h, await to.getDirectoryHandle(n, { create: true }));
          else if (/\.(wav|mp3|json)$/i.test(n)) {
            let have = false; try { await to.getFileHandle(n); have = true; } catch (e) {}
            if (have) skipped++; else { await writeFile(to, n, await h.getFile()); copied++; if (prog) prog(copied); }
          }
        }
      };
      await walk(src, this.studio);
      return { copied, skipped };
    },

    // ---- the business side (Ledger & Lamp): <Library>/Ledger/<collection>/<id>.json and Ledger/config.json ----
    LL_COLLS: ["titles", "logs", "fh", "bills", "daysoff", "pipeline", "deposits"],
    ll: { titles: [], logs: [], fh: [], bills: [], daysoff: [], pipeline: [], deposits: [], config: null },
    async ledgerDir(coll) { const l = await this.root.getDirectoryHandle("Ledger", { create: true }); return coll ? l.getDirectoryHandle(coll, { create: true }) : l; },
    async loadLedger() {
      for (const c of this.LL_COLLS) {
        const d = await this.ledgerDir(c), list = [];
        for await (const [n, h] of d.entries()) {
          if (h.kind !== "file" || !n.endsWith(".json")) continue;
          try { const t = await this.readText(d, n, "Ledger/" + c + "/" + n); if (t) list.push(Object.assign(JSON.parse(t), { id: n.slice(0, -5) })); } catch (e) { console.warn("Couldn't read", c, n, e); }
        }
        this.ll[c] = list;
      }
      const t = await this.readText(await this.ledgerDir(), "config.json", "Ledger/config.json");
      this.ll.config = t ? JSON.parse(t) : null;
    },
    async llPut(coll, id, data) {
      const rec = Object.assign({}, data); delete rec.id;
      if (coll === "config") { this.ll.config = rec; await this.writeIfChanged(await this.ledgerDir(), "config.json", "Ledger/config.json", JSON.stringify(rec, null, 1)); return true; }
      const list = this.ll[coll], i = list.findIndex(x => x.id === id), full = Object.assign({}, rec, { id });
      if (i >= 0) list[i] = full; else list.push(full);
      await this.writeIfChanged(await this.ledgerDir(coll), safeId(id) + ".json", "Ledger/" + coll + "/" + safeId(id) + ".json", JSON.stringify(rec, null, 1));
      return true;
    },
    async llPatch(coll, id, data) {
      if (coll === "config") return this.llPut("config", "main", Object.assign({}, this.ll.config || {}, data));
      const cur = this.ll[coll].find(x => x.id === id) || {};
      return this.llPut(coll, id, Object.assign({}, cur, data));
    },
    async llDel(coll, id) {
      this.ll[coll] = this.ll[coll].filter(x => x.id !== id);
      try { await (await this.ledgerDir(coll)).removeEntry(safeId(id) + ".json"); } catch (e) {}
      delete this._written["Ledger/" + coll + "/" + safeId(id) + ".json"];
    },

    // ---- covers: <Library>/Covers/<title id>.jpg, resized on the way in ----
    _covers: {},
    async setCover(titleId, file) {
      const img = await createImageBitmap(file), max = 800, k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.86));
      const d = await this.root.getDirectoryHandle("Covers", { create: true });
      await writeFile(d, safeId(titleId) + ".jpg", blob);
      if (this._covers[titleId]) URL.revokeObjectURL(this._covers[titleId].url);
      this._covers[titleId] = { url: URL.createObjectURL(blob), at: Date.now() };
      document.dispatchEvent(new CustomEvent("lr-cover", { detail: titleId }));
    },
    async removeCover(titleId) {
      try { await (await this.root.getDirectoryHandle("Covers")).removeEntry(safeId(titleId) + ".jpg"); } catch (e) {}
      if (this._covers[titleId]) URL.revokeObjectURL(this._covers[titleId].url);
      this._covers[titleId] = { url: null, at: Date.now() };
    },
    // object URL for a title's cover, or null; cached, checked again now and then
    async coverURL(titleId) {
      if (!titleId) return null;
      const c = this._covers[titleId]; if (c && Date.now() - c.at < 60000) return c.url;
      try {
        const f = await (await (await this.root.getDirectoryHandle("Covers", { create: true })).getFileHandle(safeId(titleId) + ".jpg")).getFile();
        if (c && c.mod === f.lastModified) { c.at = Date.now(); return c.url; }
        if (c && c.url) URL.revokeObjectURL(c.url);
        this._covers[titleId] = { url: URL.createObjectURL(f), at: Date.now(), mod: f.lastModified };
      } catch (e) { this._covers[titleId] = { url: null, at: Date.now() }; }
      return this._covers[titleId].url;
    },

    // ---- changes arriving from the other computer (through Drive): look every 20 s and when the window comes back ----
    async checkExternal() {
      if (!this.root || this._checking) return [];
      this._checking = true; const changed = [];
      try {
        const look = async (dir, name, path) => { try { const f = await (await dir.getFileHandle(name)).getFile(); if (this._seen[path] && f.lastModified > this._seen[path]) { const t = await f.text(); this._seen[path] = f.lastModified; if (t !== this._written[path]) { this._written[path] = t; return t; } } else if (!this._seen[path]) { this._seen[path] = f.lastModified; const t = await f.text(); if (t !== this._written[path]) { this._written[path] = t; return t; } } } catch (e) {} return null; };
        // books (new folders too)
        const booksDir = await this.root.getDirectoryHandle("Books", { create: true });
        for await (const [name, h] of booksDir.entries()) {
          if (h.kind !== "directory") continue;
          const known = this.books.find(b => b.folder === name);
          if (!known) { const b = await this.readBook(h, name).catch(() => null); if (b) { this.books.push(b); changed.push("book:" + b.id); } continue; }
          let dirty = !!(await look(h, "book.json", name + "/book.json"));
          try { const pd = await h.getDirectoryHandle("people"); for await (const [n, f] of pd.entries()) if (f.kind === "file" && await look(pd, n, name + "/people/" + n)) dirty = true; } catch (e) {}
          if (dirty && !(window.Booth && Booth.state && Booth.state.book && Booth.state.book.id === known.id)) {
            const b = await this.readBook(h, name); if (b) { const i = this.books.indexOf(known); this.books[i] = b; changed.push("book:" + b.id); }
          }
        }
        // ledger
        for (const c of this.LL_COLLS) {
          const d = await this.ledgerDir(c), names = new Set();
          for await (const [n, h] of d.entries()) {
            if (h.kind !== "file" || !n.endsWith(".json")) continue; names.add(n);
            const t = await look(d, n, "Ledger/" + c + "/" + n);
            if (t) { try { const rec = Object.assign(JSON.parse(t), { id: n.slice(0, -5) }), list = this.ll[c], i = list.findIndex(x => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec); changed.push(c); } catch (e) {} }
          }
          const before = this.ll[c].length; this.ll[c] = this.ll[c].filter(x => names.has(safeId(x.id) + ".json")); if (this.ll[c].length !== before) changed.push(c);
        }
        const t = await look(await this.ledgerDir(), "config.json", "Ledger/config.json"); if (t) { try { this.ll.config = JSON.parse(t); changed.push("config"); } catch (e) {} }
        const st = await look(this.root, "lamp-room.json", "lamp-room.json"); if (st) { try { this.setShared(JSON.parse(st)); changed.push("settings"); } catch (e) {} }
      } finally { this._checking = false; }
      if (changed.length) document.dispatchEvent(new CustomEvent("lr-external", { detail: changed }));
      return changed;
    },
    watch() {
      if (this._watching) return; this._watching = true;
      setInterval(() => { if (document.visibilityState === "visible") this.checkExternal().catch(() => {}); }, 20000);
      window.addEventListener("focus", () => this.checkExternal().catch(() => {}));
    },

    // ---- duet lines: <Library>/Books/<book>/duet/<chapter id>/<reader>/ (lines.json + one WAV per line).
    //      The Library is the folder you and your co-narrator share, so lines sent on one computer appear on the other.
    async duetDir(book, chapter, reader, create) {
      const opt = { create: !!create };
      const booksDir = await this.root.getDirectoryHandle("Books", { create: true });
      const b = await booksDir.getDirectoryHandle(book.folder, opt), d = await b.getDirectoryHandle("duet", opt), c = await d.getDirectoryHandle(chapter.id, opt);
      return c.getDirectoryHandle(safeFolder(reader), opt);
    },

    // ---- booth sessions: Sessions/<person>/<YYYY-MM>.json (written only by that person) ----
    async sessionFile(person, ym, create) {
      const s = await this.root.getDirectoryHandle("Sessions", { create: true });
      const d = await s.getDirectoryHandle(safeFolder(person), { create: true });
      return { dir: d, name: ym + ".json" };
    },
    async saveSession(person, sess) {
      const ym = sess.date.slice(0, 7);
      const { dir, name } = await this.sessionFile(person, ym, true);
      const list = (await readJson(dir, name)) || [];
      const i = list.findIndex(x => x.id === sess.id);
      if (i >= 0) list[i] = sess; else list.push(sess);
      await writeFile(dir, name, JSON.stringify(list, null, 1));
      this._sessCache = null;
    },
    // sessions for one person over the last `months` months (including this one)
    async sessions(person, months) {
      const key = person + "|" + (months || 2);
      if (this._sessCache && this._sessCache.key === key && Date.now() - this._sessCache.at < 30000) return this._sessCache.list;
      const out = [], now = new Date();
      for (let k = 0; k < (months || 2); k++) {
        const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
        const ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        try { const { dir, name } = await this.sessionFile(person, ym); const l = await readJson(dir, name); if (l) out.push(...l); } catch (e) {}
      }
      this._sessCache = { key, list: out, at: Date.now() };
      return out;
    }
  };
  window.Store = Store;
})();
