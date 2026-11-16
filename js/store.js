/* The Lamp Room — storage. Everything lives as plain files in a library folder the user picks:
     <Library>/lamp-room.json                 settings
     <Library>/Books/<Book folder>/book.json   one book
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
      this.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
      if (!s) await this.saveSettings();
      const booksDir = await this.root.getDirectoryHandle("Books", { create: true });
      this.books = [];
      for await (const [name, h] of booksDir.entries()) {
        if (h.kind !== "directory") continue;
        try { const b = await readJson(h, "book.json"); if (b) { b.folder = name; this.books.push(b); } }
        catch (e) { console.warn("Couldn't read", name, e); }
      }
      this.books.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    },
    async saveSettings() { await writeFile(this.root, "lamp-room.json", JSON.stringify(this.settings, null, 2)); },

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
        try { await writeFile(await this.bookDir(book), "book.json", JSON.stringify(book, null, 1)); this.lastError = null; document.dispatchEvent(new CustomEvent("lr-saved")); }
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
      await writeFile(dir, "book.json", JSON.stringify(book, null, 1));
      this.books.unshift(book);
      return book;
    },
    byId(id) { return this.books.find(b => b.id === id); },

    // ---- who this computer belongs to (acts as the login; remembered per computer) ----
    me() { try { return localStorage.getItem("lr-me") || ""; } catch (e) { return ""; } },
    setMe(name) { try { localStorage.setItem("lr-me", name); } catch (e) {} },

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
