/* The Lamp Room — screens. */
(function () {
  "use strict";
  // The work-log AI is gone; forget any key a past version saved on this computer.
  try { localStorage.removeItem("lr-anthropic-key"); localStorage.removeItem("lr-anthropic-model"); } catch (e) {}
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = n => Math.round(n || 0).toLocaleString();
  const hrs = h => { h = h || 0; const H = Math.floor(h), M = Math.round((h - H) * 60); return M === 60 ? (H + 1) + "h" : H + "h " + String(M).padStart(2, "0") + "m"; };
  const fh = h => (h || 0).toFixed(2);
  const money = n => "$" + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const prettyDate = s => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); };
  const todayYmd = () => Prep.ymd(new Date());

  const STATUSES = [["todo", "Not started"], ["recorded", "Recorded"], ["edited", "Edited"], ["mastered", "Mastered"], ["proofed", "Proofed"], ["delivered", "Delivered"]];
  const STATUS_COLOR = { todo: "var(--line)", recorded: "var(--warn)", edited: "color-mix(in srgb, var(--accent) 55%, var(--panel2))", mastered: "color-mix(in srgb, var(--accent) 75%, var(--panel2))", proofed: "var(--accent)", delivered: "var(--good)" };
  const INKS = ["#7a2e1d", "#2f5d50", "#23466e", "#6b3f7a", "#8a6a12", "#4c6a1f", "#8c3b55", "#3d5a80", "#9c4f12", "#5a5048"];
  const RATE_TYPES = [["pfh", "Per finished hour"], ["perword", "Per word"], ["flat", "Flat fee"], ["none", "Not set / royalty share"]];

  const main = () => $("#main");
  let route = { name: "library" };

  // ---------------- boot ----------------
  async function boot() {
    applyTheme();
    window.addEventListener("hashchange", () => render());
    document.addEventListener("lr-saved", () => chip("Saved", false));
    document.addEventListener("lr-save-error", e => chip("Couldn't save — " + (e.detail && e.detail.message || "check the folder"), true));
    let status;
    try { status = await Store.init(); } catch (e) { status = "error"; console.error(e); }
    if (status !== "ready") return renderWelcome(status);
    askMe(start);
  }
  // once the library is open: the planner wakes, and changes from the other computer are watched for
  function start() {
    try { LL.init(); } catch (e) { console.error("planner", e); }
    LL.views.onChange = () => { if (route.name === "library") viewLibrary(); else if (route.name === "book") viewBook(); };
    LL.views.decorate = el => decorateCovers(el);
    LL.views.linkBook = id => linkBook(id);
    LL.views.openBook = id => { const b = Store.books.find(b => b.titleId === id); location.hash = b ? "#/book/" + b.id : "#/import?title=" + id; };
    Store.watch();
    LRBackup.start();
    LRPresence.start();
    LRPace.refresh();
    try { LRPeople.reconcile(); } catch (e) {}
    drawWho();
    $("#whochip").onclick = whoMenu;
    document.addEventListener("lr-me", e => {
      applyTheme(); drawWho();
      if (route.name !== "booth") render();
      toast("Now working as " + e.detail.to + ". Their look, hotkeys and goals are in place.");
    });
    // measured pace arrives a moment after start-up (and after each save): redraw what shows it
    // Auphonic progress: the Dashboard's Heads up and the Auphonic card follow along (at most once a second)
    { let t = 0; document.addEventListener("lr-auphonic", () => { if (t) return; t = setTimeout(() => { t = 0; if (["library", "settings"].includes(route.name) && !document.querySelector(".overlay, #layer .scrim, input:focus, select:focus")) render(); }, 1000); }); }
    document.addEventListener("lr-pace", () => { if (["library", "book", "settings"].includes(route.name) && !document.querySelector(".overlay, #layer .scrim, input:focus")) render(); });
    document.addEventListener("lr-external", e => {
      const d = e.detail || []; if (d.includes("settings")) applyTheme();
      if (d.includes("pickups") && route.name !== "booth") { const n = Store.books.reduce((a, b) => a + Store.pickupReqs(b).filter(q => q.to === Store.me() && q.status === "open" && !Store.pickupReply(b, q)).length, 0); if (n && n !== start.pk) toast("🔁 " + n + " pickup" + (n === 1 ? "" : "s") + " waiting for you. See Heads up."); start.pk = n; }
      if (["library", "book", "settings"].includes(route.name) && !document.querySelector(".overlay, #layer .scrim")) render();
      chip("Updated from " + ((Store.settings.narrators || []).map(n => n.name).find(n => n !== Store.me()) || "the shared folder"), false);
    });
    render();
  }
  function chip(text, err) {
    const c = $("#savechip"); c.textContent = text; c.classList.remove("hidden"); c.classList.toggle("err", !!err);
    clearTimeout(chip.t); if (!err) chip.t = setTimeout(() => c.classList.add("hidden"), 1500);
  }
  // the name chip in the bar: who's working at this computer right now
  function drawWho() { const c = $("#whochip"); if (!c) return; c.innerHTML = "👤 " + esc(Store.me() || "Who?") + (Store.settings.narrators.length > 1 ? " <i>⇄</i>" : ""); c.classList.remove("hidden"); }
  function whoMenu(ev) {
    const old = $(".who-menu"); if (old) { old.remove(); return; }
    if (window.Booth && Booth.state && Booth.state.rec && /^#\/booth/.test(location.hash)) { toast("Stop recording first, then switch."); return; }
    const m = document.createElement("div"); m.className = "who-menu";
    m.innerHTML = Store.settings.narrators.map(n => `<button data-who="${esc(n.name)}" class="${n.name === Store.me() ? "on" : ""}">${n.name === Store.me() ? "● " : "○ "}${esc(n.name)}</button>`).join("") +
      `<div class="hint">Sharing one computer? Switch here before you record. Each person keeps their own theme, hotkeys, sizes, sessions and lines.</div>`;
    const r = ev.currentTarget.getBoundingClientRect(); m.style.top = (r.bottom + 6) + "px"; m.style.right = Math.max(8, innerWidth - r.right) + "px";
    document.body.appendChild(m);
    const off = e => { if (!m.contains(e.target) && e.target !== $("#whochip")) { m.remove(); document.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => document.addEventListener("pointerdown", off, true));
    m.onclick = e => { const b = e.target.closest("[data-who]"); if (!b) return; m.remove(); document.removeEventListener("pointerdown", off, true); if (b.dataset.who !== Store.me()) Store.setMe(b.dataset.who); };
  }
  function applyTheme() { document.documentElement.dataset.theme = (Store.settings && Store.settings.theme) || "ledger"; }

  function renderWelcome(status) {
    $("#nav").classList.add("hidden");
    const msg = {
      "no-folder": `<p>Everything you make here — books, chapters, recordings — is saved as ordinary files in one folder on your computer. Nothing goes online.</p><p class="muted small">Pick an empty folder (or make one called <i>Lamp Room Library</i>). Put it inside Google Drive or Dropbox if you want it backed up automatically.</p><button class="btn primary" id="pick">Choose library folder</button>`,
      "needs-permission": `<p>Welcome back. Chrome needs a nod before it opens <b>${esc(Store.folderName())}</b> again.</p><button class="btn primary" id="reopen">Open my library</button> <button class="btn quiet" id="pick">Use a different folder</button>`,
      "unsupported": `<p>This browser can't save to a folder on your computer. Open The Lamp Room in <b>Google Chrome</b> or <b>Microsoft Edge</b> on your desktop.</p>`,
      "error": `<p>Something went wrong opening your library. Reload the page to try again.</p><button class="btn" id="pick">Choose library folder</button>`
    }[status];
    main().innerHTML = `<div class="welcome card"><h1>The Lamp Room</h1>${msg}</div>`;
    const go = async fn => { try { await fn(); $("#nav").classList.remove("hidden"); applyTheme(); askMe(start); } catch (e) { if (e.name !== "AbortError") alertBox(e.message); } };
    const p = $("#pick"); if (p) p.onclick = () => go(() => Store.pickFolder());
    const r = $("#reopen"); if (r) r.onclick = () => go(() => Store.reopen());
  }
  // whose computer is this? asked once, remembered on this computer (stands in for a login)
  function askMe(then) {
    if (Store.me() || Store.testMode && Store.setMe((Store.settings.narrators[0] || {}).name || "Me") === undefined && Store.me()) return then();
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader" style="max-width:480px"><h2>Whose computer is this?</h2>
      <p class="muted">The Lamp Room opens as you on this computer: your pace, your sessions, your lines in duets. You can switch in the Booth any time.</p>
      <div class="row">${Store.settings.narrators.filter(n => n.name !== "Me").map(n => `<button class="btn primary" data-me="${esc(n.name)}">${esc(n.name)}</button>`).join("")}</div>
      <div class="row" style="margin-top:10px"><input id="menew" placeholder="Someone new? Your first name" style="flex:1"><button class="btn" id="menewb">That's me</button></div></div>`;
    document.body.appendChild(ov);
    $$("[data-me]", ov).forEach(b => b.onclick = () => { Store.setMe(b.dataset.me); ov.remove(); then(); });
    $("#menewb", ov).onclick = () => { const n = $("#menew", ov).value.trim(); if (!n) return; const N = Store.settings.narrators; const me0 = N.find(x => x.name === "Me"); if (me0) me0.name = n; else if (!N.some(x => x.name === n)) N.push({ name: n, pace: 4000 }); Store.saveSettings(); Store.setMe(n); ov.remove(); then(); };
  }
  function alertBox(m) { window.toast ? toast(m) : console.warn(m); }

  function render() {
    const [path, qs] = location.hash.replace(/^#\/?/, "").split("?"), h = path.split("/");
    route = { name: h[0] || "library", id: h[1], ci: h[2] != null && h[2] !== "" ? +h[2] : null, q: new URLSearchParams(qs || "") };
    $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === route.name || (route.name === "key" && a.dataset.r === "help") || ((route.name === "book" || route.name === "booth") && a.dataset.r === "library")));
    const fc = $("#folderchip"); fc.textContent = "📁 " + (Store.testMode ? "test library" : Store.folderName()); fc.classList.remove("hidden");
    if (route.name !== "booth") window.scrollTo(0, 0);
    if (!["almanac", "titles", "log", "ledger", "key", "help"].includes(route.name) && LL.views) LL.views.el = null;
    ({ library: viewLibrary, book: viewBook, almanac: () => llView("almanac"), titles: () => llView("titles"), log: () => llView("worklog"), ledger: () => llView("ledger"), key: () => llView("guide"), help: viewHelp, goals: () => { main().innerHTML = '<p class="muted">Adding it up…</p>'; return LRGoals.view(main()); }, import: viewImport, calc: viewCalc, settings: viewSettings, booth: () => Booth.open(route.id, route.ci, route.q.get("tab")),
      workspace: () => { const id = Store.lsGet("lr-last-book"); if (id && Store.byId(id)) location.hash = "#/booth/" + id; else { toast("Open a book first — its Booth becomes your Workspace."); location.hash = "#/library"; } } }[route.name] || viewLibrary)();
  }

  function llView(tab) { main().innerHTML = `<div id="llhost"></div>`; LL.show(tab, $("#llhost")); }

  // ---------------- covers ----------------
  const coverKey = b => b.titleId || ("b-" + b.id);
  function decorateCovers(root) {
    $$("[data-cover]", root || document).forEach(el => Store.coverURL(el.dataset.cover).then(u => { if (!u) return; el.style.backgroundImage = `url("${u}")`; el.classList.add("has-cover"); }));
    // Ledger & Lamp's title cards get a cover too
    $$(".ll .ccard h4", root || document).forEach(h => {
      if (h.querySelector(".cc-cover")) return; const btn = h.closest(".ccard").querySelector('[data-act="edit-title"]'); if (!btn) return;
      const id = btn.dataset.id, d = document.createElement("span"); d.className = "cc-cover"; d.dataset.cover = id; h.prepend(d);
      Store.coverURL(id).then(u => { if (u) { d.style.backgroundImage = `url("${u}")`; d.classList.add("has-cover"); } else d.remove(); });
    });
  }
  function pickCover(key, then) {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { await Store.setCover(key, f); toast("Cover on."); then && then(); } catch (e) { toast("Couldn't use that image: " + e.message); } };
    inp.click();
  }
  // a book joins the schedule: link it to a title from the planner, or make one from the book
  function wordsFor(book) {
    const rw = readerWords(book), out = {};
    for (const n in rw) { if (n === "?") continue; out[n] = rw[n]; }
    if (!Object.keys(out).length) out[Store.me() || (Store.settings.narrators[0] || {}).name] = book.chapters.filter(c => c.included).reduce((a, c) => a + c.words, 0);
    return out;
  }
  // when who-reads-what changes in the manuscript, the planner's word counts for the narrators here follow it
  const syncT = {}, syncSig = {};
  function syncTitleWords(book) {
    if (!book || !book.titleId || !book.parts || !window.LL || !LL.S || !LL.tById) return;
    clearTimeout(syncT[book.id]);
    syncT[book.id] = setTimeout(async () => {
      if (window.Booth && Booth.state && Booth.state.rec) return syncTitleWords(book);
      const t = LL.tById(book.titleId); if (!t || t.kind === "author") return;
      const rw = readerWords(book), sig = JSON.stringify(rw); if (syncSig[book.id] === sig) return; syncSig[book.id] = sig;
      const want = {}; for (const n in rw) { const k = n !== "?" && LL.keyOf(n); if (k) want[k] = (want[k] || 0) + rw[n]; }
      const stages = (t.stages || []).map(x => Object.assign({}, x)), said = [];
      for (const k of ["anne", "jack"]) {
        const w = Math.round(want[k] || 0), st = stages.find(x => x.type === "record" && x.owner === k);
        if (st && st.words !== w) { said.push(LL.nameOf(k) + " " + num(st.words || 0) + " → " + num(w)); st.words = w; }
        else if (!st && w) { stages.unshift({ id: "rec-" + k, type: "record", owner: k, words: w, after: [], done: false, doneDate: null }); const ed = stages.find(x => x.type === "edit"); if (ed) ed.after = [...new Set([...(ed.after || []), "rec-" + k])]; said.push(LL.nameOf(k) + " " + num(w) + " (new)"); }
      }
      if (!said.length) return;
      await LL.patch("titles", t.id, { stages }); toast("📅 Planner word counts for " + book.title + ": " + said.join(", "));
    }, 6000);
  }
  document.addEventListener("lr-saved", e => syncTitleWords(e.detail));
  function titleFromBook(book) {
    const wb = wordsFor(book), me = LL.keyOf(Store.me()) || "anne", stages = [], recs = [];
    let ext = null;
    for (const n in wb) { const k = LL.keyOf(n); if (k) { stages.push({ id: "rec-" + k, type: "record", owner: k, words: Math.round(wb[n]), after: [], done: false, doneDate: null }); recs.push("rec-" + k); } else { ext = ext || { n, w: 0, who: [] }; ext.w += wb[n]; ext.who.push(Store.castName(book, n)); } }
    if (ext) { stages.push({ id: "rec-ext", type: "ext", owner: "ext", words: Math.round(ext.w), after: [], done: false, doneDate: null, extDate: null }); recs.push("rec-ext"); }
    stages.push({ id: "edit", type: "edit", owner: me, after: recs, done: false, doneDate: null, cost: 0, turnaround: null }, { id: "deliver", type: "deliver", owner: me, after: ["edit"], done: false, doneDate: null }, { id: "pickups", type: "pickups", owner: me, after: ["deliver"], done: false, doneDate: null });
    const r = book.rate || {}, ks = Object.keys(wb).map(LL.keyOf).filter(Boolean);
    return { kind: "narration", status: "active", name: book.title, short: "", client: book.client || "", due: book.due || null, color: LL.nextInk(),
      // one outside partner: a 50/50 duet. Two or more: a full cast, paid per word (Settings ▸ Money: cast pay)
      category: ext ? (ext.who.length > 1 ? "C" : "B") : ks.length > 1 ? "A" : "S", partnerName: ext ? ext.who.join(", ") : "",
      ...(ext && ext.who.length > 1 ? { partnerPayMode: "perword", partnerPerWord: +(Store.settings.castPerWord || 0.05) } : {}), rateModel: r.type === "perword" ? "per2k" : "pfh", rate: r.type === "perword" ? (+r.amount || 0) * 2000 : r.type === "pfh" ? (+r.amount || 0) : 0, software: 0, stages };
  }
  async function moveCover(from, to) { const u = await Store.coverURL(from); if (!u || await Store.coverURL(to)) return; const blob = await (await fetch(u)).blob(); await Store.setCover(to, blob); await Store.removeCover(from); }
  function linkBook(bookId) {
    const book = Store.byId(bookId); if (!book) return;
    const free = LL.S.titles.filter(t => t.kind !== "author" && !Store.books.some(b => b.titleId === t.id));
    const norm = x => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), guess = free.find(t => norm(t.name) === norm(book.title)) || free.find(t => norm(book.title).includes(norm(t.name)) || norm(t.name).includes(norm(book.title)));
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader" style="max-width:520px"><h2>Put “${esc(book.title)}” on the schedule</h2>
      <p class="muted">Link it to a title the planner already knows, or make a new title from this book (its word counts per reader become the recording stages).</p>
      <label>Title<select id="lt">${free.map(t => `<option value="${esc(t.id)}" ${guess === t ? "selected" : ""}>${esc(t.name)}${t.client ? " · " + esc(t.client) : ""}</option>`).join("")}<option value="__new" ${guess ? "" : "selected"}>＋ New title from this book</option></select></label>
      <div class="row" style="margin-top:14px"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" data-go>Link</button></div></div>`;
    document.body.appendChild(ov);
    $("[data-x]", ov).onclick = () => ov.remove();
    $("[data-go]", ov).onclick = async () => {
      const v = $("#lt", ov).value; ov.remove();
      let id = v;
      if (v === "__new") { id = "t-" + LL.uid(); await LL.put("titles", id, titleFromBook(book)); }
      else { const t = LL.tById(v), wb = wordsFor(book); const st = (t.stages || []).map(s => { if (s.type === "record") { const n = Object.keys(wb).find(n => LL.keyOf(n) === s.owner); if (n && !s.words) return Object.assign({}, s, { words: Math.round(wb[n]) }); } return s; }); await LL.patch("titles", v, { stages: st }); }
      book.titleId = id; const t = LL.tById(id); if (t) { book.title = t.name; book.due = t.due || book.due; book.client = t.client || book.client; book.color = t.color || book.color; }
      Store.saveBook(book, true); await moveCover("b-" + book.id, id).catch(() => {});
      LL.loadBoothFh().then(() => render()); toast("On the schedule."); render();
    };
  }

  // ---------------- stats ----------------
  const readerCache = new Map();
  // words each reader voices, for books with parts (duets); cached until the book changes
  function readerWords(book, filter) {
    const key = book.id + "|" + book.updated + "|" + (filter ? "todo" : "all");
    if (readerCache.has(key)) return readerCache.get(key);
    const out = {};
    book.chapters.filter(c => c.included && (!filter || filter(c))).forEach(c => { const w = Prep.wordsByReader(c, book); for (const k in w) out[k] = (out[k] || 0) + w[k]; });
    readerCache.set(key, out); return out;
  }
  // a book whose cast shares come from the words each reader actually voices
  function castFromParts(book, rw) {
    const names = Object.keys(rw).filter(k => k !== "?"), tot = names.reduce((a, k) => a + rw[k], 0);
    if (!book.parts || !names.length || !tot) return book;
    return Object.assign({}, book, { cast: names.map(n => ({ name: n, share: 100 * rw[n] / tot })) });
  }
  // the people recording on this computer (Settings ▸ Narrators): in a full-cast book, only their lines are "ours"
  const oursName = n => n && n !== "?" && Store.settings.narrators.some(x => x.name === n);
  const chapCache = new Map();
  function chapterReaders(book) {
    const key = book.id + "|" + book.updated; if (chapCache.has(key)) return chapCache.get(key);
    const m = new Map(); book.chapters.forEach(c => { if (c.included) m.set(c, Prep.wordsByReader(c, book)); });
    chapCache.set(key, m); return m;
  }
  const linesOf = st => { const me = Store.me(), o = st.who.filter(n => n !== me); return st.who.includes(me) ? (o.length ? "Your & " + o.join(" & ") + "'s lines" : "Your lines") : st.who.join(" & ") + "'s lines"; };
  // estimates use measured pace (this book's series, else overall, else typed) and each person's planner hours a day
  function estSettings(book) { return Object.assign({}, Store.settings, { wpfh: LRPace.wpfh(), paceOf: n => LRPace.paceOf(Store.castName(book, n), book), hoursOf: n => LRPace.hoursPerDay(Store.castName(book, n)) }); }
  function bookStats(book) {
    const S = Store.settings, inc = book.chapters.filter(c => c.included);
    const total = inc.reduce((a, c) => a + c.words, 0), wpfh = LRPace.wpfh();
    const rwAll = book.parts ? readerWords(book) : null, names = rwAll ? Object.keys(rwAll).filter(n => n !== "?") : [];
    // part of a bigger cast: count only the lines read here (solo and duet books are unchanged: every reader is ours)
    const part = !!(rwAll && names.some(oursName) && names.some(n => !oursName(n)));
    const cw = part ? (() => { const m = chapterReaders(book); return c => { const w = m.get(c) || {}; let n = 0; for (const k in w) if (oursName(k)) n += w[k]; return n; }; })() : c => c.words;
    const only = rw => { if (!part) return rw; const o = {}; for (const k in rw) if (oursName(k)) o[k] = rw[k]; return o; };
    const words = inc.reduce((a, c) => a + cw(c), 0);
    const byStatus = {}; STATUSES.forEach(([k]) => byStatus[k] = 0);
    inc.forEach(c => byStatus[c.status] = (byStatus[c.status] || 0) + cw(c));
    const toRecord = byStatus.todo;
    const ES = estSettings(book);
    const est = Prep.estimate(words, castFromParts(book, only(readerWords(book))), ES);
    const left = Prep.estimate(toRecord, castFromParts(book, only(readerWords(book, c => c.status === "todo"))), ES);
    const delivered = inc.length && inc.every(c => c.status === "delivered");
    let track = null;
    if (book.due && !delivered) {
      const days = Prep.workdaysUntil(book.due);
      const finish = toRecord ? Prep.addWorkdays(left.days) : todayYmd();
      if (book.due < todayYmd()) track = { cls: "bad", label: "Overdue" };
      else if (finish <= book.due) track = { cls: "good", label: "On track" };
      else track = { cls: "warn", label: "Behind" };
      track.days = days; track.finish = finish; track.perDay = days ? toRecord / days : toRecord;
    }
    const whole = { words: total, fh: total / wpfh };
    return { words, byStatus, toRecord, est, left, delivered, track, chapters: inc.length, part, whole, who: part ? names.filter(oursName) : [] };
  }
  function progressBar(st) {
    if (!st.words) return `<div class="bar"></div>`;
    return `<div class="bar">${STATUSES.slice(1).reverse().map(([k]) => st.byStatus[k] ? `<i style="width:${100 * st.byStatus[k] / st.words}%;background:${STATUS_COLOR[k]}" title="${k}"></i>` : "").join("")}</div>`;
  }

  // ---------------- dashboard: today's focus, then the projects ----------------
  function viewLibrary() {
    const ls = (k, d) => Store.lsGet(k) || d;
    const lset = (k, v) => Store.lsSet(k, v);
    const opened = JSON.parse(ls("lr-opened", "{}")), mode = ls("lr-dash-mode", "cards"), sort = ls("lr-dash-sort", "opened");
    const P = LL.S, sim = P.sim || { out: {}, alloc: {} }, today = todayYmd();
    // every project: Lamp Room books (with their title if linked) and planner titles that have no book yet
    const items = Store.books.map(b => ({ b, t: b.titleId ? LL.tById(b.titleId) : null, st: bookStats(b) }))
      .concat((P.titles || []).filter(t => !Store.books.some(b => b.titleId === t.id)).map(t => ({ b: null, t, st: null })));
    const nameOf = x => x.b ? x.b.title : x.t.name, dueOf = x => (x.t && x.t.due) || (x.b && x.b.due) || "", idOf = x => x.b ? x.b.id : x.t.id;
    const isDone = x => x.b ? (x.st.delivered || (x.t && x.t.status === "done")) : x.t.status === "done";
    const isArch = x => x.b ? x.b.status === "archived" : false;
    const sorters = {
      opened: (x, y) => (opened[idOf(y)] || 0) - (opened[idOf(x)] || 0) || (dueOf(x) || "9999").localeCompare(dueOf(y) || "9999"),
      due: (x, y) => (dueOf(x) || "9999").localeCompare(dueOf(y) || "9999"),
      words: (x, y) => (y.st ? y.st.words : LL.partWords(y.t)) - (x.st ? x.st.words : LL.partWords(x.t)),
      client: (x, y) => ((x.t && x.t.client) || (x.b && x.b.client) || "~").localeCompare((y.t && y.t.client) || (y.b && y.b.client) || "~"),
      title: (x, y) => nameOf(x).localeCompare(nameOf(y)) };
    items.sort(sorters[sort] || sorters.opened);
    const active = items.filter(x => !isArch(x) && !isDone(x)), done = items.filter(x => !isArch(x) && isDone(x)), arch = items.filter(isArch);
    const recW = st => st.words - st.byStatus.todo, pct = st => st.words ? Math.round(100 * recW(st) / st.words) : 0;
    const doneCh = b => b.chapters.filter(c => c.included && c.status !== "todo").length;
    const schedStamp = t => {
      if (!t || t.status !== "active") return "";
      const o = sim.out[t.id] || {}; if (!o.finish) return "";
      if (o.late) return `<span class="badge bad" title="Forecast past the due date">Late · ${esc(LL.fmtShort(o.finish))}</span>`;
      if (o.amber) return `<span class="badge warn" title="Past the aim (a week early), still before the due date">Into the week · ${esc(LL.fmtShort(o.finish))}</span>`;
      return `<span class="badge good" title="Forecast finish">${t.kind === "author" ? "Ready" : "Delivers"} ${esc(LL.fmtShort(o.finish))}</span>`;
    };
    const moneyLine = t => {
      if (!t || t.kind === "author") return "";
      const m = LL.moneyOf(t); if (!(m.gross > 0) && !t.checkDate) return "";
      return `<div class="project-meta earn">${money(m.net)} net · ${t.checkDate ? "💰 received " + esc(LL.fmtShort(t.checkDate)) : "check ~" + esc(LL.fmtShort(LL.checkDateOf(t)))}</div>`;
    };
    const cover = (key, color, letter, cls) => `<div class="pc-cover ${cls || ""}" data-cover="${esc(key)}" style="--c:${esc(color || "#888")}"><span>${esc(letter)}</span></div>`;

    const card = x => {
      const { b, t, st } = x;
      if (!b) {   // a title the planner knows, no manuscript here yet
        const stg = t.stages || [], dn = stg.filter(s => s.done).length;
        return `<div class="project-card ${t.status === "done" ? "completed" : t.starred ? "is-current" : ""}" data-tid="${esc(t.id)}">
          <div class="pc-head">${cover(t.id, t.color, (t.name || "?")[0])}
            <div class="pc-title">${esc(t.name)}<div class="project-meta" style="margin-top:3px">${t.kind === "author" ? "Author work" + (t.series ? " · " + esc(t.series) + (t.seriesNo ? " #" + t.seriesNo : "") : "") : esc([t.client, LL.CAT[t.category]].filter(Boolean).join(" · "))}</div></div>
            <div class="pc-icons"><button data-coverpick="${esc(t.id)}" title="Add a cover">🖼</button>${t.kind !== "author" ? `<a href="#/import?title=${esc(t.id)}" data-booth title="Add the manuscript">📖</a>` : `<a href="../writing-desk/${Store.testMode ? "?test" : ""}#/title/${encodeURIComponent(t.id)}" target="writing-desk" data-booth title="Open in the Writing Desk">✒</a>`}</div></div>
          <div class="pc-bar"><i style="width:${stg.length ? 100 * dn / stg.length : 0}%"></i></div>
          <div class="project-meta">${dn} / ${stg.length} stages · ${stg.filter(s => !s.done).slice(0, 1).map(s => "next: " + esc(LL.stageLabel(s))).join("")}</div>
          ${t.kind !== "author" && LL.partWords(t) ? `<div class="project-meta">${num(LL.partWords(t))} words · ${LL.titleFH(t).toFixed(2)} FH</div>` : ""}
          ${moneyLine(t)}
          <div class="project-meta">${t.due ? (LL.hardDue(t) ? "Due " : "Target ") + esc(prettyDate(t.due)) : "No due date"}${schedStamp(t)}</div>
          ${t.kind !== "author" ? `<div class="project-meta muted">No manuscript yet · <a href="#/import?title=${esc(t.id)}" data-booth>add it</a></div>` : ""}
        </div>`;
      }
      const cur = !!(t ? t.starred : b.star), p = pct(st), cls = st.delivered ? "completed" : cur ? "is-current" : "";
      return `<div class="project-card ${cls}" style="--c:${esc(b.color)}" data-id="${esc(b.id)}">
        <div class="pc-head">${cover(coverKey(b), b.color, (b.title || "?").trim()[0] || "?")}
          <div class="pc-title">${esc(b.title)}
            <div class="project-meta" style="margin-top:3px">${esc([b.author, b.client].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
          <div class="pc-icons">${b.status === "archived" ? `<button data-restore="${esc(b.id)}" title="Restore from the archive">↩</button>` : ""}<button data-coverpick="${esc(coverKey(b))}" title="${"Add or change the cover"}">🖼</button><button class="star" data-star="${esc(b.id)}" title="${cur ? "Unstar" : "Star: work this first, deadlines permitting"}">${cur ? "★" : "☆"}</button><a href="#/booth/${esc(b.id)}" data-booth title="Open in the Booth">🎙</a></div></div>
        ${progressBar(st)}
        <div class="project-meta">${num(recW(st))} / ${num(st.words)} words (${p}%)${st.part ? ` <span class="muted" title="${esc(linesOf(st))} only">· your lines of ${num(st.whole.words)}</span>` : ""}</div>
        ${st.toRecord && !st.delivered ? `<div class="project-meta">${num(st.toRecord)} words remaining · ${fh(st.left.fh)} FH</div>` : ""}
        <div class="project-meta">${doneCh(b)} / ${st.chapters} chapters recorded</div>
        ${t ? moneyLine(t) : st.est.mine ? `<div class="project-meta earn">${money(st.est.mine)} est.</div>` : ""}
        <div class="project-meta">${b.due ? "Due " + esc(prettyDate(b.due)) : "No due date"}${t ? schedStamp(t) : st.delivered ? `<span class="badge good">Delivered</span>` : st.track ? `<span class="badge ${st.track.cls}">${st.track.label}</span>` : ""}</div>
        ${!t && b.status !== "archived" ? `<div class="project-meta"><button class="btn small quiet" data-link="${esc(b.id)}">📅 Put on the schedule</button></div>` : ""}
      </div>`;
    };
    const row = x => {
      const { b, t, st } = x;
      if (!b) return `<div class="ptr" data-tid="${esc(t.id)}"><div class="ptr-title">${cover(t.id, t.color, (t.name || "?")[0], "mini")}${esc(t.name)}</div><div>${(t.stages || []).filter(s => s.done).length} / ${(t.stages || []).length} stages</div><div>—</div><div>${t.kind !== "author" ? money(LL.moneyOf(t).net) : "—"}</div><div>${t.due ? esc(prettyDate(t.due)) : "—"} ${schedStamp(t)}</div></div>`;
      return `<div class="ptr ${st.delivered ? "completed" : ""}" data-id="${esc(b.id)}"><div class="ptr-title">${cover(coverKey(b), b.color, (b.title || "?")[0], "mini")}${(t ? t.starred : b.star) ? "★ " : ""}${esc(b.title)}${b.status === "archived" ? ` <button class="btn small quiet" data-restore="${esc(b.id)}">↩ Restore</button>` : ""}</div><div>${pct(st)}% · ${num(st.words)} w</div><div>${doneCh(b)} / ${st.chapters} ch</div><div>${t ? money(LL.moneyOf(t).net) : st.est.mine ? money(st.est.mine) : "—"}</div><div>${b.due ? esc(prettyDate(b.due)) : "—"} ${t ? schedStamp(t) : st.track ? `<span class="badge ${st.track.cls}">${st.track.label}</span>` : ""}</div></div>`;
    };
    const list = xs => mode === "list"
      ? `<div class="project-table"><div class="ptr head"><div>Title</div><div>Progress</div><div>Chapters</div><div>Net</div><div>Due · forecast</div></div>${xs.map(row).join("")}</div>`
      : `<div class="project-grid">${xs.map(card).join("")}</div>`;

    // ---- today ----
    const meName = Store.me ? Store.me() : "", me = LL.keyOf(meName) || "anne", other = me === "anne" ? "jack" : "anne", S = Store.settings;
    const nar = (S.narrators || []).find(n => n.name === meName) || (S.narrators || [])[0] || { pace: 4000 };
    const hrsGoal = LRPace.hoursPerDay(meName), wordsGoal = Math.round(LRPace.paceOf(meName) * hrsGoal);
    const plan = p => { const na = LL.nextAlloc(p); if (!na) return null; const g = {}; for (const a of na.l) { const k = a.tid + "|" + a.sid; g[k] = g[k] || { tid: a.tid, sid: a.sid, type: a.type, h: 0 }; g[k].h += a.h; } return { d: na.d, tasks: Object.values(g) }; };
    const verb = (s, p) => s.type === "record" ? "Record" : s.type === "ext" ? "Partner records" : LL.STAGE_LABEL[s.type] || s.type;
    const target = (task, p) => {
      const t = LL.tById(task.tid), s = t && (t.stages || []).find(x => x.id === task.sid), book = Store.books.find(b => b.titleId === task.tid);
      if (!t || !s) return null;
      let href = null, sub = "", act = "Open";
      if (s.type === "record") {
        if (book) { const ci = book.chapters.findIndex(c => c.included && !((c.prog || {})[LL.nameOf(p)] || {}).done && Prep.wordsByReader(c, book)[LL.nameOf(p)] > 0);
          href = "#/booth/" + book.id + (ci >= 0 ? "/" + ci : ""); act = "Into the Booth ▸";
          sub = (ci >= 0 ? esc(book.chapters[ci].title) + " · " : "") + "~" + LL.hrs(task.h) + " · ~" + num(task.h * LRPace.paceOf(LL.nameOf(p), book)) + " words"; }
        else { href = "#/import?title=" + t.id; act = "Add the manuscript ▸"; sub = "~" + LL.hrs(task.h) + " in the booth · the manuscript isn't in the Lamp Room yet"; }
      } else if (book) { href = "#/book/" + book.id; act = "Open ▸"; sub = "~" + LL.hrs(task.h); }
      else { act = "Open the card ▸"; sub = "~" + LL.hrs(task.h); }
      const o = sim.out[t.id] || {};
      const why = t.kind === "author" ? "Writing between paychecks" : t.ownProject ? "Our own project" + (o.finish ? " · forecast " + LL.fmtShort(o.finish) : "") : (t.starred ? "⭐ Starred · " : "") + (t.due ? "Due " + LL.fmtShort(t.due) + " · aim " + LL.fmtShort(o.target) + " · forecast " + LL.fmtShort(o.finish) : "");
      return { t, s, book, href, sub, act, why, late: o.late, amber: o.amber };
    };
    const mine = plan(me), theirs = plan(other);
    const notToday = mine && mine.d !== today;
    const focus = mine && mine.tasks.length ? target(mine.tasks[0], me) : null;
    const offWhy = LL.dayOff(me, today) ? "Day off today." : LL.holidayName(today) ? LL.holidayName(today) + ". Lamp's out." : !LL.isWorkday(me, today) ? "Not a workday." : "Today's hours are logged.";
    const focusCard = focus ? `<div class="dt-card focus-card ${focus.late ? "late" : focus.amber ? "amber" : ""}" ${focus.href ? `data-go="${esc(focus.href)}"` : `data-tcard="${esc(focus.t.id)}"`} style="--c:${esc(focus.t.color || "#888")}">
        <div class="dt-label">${notToday ? "Next up · " + esc(LL.fmt(mine.d)) + " · " + esc(offWhy) : "Your focus today"}</div>
        <div class="fc-body">${cover(focus.book ? coverKey(focus.book) : focus.t.id, focus.t.color, (focus.t.name || "?")[0], "big")}
          <div class="fc-text"><div class="fc-verb">${esc(verb(focus.s, me))}</div><div class="fc-title">${esc(focus.t.name)}</div>
            <div class="fc-sub">${focus.sub}</div><div class="fc-why">${esc(focus.why)}${focus.late ? ' · <b style="color:var(--bad)">late</b>' : focus.amber ? ' · <b style="color:var(--warn)">into the week</b>' : ""}</div>
            <div class="fc-go"><span class="btn primary">${focus.act}</span></div></div></div></div>`
      : `<div class="dt-card focus-card"><div class="dt-label">Your focus today</div><div class="dt-empty" style="margin-top:8px">Nothing scheduled. A clear desk.${P.titles && P.titles.length ? "" : ` <a href="#/titles">Add a title</a> or <a href="#/import">import a manuscript</a> to get the planner going.`}</div></div>`;
    const thenTasks = mine ? mine.tasks.slice(1).map(x => target(x, me)).filter(Boolean) : [];
    const thenCard = `<div class="dt-card"><div class="dt-label">Then</div>${thenTasks.length ? thenTasks.map(x => `<div class="then-row" ${x.href ? `data-go="${esc(x.href)}"` : `data-tcard="${esc(x.t.id)}"`}><i style="background:${esc(x.t.color || "#888")}"></i><span><b>${esc(verb(x.s, me))}</b> · ${esc(x.t.name)}<br><small>${x.sub}</small></span></div>`).join("") : `<div class="dt-empty">${focus ? "That's the day." : "—"}</div>`}
        ${theirs ? `<div class="partner-line" title="${esc(LL.nameOf(other))}'s plan">${esc(LL.nameOf(other))} · ${theirs.d !== today ? "next " + esc(LL.fmtShort(theirs.d)) + ": " : ""}${theirs.tasks.map(x => { const t = LL.tById(x.tid), s = t && (t.stages || []).find(y => y.id === x.sid); return t && s ? esc(verb(s, other)) + " " + esc(t.short || t.name) + " " + LL.hrs(x.h) : ""; }).filter(Boolean).join(" · ")}</div>` : ""}</div>`;
    // heads up: the planner's notices, money coming and going, and partner payouts
    const soon = LL.addDays(today, 10), heads = [];
    for (const t of (P.titles || []).filter(t => t.status === "active" && t.kind !== "author")) { const o = sim.out[t.id]; if (!o) continue;
      if (o.late) heads.push({ cls: "bad", html: `<b>${esc(t.short || t.name)}</b> forecasts ${esc(LL.fmtShort(o.finish))}, past its ${esc(LL.fmtShort(t.due))} due date · ~${LL.hrs(o.ot)} overtime makes it`, go: "#/almanac" });
      else if (o.amber) heads.push({ cls: "warn", html: `<b>${esc(t.short || t.name)}</b> is into the week: forecast ${esc(LL.fmtShort(o.finish))}, aim ${esc(LL.fmtShort(o.target))}`, go: "#/almanac" });
      const ext = (t.stages || []).find(s => s.type === "ext" && !s.done && s.extDate && s.extDate < today); if (ext) heads.push({ cls: "warn", html: `${esc(t.partnerName || "The partner")}'s lines for <b>${esc(t.short || t.name)}</b> were expected ${esc(LL.fmtShort(ext.extDate))}`, go: "#/titles" });
    }
    for (const t of (P.titles || []).filter(t => t.kind !== "author" && !t.checkDate)) { const cd = LL.checkDateOf(t), m = LL.moneyOf(t); if (cd && cd <= soon && m.gross > 0 && (t.invoiceDate || (t.stages || []).some(s => s.type === "deliver" && s.done))) heads.push({ cls: "money", html: `💰 ${esc(t.short || t.name)} check ~${esc(LL.fmtShort(cd))} · ${money(LL.ourCheck(t) + (t.partnerPaidByClient ? 0 : m.partner))}`, go: "#/ledger" }); }
    for (const t of (P.titles || []).filter(t => t.checkDate && !t.partnerPaidByClient && !t.partnerPaidDate && LL.moneyOf(t).partner > 0)) heads.push({ cls: "money", html: `↗ Pay ${esc(t.partnerName || "the partner")} ${money(LL.moneyOf(t).partner)} for ${esc(t.short || t.name)}`, go: "#/titles" });
    for (const o of (LL.billsOverdue ? LL.billsOverdue() : [])) heads.push({ cls: "bad", html: `🧾 ${esc(o.b.name)} for ${esc(LL.monthName(o.ym))} is ${o.days} days late · ${money(o.amt)}`, go: "#/ledger" });
    for (const bl of (P.bills || []).filter(b => b.active !== false)) { const ym = today.slice(0, 7), d = LL.billDate(bl, ym); if (!(bl.paid || {})[ym] && d >= today && d <= LL.addDays(today, 7)) heads.push({ cls: "", html: `🧾 ${esc(bl.name)} ${money(LL.billAmount(bl, ym))} due ${esc(LL.fmtShort(d))}`, go: "#/ledger" }); }
    let yd = LL.addDays(today, -1), guard = 0; while (!LL.isWorkday(me, yd) && guard++ < 7) yd = LL.addDays(yd, -1);
    if (LL.isWorkday(me, yd) && !(LL.boothOn && LL.boothOn(me, yd).length) && !(P.logs || []).some(l => l.date === yd && (l.person === me || (l.entries || []).some(e => e.person === me)))) heads.push({ cls: "", html: `No log for ${esc(LL.fmt(yd))} yet`, go: "#/log" });
    // pickups through the shared folder: asked of me, or sent back to me
    for (const b of Store.books) {
      const qs = Store.pickupReqs(b), ch = id => b.chapters.findIndex(c => c.id === id);
      const forMe = qs.filter(q => q.to === meName && q.status === "open" && !Store.pickupReply(b, q));
      if (forMe.length) heads.unshift({ cls: "warn", html: `🔁 ${esc(forMe[0].asker)} asked you for <b>${forMe.length} pickup${forMe.length === 1 ? "" : "s"}</b> in ${esc(b.title)}`, go: "#/booth/" + b.id + "/" + Math.max(0, ch(forMe[0].chapterId)) + "?tab=pickups" });
      const back = qs.filter(q => q.asker === meName && q.status === "open" && Store.pickupReply(b, q));
      if (back.length) heads.unshift({ cls: "", html: `🔁 <b>${back.length} pickup${back.length === 1 ? "" : "s"}</b> came back from ${esc([...new Set(back.map(q => q.to))].join(" & "))} for ${esc(b.title)}: they go in when you open the chapter`, go: "#/booth/" + b.id + "/" + Math.max(0, ch(back[0].chapterId)) + "?tab=pickups" });
    }
    for (const j of (window.LRAuphonic && LRAuphonic.key() ? LRAuphonic.jobs() : [])) heads.unshift({ cls: j.error ? "bad" : j.need ? "warn" : "", html: `🎚 ${esc(j.title || j.name)} · ${esc(j.state || "")}`, go: j.need === "click" ? "aup:retry" : "#/settings?tab=computer", keep: true });
    // × hides an item until it changes (a new date or amount makes it a new item); dismissals are yours alone
    const hx = (() => { try { return JSON.parse(Store.lsGet("lr-heads-x") || "{}"); } catch (e) { return {}; } })(), hk = h => h.html.replace(/<[^>]+>/g, "").trim();
    const shown = heads.filter(h => h.keep || !hx[hk(h)]), hidden = heads.length - shown.length;
    const headCard = `<div class="dt-card"><div class="dt-label">Heads up</div>${shown.length ? shown.slice(0, 7).map(h => `<div class="head-row ${h.cls}" data-go="${esc(h.go)}"><span style="flex:1">${h.html}</span>${h.keep ? "" : `<button class="head-x" data-headx="${esc(hk(h))}" title="Dismiss" aria-label="Dismiss">×</button>`}</div>`).join("") + (shown.length > 7 ? `<div class="dt-empty"><a href="#/almanac">${shown.length - 7} more on the Almanac</a></div>` : "") : `<div class="dt-empty">All quiet.</div>`}${hidden ? `<div class="dt-empty"><button class="lnk" data-headback>Show ${hidden} dismissed</button></div>` : ""}</div>`;
    const ring = (id, label, sub) => `<div class="ring" id="${id}"><svg width="64" height="64" viewBox="0 0 64 64"><circle class="trk" cx="32" cy="32" r="28.5" stroke-width="7"/><circle class="arc" cx="32" cy="32" r="28.5" stroke-width="7" transform="rotate(-90 32 32)" stroke-dasharray="179.07" stroke-dashoffset="179.07"/></svg><div class="ctr">—</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    const cb = (() => { try { return JSON.parse(Store.lsGet("lr-combo-best") || "null"); } catch (e) { return null; } })();
    const todayCard = `<div class="dt-card"><div class="dt-label">Today${meName ? " · " + esc(meName) : ""}</div><div class="rings">
        ${ring("r-words", "Words", "of " + num(wordsGoal))}${ring("r-booth", "Booth hrs", "of " + hrsGoal)}${ring("r-earn", "Earned", S.goalEarn ? "of $" + num(S.goalEarn) : "today")}</div>${cb && cb.score ? `<div class="dt-sub" style="text-align:center;margin-top:8px">Best combo ${num(cb.score)} pts</div>` : ""}</div>`;

    main().innerHTML = `${LRNews.card()}
      <div class="dash-top">${focusCard}${todayCard}</div>
      <div class="dash-today">${thenCard}${headCard}</div>
      <div class="view-header" style="margin-top:8px"><h2>Your Projects</h2>
        <div class="view-header-actions">
          <div class="mode-toggle"><button class="mode-btn ${mode !== "list" ? "on" : ""}" data-mode="cards">▦ Thumbnails</button><button class="mode-btn ${mode === "list" ? "on" : ""}" data-mode="list">☰ List</button></div>
          <select id="dash-sort">${[["opened", "Recently Opened"], ["due", "Due Date"], ["words", "Word Count"], ["client", "Client"], ["title", "Title"]].map(([k, l]) => `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          <button class="btn" id="newtitle" title="A title without a manuscript yet (or author work)">+ Title</button><button class="btn" id="joinsh" title="Open a book someone shared with you (its shared Drive folder)">⇄ Join a shared project</button><a class="btn primary" href="#/import">+ New Project</a></div></div>
      ${(() => { const writing = x => !x.b && x.t && x.t.kind === "author", aud = active.filter(x => !writing(x)), wr = active.filter(writing);
        if (!active.length) return items.length ? "" : `<div class="card welcome"><p>No books yet.</p><a class="btn primary" href="#/import">Import a manuscript</a></div>`;
        return `<div class="section-label proj-kind">🎙 Audio projects <span>${aud.length}</span></div>${aud.length ? list(aud) : `<p class="small muted">No audio projects in progress.</p>`}
          ${wr.length ? `<div class="section-label proj-kind" style="margin-top:22px">✒ Writing projects <span>${wr.length}</span></div>${list(wr)}` : ""}`; })()}
      ${done.length ? `<details style="margin-top:22px" ${ls("lr-done-open", "") ? "open" : ""} ontoggle="try{Store.lsSet('lr-done-open', this.open ? '1' : '')}catch(e){}"><summary class="section-label" style="display:list-item;cursor:pointer">Finished (${done.length})</summary>${list(done)}</details>` : ""}
      ${arch.length ? `<details style="margin-top:26px" ${ls("lr-arch-open", "") ? "open" : ""} ontoggle="try{Store.lsSet('lr-arch-open', this.open ? '1' : '')}catch(e){}"><summary class="section-label" style="display:list-item;cursor:pointer">Archived (${arch.length})</summary>${list(arch)}</details>` : ""}`;

    LRNews.wire(main());
    const stop = e => e.target.closest("[data-star],[data-booth],[data-restore],[data-coverpick],[data-link]");
    $$("[data-id]").forEach(el => el.onclick = e => { if (stop(e)) return; location.hash = "#/book/" + el.dataset.id; });
    $$("[data-tid]").forEach(el => el.onclick = e => { if (stop(e)) return; LL.titleForm(structuredClone(LL.tById(el.dataset.tid))); });
    $$("[data-tcard]").forEach(el => el.onclick = () => LL.titleForm(structuredClone(LL.tById(el.dataset.tcard))));
    $$("[data-go]").forEach(el => el.onclick = async () => { if (el.dataset.go === "aup:retry") { await LRAuphonic.retry(); render(); return; } location.hash = el.dataset.go; });
    $$("[data-headx]").forEach(b => b.onclick = e => { e.stopPropagation(); let x = {}; try { x = JSON.parse(Store.lsGet("lr-heads-x") || "{}"); } catch (er) {} x[b.dataset.headx] = new Date().toISOString().slice(0, 10); Store.lsSet("lr-heads-x", JSON.stringify(x)); viewLibrary(); });
    { const hb = $("[data-headback]"); if (hb) hb.onclick = () => { Store.lsSet("lr-heads-x", "{}"); viewLibrary(); }; }
    $$("[data-star]").forEach(el => el.onclick = async e => { e.stopPropagation(); const b = Store.byId(el.dataset.star);
      if (b.titleId && LL.tById(b.titleId)) { const t = LL.tById(b.titleId), on = !t.starred; for (const o of LL.S.titles.filter(x => x.starred && x.id !== t.id)) await LL.patch("titles", o.id, { starred: false }); await LL.patch("titles", t.id, { starred: on }); toast(on ? "⭐ " + (t.short || t.name) + " goes first, deadlines permitting." : "Star removed."); }
      else { const on = !b.star; Store.books.forEach(x => { if (x.star && x !== b) { x.star = false; Store.saveBook(x); } }); b.star = on; Store.saveBook(b); }
      viewLibrary(); });
    $$("[data-restore]").forEach(el => el.onclick = e => { e.stopPropagation(); const b = Store.byId(el.dataset.restore); b.status = "active"; Store.saveBook(b); toast("“" + b.title + "” is back on your dashboard."); viewLibrary(); });
    $$("[data-coverpick]").forEach(el => el.onclick = e => { e.stopPropagation(); pickCover(el.dataset.coverpick, viewLibrary); });
    $$("[data-link]").forEach(el => el.onclick = e => { e.stopPropagation(); linkBook(el.dataset.link); });
    $$("[data-mode]").forEach(el => el.onclick = () => { lset("lr-dash-mode", el.dataset.mode); viewLibrary(); });
    $("#dash-sort").onchange = e => { lset("lr-dash-sort", e.target.value); viewLibrary(); };
    $("#newtitle").onclick = () => LL.titleForm(null, "narration");
    { const jb = $("#joinsh"); if (jb) jb.onclick = joinSharedFlow; }
    decorateCovers(main());

    // fill the rings from today's booth sessions
    const setRing = (id, frac, txt) => { const r = $("#" + id); if (!r) return; const arc = r.querySelector(".arc"); arc.style.strokeDashoffset = 179.07 * (1 - Math.min(1, frac)); arc.classList.toggle("done", frac >= 1); r.querySelector(".ctr").textContent = txt; };
    if (meName && Store.sessions) Store.sessions(meName, 1).then(list => {
      const t = list.filter(s => s.date === today), w = t.reduce((a, s) => a + (s.words || 0), 0), sec = t.reduce((a, s) => a + (s.boothSec || 0), 0), v = t.reduce((a, s) => a + (s.value || 0), 0);
      setRing("r-words", w / wordsGoal, w >= 1000 ? (w / 1000).toFixed(1) + "k" : String(w));
      setRing("r-booth", sec / 3600 / hrsGoal, (sec / 3600).toFixed(1));
      setRing("r-earn", S.goalEarn ? v / S.goalEarn : v ? 1 : 0, "$" + Math.round(v));
    }).catch(() => {});
  }

  // ---------------- book ----------------
  const detailsOpen = {};
  function viewBook() {
    const book = Store.byId(route.id);
    if (!book) { location.hash = "#/library"; return; }
    const S = Store.settings, st = bookStats(book);
    const statusOpts = v => STATUSES.map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${l}</option>`).join("");
    const narrOpts = v => S.narrators.map(n => `<option ${n.name === v ? "selected" : ""}>${esc(n.name)}</option>`).join("");
    const tr = st.track, T = book.titleId ? LL.tById(book.titleId) : null;
    main().innerHTML = `
      <div class="row" style="align-items:center">
        <div class="pc-cover book-cover" data-cover="${esc(coverKey(book))}" style="--c:${esc(book.color)}" title="Click to add or change the cover"><span>${esc((book.title || "?")[0])}</span></div>
        <div><h1 style="margin:0">${esc(book.title)}</h1><div class="muted">${esc([book.author, book.client].filter(Boolean).join(" · "))}</div></div>
        <div class="spacer"></div>
        ${(() => { const o = T && LL.S.sim && LL.S.sim.out[T.id]; if (o && o.finish && T.status === "active") return o.late ? `<span class="badge bad">Late · ${esc(LL.fmtShort(o.finish))}</span>` : o.amber ? `<span class="badge warn">Into the week · ${esc(LL.fmtShort(o.finish))}</span>` : `<span class="badge good">Delivers ${esc(LL.fmtShort(o.finish))}</span>`; return st.delivered ? `<span class="badge good">Delivered</span>` : tr ? `<span class="badge ${tr.cls}">${tr.label}</span>` : ""; })()}
        <a class="btn primary" href="#/booth/${esc(book.id)}">🎙 Booth</a>
      </div>
      <div class="tiles">
        <div class="tile"><span>${st.part ? esc(linesOf(st)) : "Words"}</span><b>${num(st.words)}</b><em>${st.part ? "of " + num(st.whole.words) + " in the book · " : ""}${st.chapters} chapters</em></div>
        <div class="tile"><span>Finished hours</span><b>${fh(st.est.fh)}</b><em>${st.part ? "whole book " + fh(st.whole.fh) : "at " + num(LRPace.wpfh()) + " words / FH"}</em></div>
        ${T ? (() => { const m = LL.moneyOf(T); return `<div class="tile"><span>Net</span><b>${money(m.net)}</b><em>${m.gross ? "of a " + money(m.gross) + " check" + (T.checkDate ? " · received" : "") : "no check: royalties"}</em></div>`; })() : `<div class="tile"><span>Pay</span><b>${money(st.est.mine)}</b><em>${st.est.gross !== st.est.mine ? "of " + money(st.est.gross) + " gross" : book.rate && book.rate.type !== "none" ? "gross" : "rate not set"}</em></div>`}
        <div class="tile"><span>${st.part ? "Left to record · your part" : "Left to record"}</span><b>${num(st.toRecord)}</b><em>${st.left.perNarrator.map(p => esc(p.name) + " " + hrs(p.boothHours)).join(" · ")} in booth</em></div>
        <div class="tile"><span>Booth days left</span><b>${st.left.days.toFixed(1)}</b><em title="${esc(LRPace.describe(Store.me(), book))}">at ${num(LRPace.paceOf(Store.me(), book))} words / hr${LRPace.of(Store.me(), book).from === "series" ? " on this series" : ""}, ${LRPace.hoursPerDay(Store.me())} hrs / day</em></div>
        ${tr ? `<div class="tile"><span>Due ${esc(prettyDate(book.due))}</span><b>${tr.days} workdays</b><em>${num(tr.perDay)} words / day needed · recording done ${esc(prettyDate(tr.finish))}</em></div>` : `<div class="tile"><span>Due</span><b>—</b><em>set a due date below</em></div>`}
      </div>
      ${T ? `<div class="ll book-plan">${LL.cardHTML(T)}</div>` : `<div class="card row" style="align-items:center"><div><b>Not on the schedule yet.</b> <span class="muted">Link it to a title so the planner can schedule it, track its money and learn from your booth time.</span></div><div class="spacer"></div><button class="btn primary" id="linkbk">📅 Put on the schedule</button></div>`}
      ${progressBar(st)}
      <div class="small muted" style="margin-bottom:18px">${STATUSES.map(([k, l]) => st.byStatus[k] ? `<span style="color:${STATUS_COLOR[k]}">■</span> ${l} ${num(st.byStatus[k])}` : "").filter(Boolean).join(" &nbsp; ")}</div>

      <details class="card" id="details" ${(detailsOpen[book.id] != null ? detailsOpen[book.id] : !(book.rate && book.rate.amount)) ? "open" : ""}>
        <summary>Book details</summary>
        <div class="row" style="margin-top:12px">
          <label style="flex:2">Title<input data-f="title" value="${esc(book.title)}"></label>
          <label style="flex:1">Author<input data-f="author" value="${esc(book.author || "")}"></label>
          <label style="flex:1" title="Books in the same series share your character guide">Series<input data-f="series" value="${esc(book.series || "")}" placeholder="e.g. Monster Girls in Space"></label>
          <label style="flex:1">Client / publisher<input data-f="client" value="${esc(book.client || "")}"></label>
          <label>Due date<input type="date" data-f="due" value="${esc(book.due || "")}"></label>
        </div>
        ${T ? `<div class="small muted" style="margin-top:10px">Pay, partner split, editor and due date live on the schedule card above (Edit). Title, client, due date and colour stay in step both ways.</div>` : ""}
        <div class="row" style="margin-top:12px;${T ? "display:none" : ""}">
          <label>Rate type<select data-f="rate.type">${RATE_TYPES.map(([k, l]) => `<option value="${k}" ${(book.rate || {}).type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Amount ($)<input type="number" step="0.001" min="0" data-f="rate.amount" value="${esc((book.rate || {}).amount || "")}" style="width:110px"></label>
          <label>My share of pay (%)<input type="number" min="0" max="100" data-f="myShare" value="${esc(book.myShare != null ? book.myShare : 100)}" style="width:90px"></label>
          <div><div class="small muted" style="margin-bottom:3px">Colour</div><div class="swatches">${INKS.map(c => `<button style="background:${c}" data-color="${c}" class="${c === book.color ? "on" : ""}" title="${c}"></button>`).join("")}</div></div>
        </div>
        ${book.parts ? partsTable(book) : `<div style="margin-top:14px"><div class="small muted">Who records it — share of the words each narrator reads · <button class="btn small quiet" id="mkparts">Set up a duet</button></div>
          <div id="cast">${(book.cast || []).map((c, i) => `<div class="cast-row"><select data-cast="${i}" data-k="name">${narrOpts(c.name)}</select><input type="number" min="0" max="100" data-cast="${i}" data-k="share" value="${esc(c.share)}" style="width:80px"> %<button class="btn small quiet" data-delcast="${i}">✕</button></div>`).join("")}</div>
          <button class="btn small" id="addcast">+ Narrator</button>
        </div>`}
        <label style="display:flex;margin-top:14px">Notes<textarea data-f="notes">${esc(book.notes || "")}</textarea></label>
        <div class="row" style="margin-top:12px"><button class="btn small" id="redetect">Re-split chapters…</button><button class="btn small" id="updms" title="Bring in a corrected manuscript: replaces the text of the chapters you choose, keeping their recordings">Update the manuscript…</button><div class="spacer"></div>
          <button class="btn small quiet" id="archive">${book.status === "archived" ? "Restore from archive" : "Archive book"}</button></div>
      </details>
      ${creditsCard(book)}
      ${charScriptsCard(book)}
      ${sharedCard(book)}

      <div class="card" id="chcard">
        <div class="row" style="align-items:center;margin-bottom:6px"><h2 style="margin:0">Chapters</h2><div class="spacer"></div>
          <span class="small muted">Set status for all included:</span><select class="status" id="bulk"><option value="">—</option>${statusOpts("")}</select></div>
        <table class="ch"><thead><tr><th title="Include in counts">In</th><th>#</th><th>Title</th><th class="num">Words</th><th class="num">FH</th>${book.parts ? "<th>POV</th>" : ""}<th>Status</th><th></th></tr></thead>
        <tbody>${book.chapters.map((c, i) => `<tr class="${c.included ? "" : "excl"}" data-i="${i}">
          <td><input type="checkbox" data-inc ${c.included ? "checked" : ""}></td>
          <td class="muted">${i + 1}</td>
          <td><input class="title" data-title value="${esc(c.title)}"></td>
          <td class="num">${num(c.words)}</td>
          <td class="num muted">${fh(c.words / LRPace.wpfh())}</td>
          ${book.parts ? `<td><select class="status" data-pov title="Whose narration this chapter is"><option value="">—</option>${S.narrators.map(n => `<option ${c.pov === n.name ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></td>` : ""}
          <td><select class="status st-${c.status}" data-status>${statusOpts(c.status)}</select></td>
          <td style="white-space:nowrap"><a class="btn small quiet" href="#/booth/${esc(book.id)}/${i}" title="Record this chapter">🎙</a><button class="btn small quiet" data-open title="Read the text, add notes, split">Text</button>${i < book.chapters.length - 1 ? `<button class="btn small quiet" data-merge title="Merge with the next chapter">⤓ Merge</button>` : ""}</td>
        </tr>`).join("")}</tbody></table>
      </div>`;

    $("#details").ontoggle = e => { detailsOpen[book.id] = e.target.open; };
    const save = (rerender) => { Store.saveBook(book); if (rerender) viewBook(); };
    bindCredits(book, save); bindShared(book, save); bindCharScripts(book, save);
    const toTitle = f => { if (!T) return; const m = { title: "name", due: "due", client: "client", color: "color" }[f]; if (m) LL.patch("titles", T.id, { [m]: book[f] || (f === "due" ? null : "") }); };
    $(".book-cover").onclick = () => pickCover(coverKey(book), viewBook);
    const lb = $("#linkbk"); if (lb) lb.onclick = () => linkBook(book.id);
    decorateCovers(main());
    // details
    $$("[data-f]").forEach(el => el.onchange = () => {
      const f = el.dataset.f, v = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
      if (f.startsWith("rate.")) { book.rate = book.rate || { type: "none", amount: 0 }; book.rate[f.slice(5)] = v; } else book[f] = v;
      toTitle(f); save(f !== "notes");
    });
    $$("[data-color]").forEach(b => b.onclick = () => { book.color = b.dataset.color; toTitle("color"); save(true); });
    $$("[data-cast]").forEach(el => el.onchange = () => { const c = book.cast[+el.dataset.cast]; c[el.dataset.k] = el.dataset.k === "share" ? Number(el.value) : el.value; save(true); });
    $$("[data-delcast]").forEach(b => b.onclick = () => { book.cast.splice(+b.dataset.delcast, 1); save(true); });
    const mk = $("#mkparts"); if (mk) mk.onclick = () => { book.parts = { n: Store.me() || (S.narrators[0] || {}).name }; save(true); };
    $$("[data-part]").forEach(el => el.onchange = () => { book.parts[el.dataset.part] = el.value; save(true); });
    wireCastSheet(() => book.chapters.filter(c => c.included), (res, rows, name) => { book.castNames = book.castNames || {}; const missed = LRCastSheet.apply(res, book.parts, book.castNames); book.castSheet = rows; Object.defineProperty(book, "_cs", { value: { res, rows, name, missed }, enumerable: false, configurable: true, writable: true }); save(true); });
    $$("[data-castname]").forEach(el => el.onchange = () => { book.castNames = book.castNames || {}; const v = el.value.trim(); if (v) book.castNames[el.dataset.castname] = v; else delete book.castNames[el.dataset.castname]; save(true); });
    const np = $("#noparts"); if (np) np.onclick = () => { if (!confirm("Turn off parts? Everyone's lines count as one reader again.")) return; delete book.parts; save(true); };
    const ac = $("#addcast"); if (ac) ac.onclick = () => { book.cast = book.cast || []; const used = book.cast.map(c => c.name); const n = S.narrators.find(x => !used.includes(x.name)) || S.narrators[0]; book.cast.push({ name: n.name, share: book.cast.length ? 0 : 100 }); save(true); };
    $("#archive").onclick = () => { book.status = book.status === "archived" ? "active" : "archived"; save(false); location.hash = "#/library"; };
    $("#redetect").onclick = () => openRedetect(book);
    $("#updms").onclick = () => updateManuscript(book);
    // chapters
    $$("tr[data-i]").forEach(tr => {
      const i = +tr.dataset.i, c = book.chapters[i];
      $("[data-inc]", tr).onchange = e => { c.included = e.target.checked; save(true); };
      $("[data-title]", tr).onchange = e => { c.title = e.target.value; save(false); };
      $("[data-status]", tr).onchange = e => setStatus(book, c, e.target.value);
      const pv = $("[data-pov]", tr); if (pv) pv.onchange = e => { if (e.target.value) c.pov = e.target.value; else delete c.pov; save(true); };
      $("[data-open]", tr).onclick = () => openReader(book, i);
      const m = $("[data-merge]", tr);
      if (m) m.onclick = () => { if (!confirm(`Merge “${c.title}” with “${book.chapters[i + 1].title}”?`)) return; book.chapters.splice(i, 2, Prep.mergeChapters(c, book.chapters[i + 1])); save(true); };
    });
    $("#bulk").onchange = e => { const v = e.target.value; if (!v) return; const was = bookStats(book).delivered; book.chapters.filter(c => c.included).forEach(c => c.status = v); save(true); if (v === "delivered" && !was) cheer("bookDone"); };
    leadUI(book, save);
  }
  // ---- the book's Lead: a banner with notes from the others; for everyone else, the book's own controls are locked ----
  function leadUI(book, save) {
    const lead = Store.leadOf(book), me = Store.me(), mine = Store.isLead(book), asks = LRPeople.openAsks(book);
    if (!lead) return;
    if (book.shared && Date.now() - LRPeople.remoteAt(book) > 15000) { const before = LRPeople.sharedSig(book);
      LRPeople.pullShared(book).then(async r => {
        // notes written while the shared folder was off: send them now
        if (!mine && ((book.asks || {})[me] || []).length && JSON.stringify(r.asks[String(me).replace(/[\\/:*?"<>|]/g, "_")] || []) !== JSON.stringify(book.asks[me])) { await LRPeople.deliver(book); await LRPeople.pullShared(book); }
        if (LRPeople.sharedSig(book) !== before && route.name === "book" && route.id === book.id) viewBook(); }).catch(() => {}); }
    const bar = document.createElement("div"); bar.className = "card lead-bar" + (mine ? "" : " not-lead");
    const when = t => { try { return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (e) { return ""; } };
    const askRow = a => `<div class="ask-row" data-ask="${esc(a.id)}"><div><b>${esc(a.who)}</b> <span class="muted small">· ${esc(when(a.at))}${a.chTitle ? " · " + esc(a.chTitle) : ""}</span><div>${esc(a.text)}</div></div>
      <div class="ask-act">${a.ch ? `<button class="btn small quiet" data-askgo="${esc(a.ch)}">Go to chapter</button>` : ""}${mine ? `<button class="btn small" data-askdone="${esc(a.id)}" title="Mark it dealt with">✓ Done</button>` : ""}</div></div>`;
    if (mine) {
      const team = (Store.settings.narrators || []).map(n => n.name).filter(n => !Store.samePerson(n, me));
      bar.innerHTML = `<div class="row" style="align-items:center"><div><b>You lead this book.</b> <span class="muted">Only you change its text, chapters and credits, and who reads what for everyone; anyone can give lines to a reader in their own copy, and everyone keeps their own recordings and progress.</span></div><div class="spacer"></div>
        ${!book.shared && team.length ? `<label class="small">Hand the Lead to<select id="handon"><option value="">—</option>${team.map(n => `<option>${esc(n)}</option>`).join("")}</select></label>` : book.shared ? `<span class="small muted">In a shared project the Lead is the folder's owner.</span>` : ""}</div>
        ${asks.length ? `<div class="section-label" style="margin-top:12px">Asked of you · ${asks.length}</div>${asks.map(askRow).join("")}` : ""}`;
    } else {
      const myAsks = asks.filter(a => Store.samePerson(a.who, me));
      bar.innerHTML = `<div class="row" style="align-items:center"><div><b>${esc(lead)} leads this book.</b> <span class="muted">The text, chapters, credits, cast names and who reads what for everyone are ${esc(lead)}'s to change. You can give lines to a reader in your own copy (select the words in the Booth), and your recordings, takes and progress are yours.</span></div><div class="spacer"></div>
        <button class="btn" id="askLead">Ask ${esc(lead)} to fix something</button></div>
        ${myAsks.length ? `<div class="section-label" style="margin-top:12px">Waiting with ${esc(lead)} · ${myAsks.length}</div>${myAsks.map(askRow).join("")}` : ""}`;
      // lock the book's own controls; the Booth links, the reader, the planner card, the cover and the shared card stay
      const keep = el => el.closest("#sharedc, .ll, .book-cover, .lead-bar") || (book.shared && el.closest("#cscripts")) || el.matches("[data-open]");
      $$("input, select, textarea, button", main()).forEach(el => { if (keep(el)) return; el.disabled = true; el.title = "Ask " + lead + " to change this"; });
    }
    const chc = $("#chcard", main()) || $(".tiles", main()); chc.parentNode.insertBefore(bar, chc);   // just above the chapters list
    $$("[data-askgo]", bar).forEach(b => b.onclick = () => { const i = book.chapters.findIndex(c => c.id === b.dataset.askgo); if (i >= 0) location.hash = "#/booth/" + book.id + "/" + i; });
    $$("[data-askdone]", bar).forEach(b => b.onclick = () => { LRPeople.clearAsk(book, b.dataset.askdone); save(true); toast("Marked done."); });
    const ho = $("#handon", bar); if (ho) ho.onchange = () => { const n = ho.value; if (!n) return;
      if (!confirm("Hand the Lead of “" + book.title + "” to " + n + "? After this only " + n + " can change its text, chapters, parts and credits.")) { ho.value = ""; return; }
      book.lead = n; save(true); toast(n + " leads “" + book.title + "” now."); };
    const al = $("#askLead", bar); if (al) al.onclick = () => askLeadDialog(book, lead);
  }
  function askLeadDialog(book, lead, ci, text) {
    const ov = document.createElement("div"); ov.className = "overlay"; document.body.appendChild(ov);
    ov.innerHTML = `<div class="card reader" style="max-width:560px"><h2>Ask ${esc(lead)} to fix something</h2>
      <p class="small muted">It shows on ${esc(lead)}'s page for this book. Say what's wrong and where, e.g. “line 3 is Jack's, not mine”.</p>
      <label style="display:flex">Chapter<select id="akch"><option value="">Not about one chapter</option>${book.chapters.map((c, i) => c.included ? `<option value="${i}" ${i === ci ? "selected" : ""}>${esc(c.title)}</option>` : "").join("")}</select></label>
      <label style="display:flex;margin-top:10px">What needs fixing<textarea id="aktx" rows="4">${esc(text || "")}</textarea></label>
      <div class="row" style="margin-top:12px"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" id="akgo">Send to ${esc(lead)}</button></div></div>`;
    $("[data-x]", ov).onclick = () => ov.remove();
    { const ta = $("#aktx", ov); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    $("#akgo", ov).onclick = async () => { const t = $("#aktx", ov).value.trim(); if (!t) { $("#aktx", ov).focus(); return; }
      const v = $("#akch", ov).value; LRPeople.ask(book, t, v === "" ? null : +v); Store.saveBook(book);
      const ok = await LRPeople.deliver(book); ov.remove();
      toast(ok ? "Sent to " + lead + ". It's on their page for this book." : "Saved, but the shared folder isn't connected, so " + lead + " can't see it yet. Connect it (the book's Shared card), then open the book page again.");
      if (route.name === "book") viewBook(); };
  }
  window.LRAskLead = askLeadDialog;
  function partsTable(book) {
    const S = Store.settings, found = Prep.partsInBook(book);
    if (!found.n) found.n = { passages: 0, words: 0 };
    const order = ["n", "m", "f", "s"], keys = Object.keys(found).sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
    const rw = readerWords(book);
    return `<div style="margin-top:14px"><div class="row" style="align-items:center"><div class="small muted">Who reads what — from the highlight colours in the manuscript</div><div class="spacer"></div><button class="btn small quiet" id="noparts">Turn off parts</button></div>
      ${castSheetBar(book._cs)}
      <table class="ch" style="margin-top:6px"><thead><tr><th>Part</th><th class="num">Passages</th><th class="num">Words</th><th>Read by</th>${book._cs ? "<th>From the casting sheet</th>" : ""}</tr></thead><tbody>
      ${keys.map(k => `<tr><td><span class="sw" style="background:${partSwatch(k)}"></span> ${esc(Prep.partLabel(k))}${k === "n" ? ' <span class="muted small">(unhighlighted; a chapter\'s POV switch overrides it)</span>' : ""}</td><td class="num">${num(found[k].passages)}</td><td class="num">${num(found[k].words)}</td>
        <td><select data-part="${esc(k)}">${k === "n" ? "" : `<option value="" ${book.parts[k] ? "" : "selected"}>Same as narration</option>`}${readerOptions(book.parts[k], book)}</select>${CAST.includes(book.parts[k]) ? ` <input class="cast-real" data-castname="${book.parts[k]}" value="${esc((book.castNames || {})[book.parts[k]] || "")}" placeholder="their name" list="castpeople" title="Who ${book.parts[k]} is: shown to you and the editor in the Booth" style="width:150px">` : ""}</td>${book._cs ? `<td class="small">${castSheetCell(book._cs, k)}</td>` : ""}</tr>`).join("")}
      </tbody></table><datalist id="castpeople">${[...new Set((book.sharedPeople || []).filter(x => x.role === "outside").map(x => x.name).concat(Store.books.flatMap(b => Object.values(b.castNames || {}))))].map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="small muted" style="margin-top:6px">${Object.entries(rw).filter(([k]) => k !== "?").map(([k, v]) => esc(Store.castName(book, k)) + " voices " + num(v) + " words").join(" · ")}</div></div>`;
  }
  function setStatus(book, c, v) {
    const before = c.status; c.status = v; Store.saveBook(book);
    if (v === "delivered" && before !== "delivered") cheer(bookStats(book).delivered ? "bookDone" : "chapterDone");
    viewBook();
  }

  // reader: read a chapter, add notes, split at any paragraph
  function openReader(book, i) {
    const c = book.chapters[i];
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader">
      <div class="row" style="align-items:center"><button class="btn small" data-nav="-1" ${i ? "" : "disabled"}>← Prev</button><div class="spacer" style="text-align:center"><h2 style="margin:0">${esc(c.title)}</h2><div class="small muted">${num(c.words)} words · ${fh(c.words / Store.settings.wpfh)} FH · hover a paragraph and click ✂ to start a new chapter there</div></div><button class="btn small" data-nav="1" ${i < book.chapters.length - 1 ? "" : "disabled"}>Next →</button><button class="btn small quiet" data-x>✕</button></div>
      <label style="display:flex;margin:14px 0">Chapter notes<textarea data-notes placeholder="Pickups, pronunciations, character reminders…">${esc(c.notes || "")}</textarea></label>
      <div class="text">${c.paras.map((p, k) => p === Prep.SCENE_MARK ? `<div class="brk">⁂</div>` : `<div class="p">${esc(Prep.paraText(p))}${k ? `<button class="btn small cut" data-cut="${k}" title="Start a new chapter at this paragraph">✂</button>` : ""}</div>`).join("")}</div>
    </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); viewBook(); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.onclick = e => { if (e.target === ov) close(); };
    $("[data-x]", ov).onclick = close;
    $("[data-notes]", ov).onchange = e => { c.notes = e.target.value; Store.saveBook(book); };
    if (!Store.isLead(book)) { const L = Store.leadOf(book); $("[data-notes]", ov).disabled = true; $("[data-notes]", ov).title = "Ask " + L + " to change this"; $$("[data-cut]", ov).forEach(b => b.remove()); }
    $$("[data-nav]", ov).forEach(b => b.onclick = () => { ov.remove(); document.removeEventListener("keydown", onKey); openReader(book, i + Number(b.dataset.nav)); });
    $$("[data-cut]", ov).forEach(b => b.onclick = () => {
      const k = +b.dataset.cut, first = Prep.paraText(c.paras[k]);
      const title = first.length <= 70 ? first : first.slice(0, 50).replace(/\s+\S*$/, "") + "…";
      book.chapters.splice(i, 1, ...Prep.splitChapter(c, k, title));
      Store.saveBook(book); ov.remove(); document.removeEventListener("keydown", onKey); openReader(book, i + 1);
      toast("Split. Rename the new chapter in the list if you like.");
    });
  }

  // a corrected manuscript: chapters are matched by title; you choose which ones take the new text (recordings stay)
  async function updateManuscript(book) {
    const file = await new Promise(res => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".docx"; inp.onchange = () => res(inp.files[0]); inp.click(); });
    if (!file) return;
    let raw;
    try { const full = Object.keys(book.parts || {}).some(k => k.startsWith("c:")); raw = await window.readDocx(await file.arrayBuffer(), { fullCast: full }); }
    catch (e) { toast("Couldn't read that file: " + e.message); return; }
    const blocks = raw.map(b => Object.assign({}, b)), det = Prep.detect(blocks, "auto"), fresh = Prep.buildChapters(blocks, det.starts);
    const key = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const textOf = c => c.paras.map(Prep.paraText).join("\n");
    const rows = [];
    // "Chapter 5" in the file is "Chapter 5: The Dark Wood" here, or the other way round (never Chapter 50)
    const headMatch = (a, b) => a === b || (a.length < b.length ? b.startsWith(a + " ") : a.startsWith(b + " "));
    const findOld = t => book.chapters.find(c => key(c.title) === key(t)) || book.chapters.find(c => headMatch(key(c.title), key(t)));
    // one chapter on its own with no heading the Lamp Room recognises: ask which chapter it replaces
    const real = fresh.filter(nc => nc.title !== "Front matter");
    if (real.length <= 1 && !(real[0] && findOld(real[0].title))) return pickChapterFor(book, file, Prep.buildChapters(blocks, [])[0], textOf);
    fresh.forEach((nc, k) => {
      const old = findOld(nc.title);
      if (old) { if (textOf(old) !== textOf(nc)) rows.push({ nc, old, rec: Object.values(old.audio || {}).some(a => a && (a.tracks || []).some(t => (t.clips || []).length)) }); }
      else if (nc.title !== "Front matter") rows.push({ nc, k, add: true, prev: k ? fresh[k - 1].title : null });
    });
    if (!rows.length) { toast("Nothing's different: every chapter in that file matches what's here."); return; }
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader" style="max-width:640px"><h2>Update the manuscript</h2>
      <p class="small muted">From ${esc(file.name)}. Ticked chapters take the new text. Recordings, notes and status stay. A chapter that's already recorded keeps its audio, but its word timing may drift where the text changed, so it's unticked to start.</p>
      <table class="ch"><tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" data-u="${i}" ${r.rec ? "" : "checked"}></td><td><b>${esc(r.nc.title)}</b>${r.add ? ` <span class="small muted">new chapter${r.prev ? ", after " + esc(r.prev) : ""}</span>` : ""}${r.rec ? ` <span class="small" style="color:var(--warn)">recorded</span>` : ""}</td>
        <td class="num">${r.add ? "" : num(r.old.words) + " →"} ${num(r.nc.words)} words</td></tr>`).join("")}</tbody></table>
      <div class="row" style="margin-top:12px"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" data-go>Update ticked chapters</button></div></div>`;
    document.body.appendChild(ov);
    $("[data-x]", ov).onclick = () => ov.remove();
    $("[data-go]", ov).onclick = () => {
      let n = 0;
      rows.forEach((r, i) => {
        if (!$(`[data-u="${i}"]`, ov).checked) return; n++;
        if (r.add) { const at = r.prev ? book.chapters.findIndex(c => key(c.title) === key(r.prev)) + 1 : 0; book.chapters.splice(at > 0 ? at : book.chapters.length, 0, r.nc); }
        else { r.old.paras = r.nc.paras; r.old.words = r.nc.words; }
      });
      ov.remove(); if (!n) return;
      Store.saveBook(book, true); viewBook(); toast("Updated " + n + " chapter" + (n === 1 ? "" : "s") + ".");
    };
  }

  function pickChapterFor(book, file, nc, textOf) {
    const m = /(?:ch(?:apter)?|ep(?:isode)?)[\s_\-.]*0*(\d{1,3})/i.exec(file.name), guess = m ? book.chapters.findIndex(c => new RegExp("^(chapter|episode)\\s+0*" + m[1] + "(\\b|$)", "i").test(c.title)) : -1;
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader" style="max-width:560px"><h2>Which chapter is this?</h2>
      <p class="small muted">${esc(file.name)} holds one chapter (${num(nc.words)} words), and it doesn't start with a heading the Lamp Room recognises. Pick the chapter it replaces. Recordings, notes and status stay; if that chapter is already recorded, its word timing may drift where the text changed.</p>
      <label>Replaces<select id="pcf"><option value="">Choose a chapter…</option>${book.chapters.map((c, i) => `<option value="${i}" ${i === guess ? "selected" : ""}>${esc(c.title)} · ${num(c.words)} words</option>`).join("")}<option value="new">Add it as a new chapter at the end</option></select></label>
      <p class="small muted" id="pcfp" style="margin-top:8px"></p>
      <div class="row" style="margin-top:12px"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" data-go ${guess >= 0 ? "" : "disabled"}>Replace it</button></div></div>`;
    document.body.appendChild(ov);
    const sel = $("#pcf", ov), go = $("[data-go]", ov), prev = $("#pcfp", ov);
    const upd = () => { const v = sel.value; go.disabled = v === ""; go.textContent = v === "new" ? "Add it" : "Replace it";
      prev.textContent = v === "" || v === "new" ? "" : book.chapters[+v].title + ": " + num(book.chapters[+v].words) + " → " + num(nc.words) + " words. Starts: “" + textOf(nc).slice(0, 90) + "…”"; };
    sel.onchange = upd; upd();
    $("[data-x]", ov).onclick = () => ov.remove();
    go.onclick = () => {
      const v = sel.value; if (v === "") return;
      if (v === "new") { nc.title = file.name.replace(/\.docx$/i, ""); book.chapters.push(nc); }
      else { const old = book.chapters[+v]; old.paras = nc.paras; old.words = nc.words; old.included = true; }
      ov.remove(); Store.saveBook(book, true); viewBook(); toast(v === "new" ? "Added it as a new chapter." : "Updated " + book.chapters[+v].title + ".");
    };
  }

  function openRedetect(book) {
    const blocks = [];
    book.chapters.forEach(c => c.paras.forEach(p => blocks.push({ text: p, heading: false, brk: p === Prep.SCENE_MARK })));
    const touched = book.chapters.some(c => c.status !== "todo" || c.notes);
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader"><h2>Re-split chapters</h2>
      ${touched ? `<p class="small" style="color:var(--bad)">Some chapters already have a status or notes. Re-splitting resets every chapter to “Not started” and clears chapter notes.</p>` : ""}
      <label>Split on<select id="rm">${Object.entries(Prep.METHOD_LABELS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
      <div id="rp" style="margin:12px 0"></div>
      <div class="row"><div class="spacer"></div><button class="btn quiet" data-x>Cancel</button><button class="btn primary" id="rgo">Use these chapters</button></div></div>`;
    document.body.appendChild(ov);
    let chs = [];
    const prev = () => { const r = Prep.detect(blocks, $("#rm", ov).value); chs = Prep.buildChapters(blocks, r.starts);
      $("#rp", ov).innerHTML = `<div class="small muted" style="margin-bottom:6px">${chs.length} chapters${$("#rm", ov).value === "auto" ? " · found by: " + esc(Prep.METHOD_LABELS[r.method.split("+")[0]] || r.method) : ""}</div><div class="preview-list">${chs.map(c => `<div class="${c.included ? "" : "ex"}"><span>${esc(c.title)}</span><span>${num(c.words)}</span></div>`).join("")}</div>`; };
    $("#rm", ov).onchange = prev; prev();
    $("[data-x]", ov).onclick = () => ov.remove();
    $("#rgo", ov).onclick = () => { book.chapters = chs; Store.saveBook(book); ov.remove(); viewBook(); };
  }

  // ---------------- import ----------------
  let imp = null;
  function viewImport() {
    imp = imp || { opts: { sceneBreaks: true, normalizePunct: false, joinBrokenLines: false }, method: "auto" };
    const forT = route.q && route.q.get("title") ? LL.tById(route.q.get("title")) : null;
    if (forT) { imp.forTitle = forT.id; if (!imp.title) imp.title = forT.name; if (!imp.client) imp.client = forT.client || ""; }
    if (!imp.raw) {
      main().innerHTML = `<h1>${forT ? "Manuscript for " + esc(forT.name) : "New book"}</h1>
        <div class="drop card" id="drop"><h2>Drop a manuscript here</h2><p class="muted">Word (.docx) — or click to browse.</p><input type="file" id="file" accept=".docx" class="hidden"></div>
        <div class="card"><h3>…or paste the text</h3><textarea id="paste" style="min-height:160px" placeholder="Paste the whole manuscript"></textarea><div class="row" style="margin-top:10px"><div class="spacer"></div><button class="btn" id="usepaste">Use pasted text</button></div></div>`;
      const d = $("#drop"), f = $("#file");
      d.onclick = () => f.click();
      d.ondragover = e => { e.preventDefault(); d.classList.add("over"); };
      d.ondragleave = () => d.classList.remove("over");
      d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
      f.onchange = () => f.files[0] && loadFile(f.files[0]);
      $("#usepaste").onclick = () => { const t = $("#paste").value; if (!t.trim()) return; imp.file = null; imp.raw = Prep.blocksFromPlainText(t); imp.opts.joinBrokenLines = !/\n[ \t]*\n/.test(t); imp.title = imp.forTitle && LL.tById(imp.forTitle) ? LL.tById(imp.forTitle).name : ""; viewImport(); };
      return;
    }
    const B = Prep.cleanBlocks(imp.raw, imp.opts);
    const r = Prep.detect(B, imp.method);
    imp.chapters = Prep.buildChapters(B, r.starts);
    const inc = imp.chapters.filter(c => c.included), words = inc.reduce((a, c) => a + c.words, 0);
    const e = Prep.estimate(words, {}, estSettings(null));
    main().innerHTML = `<h1>New book</h1>
      <div class="card"><div class="row">
        <label style="flex:2">Title<input id="it" value="${esc(imp.title || "")}"></label>
        <label style="flex:1">Author<input id="ia" value="${esc(imp.author || "")}"></label>
        <label style="flex:1">Client / publisher<input id="ic" value="${esc(imp.client || "")}"></label>
      </div><div class="small muted" style="margin-top:8px">${imp.file ? "From " + esc(imp.file.name) + " — a copy is kept in the book's manuscript folder." : "From pasted text."}</div></div>
      <div class="card"><div class="row">
        <label>Split chapters on<select id="im">${Object.entries(Prep.METHOD_LABELS).map(([k, l]) => `<option value="${k}" ${imp.method === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="check"><input type="checkbox" id="o-sb" ${imp.opts.sceneBreaks ? "checked" : ""}> Mark scene breaks (* * *, #, ~) as ⁂</label>
        <label class="check"><input type="checkbox" id="o-np" ${imp.opts.normalizePunct ? "checked" : ""}> Curly quotes, em dashes, ellipses</label>
        <label class="check"><input type="checkbox" id="o-jb" ${imp.opts.joinBrokenLines ? "checked" : ""}> Re-join hard-wrapped lines</label>
      </div>
      <div class="tiles"><div class="tile"><span>Chapters</span><b>${inc.length}</b><em>${imp.method === "auto" ? "found by: " + esc(Prep.METHOD_LABELS[r.method.split("+")[0]] || "nothing — one chunk") : ""}</em></div>
        <div class="tile"><span>Words</span><b>${num(words)}</b><em>front matter excluded</em></div>
        <div class="tile"><span>Finished hours</span><b>${fh(e.fh)}</b></div>
        <div class="tile"><span>Booth time</span><b>${hrs(e.perNarrator[0].boothHours)}</b><em>${esc(e.perNarrator[0].name || "")} at ${num(e.perNarrator[0].pace)} w/h</em></div></div>
      ${impParts()}
      <div class="preview-list">${imp.chapters.map(c => `<div class="${c.included ? "" : "ex"}"><span>${esc(c.title)}${c.included ? "" : " (not counted)"}</span><span>${num(c.words)}</span></div>`).join("")}</div>
      <p class="small muted">Wrong splits? Pick a different rule above, or fix individual chapters after — merge, split and rename all work in the book view.</p>
      <div class="row"><button class="btn quiet" id="restart">Start over</button><div class="spacer"></div><button class="btn primary" id="create">Create book</button></div></div>`;
    const keep = () => { imp.title = $("#it").value; imp.author = $("#ia").value; imp.client = $("#ic").value; };
    $("#im").onchange = e => { keep(); imp.method = e.target.value; viewImport(); };
    [["#o-sb", "sceneBreaks"], ["#o-np", "normalizePunct"], ["#o-jb", "joinBrokenLines"]].forEach(([id, k]) => $(id).onchange = e => { keep(); imp.opts[k] = e.target.checked; viewImport(); });
    $$("[data-ipart]").forEach(el => el.onchange = () => { keep(); imp.parts[el.dataset.ipart] = el.value; });
    wireCastSheet(() => imp.chapters.filter(c => c.included), (res, rows, name) => { keep(); imp.castNames = imp.castNames || {}; imp.parts = imp.parts || {}; const missed = LRCastSheet.apply(res, imp.parts, imp.castNames); imp.cs = { res, rows, name, missed }; viewImport(); });
    const fc = $("#fullcast"); if (fc) fc.onchange = async () => { keep(); imp.fullCast = fc.checked; imp.parts = {}; imp.raw = await window.readDocx(imp.buf.slice(0), { fullCast: imp.fullCast }); viewImport(); };
    $("#restart").onclick = () => { imp = null; viewImport(); };
    $("#create").onclick = async () => {
      keep();
      if (!imp.title.trim()) { $("#it").focus(); toast("Give the book a title first."); return; }
      const S = Store.settings;
      const book = { version: 1, id: Prep.uid(), title: imp.title.trim(), author: imp.author.trim(), client: imp.client.trim(),
        color: INKS[Store.books.length % INKS.length], due: "", rate: { type: "pfh", amount: "" }, myShare: 100,
        cast: [{ name: (S.narrators[0] || {}).name || "Me", share: 100 }], status: "active", notes: "",
        source: { file: imp.file ? imp.file.name : null, method: imp.method, options: imp.opts }, chapters: imp.chapters };
      if (imp.hasParts) book.parts = Object.assign({}, imp.parts);
      if (imp.castNames && Object.keys(imp.castNames).length) book.castNames = Object.assign({}, imp.castNames);
      if (imp.cs) book.castSheet = imp.cs.rows;
      $("#create").disabled = true;
      try {
        // every book joins the schedule: its own title, or the one it was imported for
        const tFor = imp.forTitle && LL.tById(imp.forTitle);
        if (tFor) { book.titleId = tFor.id; book.color = tFor.color || book.color; book.due = tFor.due || ""; }
        await Store.createBook(book, imp.file); imp = null; cheer("bookCreated");
        let fresh = false;
        if (tFor) { const wb = wordsFor(book); await LL.patch("titles", tFor.id, { stages: (tFor.stages || []).map(s => { if (s.type === "record") { const n = Object.keys(wb).find(n => LL.keyOf(n) === s.owner); if (n) return Object.assign({}, s, { words: Math.round(wb[n]) }); } return s; }) }); }
        else { const id = "t-" + LL.uid(); await LL.put("titles", id, titleFromBook(book)); book.titleId = id; Store.saveBook(book, true); fresh = true; }
        location.hash = "#/book/" + book.id;
        if (fresh && !(Store.testMode && !localStorage.getItem("lr-test-forms"))) setTimeout(() => { toast("On the schedule. Add the client, pay and due date so the planner can place it."); LL.titleForm(structuredClone(LL.tById(book.titleId))); }, 300);
      }
      catch (err) { $("#create").disabled = false; toast("Couldn't save: " + err.message); }
    };
  }
  // who can read a part: the two of you, plus outside cast who just send files
  const CAST = ["Cast 1", "Cast 2", "Cast 3", "Cast 4"];
  function readerOptions(sel, book) {
    const S = Store.settings, names = S.narrators.map(n => n.name);
    return `<optgroup label="Narrators">${names.map(n => `<option ${sel === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</optgroup><optgroup label="Outside cast (send files)">${CAST.map(n => `<option value="${n}" ${sel === n ? "selected" : ""}>${n}${book && Store.castName(book, n) !== n ? " · " + esc(Store.castName(book, n)) : ""}</option>`).join("")}</optgroup>`;
  }
  const partSwatch = k => ({ n: "transparent", m: "#BDD7EE", f: "#F8CBDE", s: "#FFF59D" }[k] || Prep.colorCss(k));
  // casting sheet (js/castsheet.js): a button above a parts table, and what it found for each colour
  function castSheetBar(cs) {
    return `<div class="row castsheet" style="align-items:center;gap:10px;margin:4px 0 8px"><button class="btn small" id="cs-btn">📋 ${cs ? "Another casting sheet…" : "Use a casting sheet…"}</button><input type="file" id="cs-file" accept=".csv,.tsv,.txt" class="hidden">
      <span class="small muted">${cs ? `From ${esc(cs.name)}: ${cs.rows.length} characters, ${cs.res.actors.length} actors.${cs.res.unplaced.length ? ` <b>No colour found for</b> ${cs.res.unplaced.map(esc).join(", ")}.` : ""}${cs.missed && cs.missed.length ? ` <b>No free Cast slot for</b> ${cs.missed.map(esc).join(", ")}.` : ""} Check each row, then change any that look wrong.` : "A CSV with a Character and an Actor column (from your sheet: File ▸ Download ▸ CSV). It fills in who reads each colour and the cast's real names."}</span></div>`;
  }
  function castSheetCell(cs, k) {
    const a = cs.res.parts[k]; if (!a) return k === "n" ? '<span class="muted">no narrator row</span>' : '<span class="muted">couldn\'t tell</span>';
    const chars = k === "n" ? "narration" : cs.res.charsOf(a).slice(0, 4).join(", ") + (cs.res.charsOf(a).length > 4 ? "…" : "");
    const sc = cs.res.score[k] || {}, tot = Object.values(sc).reduce((x, y) => x + y, 0), sure = k === "n" || !tot ? "" : Math.round(sc[a] / tot * 100) < 60 ? ` <span class="warn" title="Other actors' characters are named around these lines too">· check</span>` : "";
    return `<b>${esc(a)}</b> <span class="muted">(${esc(chars)})</span>${sure}`;
  }
  function wireCastSheet(chapters, done) {
    const b = $("#cs-btn"), f = $("#cs-file"); if (!b || !f) return;
    b.onclick = () => f.click();
    f.onchange = async () => { const file = f.files[0]; if (!file) return;
      const p = LRCastSheet.parse(await file.text()); if (p.error) { toast(p.error); return; }
      done(LRCastSheet.match(chapters(), p.rows), p.rows, file.name); };
  }
  // highlight colours found in the manuscript → who reads each
  function impParts() {
    const found = Prep.partsInBook({ chapters: imp.chapters.filter(c => c.included) });
    const keys = Object.keys(found).filter(k => k !== "n");
    imp.hasParts = keys.length > 0;
    if (!imp.hasParts) return "";
    const S = Store.settings, me = Store.me() || (S.narrators[0] || {}).name;
    imp.parts = imp.parts || {};
    ["n", ...keys].forEach(k => { if (!imp.parts[k]) imp.parts[k] = me; });
    return `<div class="card" style="background:var(--panel2)"><h3>Highlights found — who reads each part?</h3>
      ${imp.buf ? `<label class="check"><input type="checkbox" id="fullcast" ${imp.fullCast ? "checked" : ""}> <b>Full cast:</b> every highlight colour is a different voice${imp.colors ? ` (${imp.colors} colour${imp.colors === 1 ? "" : "s"} in this file)` : ""}. Off: blues, pinks and yellow are grouped as male, female and system.</label>` : ""}
      ${castSheetBar(imp.cs)}
      <table class="ch"><thead><tr><th>Part</th><th class="num">Passages</th><th class="num">Words</th><th>Read by</th>${imp.cs ? "<th>From the casting sheet</th>" : ""}</tr></thead><tbody>
      ${["n", ...keys].map(k => `<tr><td><span class="sw" style="background:${partSwatch(k)}"></span> ${esc(Prep.partLabel(k))}</td><td class="num">${num((found[k] || {}).passages || 0)}</td><td class="num">${num((found[k] || {}).words || 0)}</td>
        <td><select data-ipart="${esc(k)}">${readerOptions(imp.parts[k], { castNames: imp.castNames || {} })}</select></td>${imp.cs ? `<td class="small">${castSheetCell(imp.cs, k)}</td>` : ""}</tr>`).join("")}
      </tbody></table><p class="small muted">Outside cast (Cast 1–4) never open the Lamp Room: they send you a recording and you drop it into the Booth's Collaborate tab, where it's cut into their lines. You can change all of this later in the book's details.</p></div>`;
  }
  async function loadFile(file) {
    main().innerHTML = `<div class="card welcome"><p>Reading ${esc(file.name)}…</p></div>`;
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let raw;
      if (ext === "docx") {
        imp.buf = await file.arrayBuffer();
        raw = await window.readDocx(imp.buf.slice(0), { fullCast: imp.fullCast });
        // more highlight colours than blue/pink/yellow can hold? Then each colour is its own voice.
        if (imp.fullCast == null) { const fam = new Set(raw.flatMap(b => (b.runs || []).map(r => r[1])).filter(k => k !== "n")); if (raw.colors.length >= 4 && raw.colors.length > fam.size) { imp.fullCast = true; raw = await window.readDocx(imp.buf.slice(0), { fullCast: true }); } }
        imp.colors = raw.colors.length;
      }
      else throw new Error("The Lamp Room reads Word .docx files. Save it as .docx, or paste the text instead.");
      if (!raw.length || raw.reduce((a, b) => a + b.text.length, 0) < 200) throw new Error("Hardly any text came out of that file.");
      imp.raw = raw; imp.file = file;
      imp.title = imp.forTitle && LL.tById(imp.forTitle) ? LL.tById(imp.forTitle).name : file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\b(final|manuscript|ms|draft|v\d+|copy)\b/gi, "").replace(/\s+[-–]\s*$/, "").replace(/\s+/g, " ").trim();
      imp.opts.joinBrokenLines = false;
    } catch (e) { imp.raw = null; toast(e.message); }
    viewImport();
  }
  // ---------------- calculator ----------------
  function viewCalc() {
    const S = Store.settings;
    const c = viewCalc.s = viewCalc.s || { words: 90000, rate: { type: "pfh", amount: 250 }, myShare: 100, cast: [{ name: (S.narrators[0] || {}).name, share: 100 }], due: "" };
    const e = Prep.estimate(c.words, c, estSettings(null)), days = c.due ? Prep.workdaysUntil(c.due) : null;
    main().innerHTML = `<h1>Tools</h1><h2>Word &amp; time calculator</h2>
      <div class="card"><div class="row">
        <label>Words<input type="number" id="cw" value="${c.words}" style="width:130px"></label>
        <label>Narrator<select id="cn">${S.narrators.map(n => `<option ${n.name === c.cast[0].name ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>
        <label>Rate type<select id="crt">${RATE_TYPES.map(([k, l]) => `<option value="${k}" ${c.rate.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Amount ($)<input type="number" step="0.001" id="cra" value="${c.rate.amount}" style="width:110px"></label>
        <label>My share (%)<input type="number" id="csh" value="${c.myShare}" style="width:80px"></label>
        <label>Due date<input type="date" id="cd" value="${c.due}"></label>
      </div>
      <details style="margin-top:12px"><summary class="small">Count words in pasted text</summary><textarea id="ct" placeholder="Paste text — the word count above updates"></textarea></details>
      <div class="tiles">
        <div class="tile"><span>Finished hours</span><b>${fh(e.fh)}</b><em>${hrs(e.fh)} of audio</em></div>
        <div class="tile"><span>Booth time</span><b>${hrs(e.perNarrator[0].boothHours)}</b><em>at ${num(e.perNarrator[0].pace)} words / hr</em></div>
        <div class="tile"><span>Booth days</span><b>${e.days.toFixed(1)}</b><em>${LRPace.hoursPerDay(c.cast[0].name)} hrs / day · done ${esc(prettyDate(Prep.addWorkdays(e.days)))}</em></div>
        <div class="tile"><span>Pay</span><b>${money(e.mine)}</b><em>${e.gross !== e.mine ? "of " + money(e.gross) : ""}</em></div>
        ${days != null ? `<div class="tile"><span>Workdays to due</span><b>${days}</b><em>${num(days ? c.words / days : c.words)} words / day needed</em></div>` : ""}
      </div></div>`;
    const upd = () => { c.words = Number($("#cw").value) || 0; c.cast = [{ name: $("#cn").value, share: 100 }]; c.rate = { type: $("#crt").value, amount: Number($("#cra").value) || 0 }; c.myShare = Number($("#csh").value); c.due = $("#cd").value; viewCalc(); };
    $$("#main input:not(#ct), #main select").forEach(el => el.onchange = upd);
    $("#ct").oninput = e => { $("#cw").value = Prep.countWords(e.target.value); clearTimeout(viewCalc.t); viewCalc.t = setTimeout(() => { const keepOpen = true; upd(); if (keepOpen) { $("#main details").open = true; $("#ct").value = e.target.value; $("#ct").focus(); } }, 500); };
  }

  // ---------------- settings ----------------
  let B_openClient = null;
  // ---- shared projects ----
  async function joinSharedFlow() {
    let h; try { h = await Store.pickSharedFolder(); } catch (e) { return; }
    try {
      const p = await Store.readProject(h); if (!p) { toast("That folder has no project.json. Choose the book's shared folder (the one with Chapters, Pickups and Finished in it)."); return; }
      const me = Store.me(), on = (p.people || []).find(x => x.name === me);
      if (!on && !confirm("You're working as “" + me + "”, and this book's list is: " + ((p.people || []).map(x => x.name + " (" + x.role + ")").join(", ") || "empty") + ". Join anyway? (Ask the book's owner to add you, or switch who's working here first.)")) return;
      const book = await Store.joinShared(h, me);
      toast("Joined “" + book.title + "”" + (on ? " as " + on.role : "") + "."); location.hash = "#/book/" + book.id;
    } catch (e) { toast(e.message); }
  }
  const ROLES = [["lead", "Lead narrator"], ["narrator", "Co-narrator"], ["cast", "Cast"], ["outside", "Outside (sends a file)"]];
  function sharedCard(book) {
    const me = Store.me(), owner = !book.shared || book.sharedOwner === me, people = book.sharedPeople || [];
    if (!book.shared) return `<details class="card" id="sharedc"><summary>Shared project <span class="small muted">· for co-narrators and cast</span></summary>
      <p class="small muted" style="margin-top:10px">Make an empty folder in Google Drive, share it with everyone on this book, then choose it here. The Lamp Room keeps the book there (text, parts, credits), plus everyone's shared takes, line clips, pickups and finished chapters. Your Ledger, money, sessions and other books stay private.</p>
      <div class="row"><div class="spacer"></div><button class="btn primary" id="shsetup">Set up a shared folder…</button></div></details>`;
    const narr = [...new Set(Object.values(book.parts || {}).filter(Boolean))];
    return `<details class="card" id="sharedc" ${sharedOpenUI[book.id] ? "open" : ""}><summary>Shared project <span class="small muted" id="shstat">· checking…</span></summary>
      <p class="small muted" style="margin-top:10px">${owner ? "You own this book's shared folder: changes to the text, parts and credits go there when you save." : "Shared by " + esc(book.sharedOwner || "the owner") + ". Their text updates come to you when you open the book."}</p>
      <div class="section-label">Who's on it</div>
      <datalist id="allpeople">${(Store.settings.people || []).map(p => `<option value="${esc(p.full || p.name)}">`).join("")}</datalist>
      ${people.map((x, i) => `<div class="cast-row"><label style="flex:1">Name<input ${owner ? "" : "disabled"} data-shp="${i}" data-k="name" value="${esc(x.name)}" list="allpeople"></label><label>Role<select ${owner ? "" : "disabled"} data-shp="${i}" data-k="role">${ROLES.map(([v, l]) => `<option value="${v}" ${x.role === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>${owner ? `<button class="btn small quiet" data-shpdel="${i}">✕</button>` : ""}</div>`).join("") || `<p class="small muted">No one yet.</p>`}
      <p class="small muted">Someone reading without the Lamp Room? Set them to <b>Outside (sends a file)</b>: the lead (or whoever's splicing) drops their recording into the Booth's 🤝 Collaborate tab. Anyone else can still get the takes from the shared Drive folder the old way.</p>
      ${owner ? `<button class="btn small" id="shadd">+ Person</button>${narr.filter(n => !people.some(x => x.name === n)).length ? ` <button class="btn small quiet" id="shfill">Add everyone reading parts</button>` : ""}` : ""}
      <div class="row" style="margin-top:10px"><button class="btn small" id="shconn">Connect this computer to the folder…</button><div class="spacer"></div>${owner ? `<button class="btn small" id="shpush">Update the shared copy now</button>` : ""}</div></details>`;
  }
  const sharedOpenUI = {};
  function bindShared(book, save) {
    // the editor role is retired: anyone listed as Editor now reads as Outside (their name stays on the list)
    if (book.shared && book.sharedOwner === Store.me() && (book.sharedPeople || []).some(x => x.role === "editor" || x.edits)) { book.sharedPeople.forEach(x => { if (x.role === "editor") x.role = "outside"; delete x.edits; }); save(false); }
    const el = $("#sharedc"); if (!el) return;
    el.ontoggle = () => { sharedOpenUI[book.id] = el.open; };
    const me = Store.me();
    const su = $("#shsetup", el); if (su) su.onclick = async () => {
      let h; try { h = await Store.pickSharedFolder(); } catch (e) { return; }
      const ex = await Store.readProject(h).catch(() => null); if (ex && ex.id !== book.id && !confirm("That folder already holds “" + ex.title + "”. Use it for this book instead?")) return;
      book.shared = true; book.sharedOwner = me;
      const narr = [...new Set(Object.values(book.parts || {}).filter(Boolean))];
      book.sharedPeople = book.sharedPeople && book.sharedPeople.length ? book.sharedPeople : narr.map(n => ({ name: n, role: n === (book.parts || {}).n ? "lead" : "narrator" }));
      await Store.rememberShared(book, h); await Store.writeProject(book); sharedOpenUI[book.id] = true; save(true);
      toast("Shared folder set up. Add your co-narrators and cast under Who's on it, then share the Drive folder with everyone.");
    };
    $$("[data-shp]", el).forEach(i => i.onchange = () => { book.sharedPeople[+i.dataset.shp][i.dataset.k] = i.value.trim(); sharedOpenUI[book.id] = true; save(true); });
    $$("[data-shpdel]", el).forEach(b => b.onclick = () => { book.sharedPeople.splice(+b.dataset.shpdel, 1); sharedOpenUI[book.id] = true; save(true); });
    const ad = $("#shadd", el); if (ad) ad.onclick = () => { (book.sharedPeople = book.sharedPeople || []).push({ name: "", role: "narrator" }); sharedOpenUI[book.id] = true; save(true); };
    const fl = $("#shfill", el); if (fl) fl.onclick = () => { for (const n of new Set(Object.values(book.parts || {}).filter(Boolean))) if (!book.sharedPeople.some(x => Store.samePerson(x.name, n))) book.sharedPeople.push({ name: n, role: n === (book.parts || {}).n ? "lead" : "narrator" }); save(true); };
    const cn = $("#shconn", el); if (cn) cn.onclick = async () => {
      let h = await Store.sharedHandle(book, true);
      if (!h) { try { h = await Store.pickSharedFolder(); } catch (e) { return; } const p = await Store.readProject(h).catch(() => null); if (p && p.id !== book.id) { toast("That folder belongs to “" + p.title + "”."); return; } await Store.rememberShared(book, h); }
      if (book.sharedOwner === me) await Store.writeProject(book); else await Store.refreshFromShared(book);
      sharedOpenUI[book.id] = true; viewBook(); toast("This computer is connected to the shared folder.");
    };
    const pu = $("#shpush", el); if (pu) pu.onclick = async () => { if (await Store.writeProject(book)) toast("Shared copy updated."); else toast("Connect this computer to the folder first."); };
    Store.sharedHandle(book).then(h => { const s = $("#shstat"); if (s) s.textContent = h ? "· connected on this computer" : "· not connected on this computer yet"; });
  }
  // ---- credits on the book page: which client, the details the credits need, cast credit tags, then add/update the credit chapters ----
  // character scripts: who speaks each line and how, shown in the Booth as tags and a cue window
  const csOpen = {};
  function charScriptsCard(book) {
    const list = (book.cues && book.cues.scripts) || [];
    let miss = null;
    if (csOpen[book.id] && list.length) { const cache = new Map(); miss = LRCues.unplaced(book, c => cache.get(c) || (cache.set(c, Prep.tokens(c)), cache.get(c))); }
    const missOf = id => miss ? miss.filter(m => m.sid === id).length : 0;
    // Read by: worked out from the highlighting when the card is open; the Lead can name it and sees the disagreements
    let rd = null; if (csOpen[book.id] && list.length) { const cache = new Map(); rd = LRCues.readers(book, c => cache.get(c) || (cache.set(c, Prep.tokens(c)), cache.get(c))); }
    const lead = Store.isLead(book), names = [...new Set([...(Store.settings.people || []).map(p => p.name), ...Object.keys(book.castNames || {}).map(k => book.castNames[k]), ...Object.values(book.parts || {}).filter(v => v && !/^Cast \d+$/.test(v))])];
    const readBySel = x => { const r = rd && rd[x.id], cur = x.readBy || "";
      return `<label class="small" title="${r && r.guessed && r.guess ? "Guessed from the highlighting: " + esc(r.guess) : "Who reads this script's lines"}">Read by<select data-csby="${x.id}" ${lead ? "" : "disabled"}><option value="">${r && r.guess ? "Highlighting says " + esc(r.guess) : "—"}</option>${names.map(n => `<option ${Store.samePerson(n, cur) && cur ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`; };
    const offAll = rd ? list.flatMap(x => (rd[x.id] ? rd[x.id].off : []).map(o => Object.assign({ readBy: rd[x.id].readBy }, o))) : [];
    return `<details class="card" id="cscripts" ${csOpen[book.id] ? "open" : ""}><summary>Character scripts ${list.length ? `<span class="small muted">· ${list.map(x => esc(x.char)).join(", ")}</span>` : '<span class="small muted">· optional</span>'}</summary>
      <p class="small muted" style="margin-top:10px">${book.shared ? "In a shared book, scripts the owner adds go to everyone; ones you add stay with you. " : ""}Add an actor script (.docx: a chapter heading, then each line's NAME, its (tone) and the words). In the Booth, each line gets a tag saying who speaks it and how, and a cue window follows your reading, with the line you're answering. Click a name to open its Character guide. Nothing shows in books without one.</p>
      ${list.map(x => `<div class="cast-row"><b style="flex:1">${esc(x.char)}</b>${rd ? readBySel(x) : ""}<span class="small muted">${LRCues.tidyLines(x.lines).length} lines${miss ? ` · ${LRCues.tidyLines(x.lines).length - missOf(x.id)} placed` : ""} · ${esc(x.file || "")}</span><button class="btn small" data-csre="${x.id}" title="A newer version of this script">Replace</button><button class="btn small ghost" data-csdel="${x.id}" title="Remove">✕</button></div>`).join("")}
      <div class="row" style="margin-top:8px"><button class="btn" id="csadd">+ Add a character script</button></div>
      ${lead && offAll.length ? `<details style="margin-top:10px" open><summary class="small"><b>${offAll.length} line${offAll.length === 1 ? "" : "s"} where the script and the highlighting disagree</b></summary>
        <p class="small muted" style="margin:6px 0">Fix the highlight in the Booth (select the words, pick the reader), or change the script's Read by. Or, since the actors read from their scripts: <button class="btn small" id="csfollow">Give all ${offAll.length} to the reader their script names</button></p>
        <div class="small" style="max-height:260px;overflow:auto">${offAll.map(o => `<div class="ask-row"><div><b>${esc(o.char)}</b> <span class="muted">· ${esc(o.c.title)} · script: ${esc(o.readBy)} · highlighted: ${esc(o.hl)}</span><div>${esc(o.text.length > 140 ? o.text.slice(0, 140) + "…" : o.text)}</div></div><div class="ask-act"><a class="btn small quiet" href="#/booth/${esc(book.id)}/${book.chapters.indexOf(o.c)}">Go</a></div></div>`).join("")}</div></details>` : ""}
      ${miss && miss.length ? `<details style="margin-top:10px"><summary class="small">${miss.length} line${miss.length === 1 ? "" : "s"} couldn't be placed</summary><div class="small" style="max-height:240px;overflow:auto">${miss.map(m => `<div style="margin:4px 0"><b>${esc(m.char)}</b> · ${esc(m.ch || "?")} <span class="muted">(${esc(m.why)})</span><br>“${esc(m.text.slice(0, 160))}”</div>`).join("")}</div><p class="small muted">Usually the manuscript changed after the script was made. These lines just don't get a cue.</p></details>` : ""}
    </details>`;
  }
  function bindCharScripts(book, save) {
    const el = $("#cscripts"); if (!el) return;
    { const fb = $("#csfollow", el); if (fb) fb.onclick = () => {
      const cache = new Map(), rd = LRCues.readers(book, c => cache.get(c) || (cache.set(c, Prep.tokens(c)), cache.get(c)));
      const offs = Object.values(rd).flatMap(r => r.off.map(o => Object.assign({ readBy: r.readBy }, o)));
      if (!offs.length || !confirm("Give " + offs.length + " line" + (offs.length === 1 ? "" : "s") + " to the reader their script names? This changes the book's highlighting for everyone (a backup is kept).")) return;
      // the script's reader, as the book knows them: a narrator by name, or the Cast slot holding that name
      const readerOfName = n => { const cast = Object.keys(book.castNames || {}).find(k => Store.samePerson(book.castNames[k], n)); if (cast) return cast; const team = (Store.settings.narrators || []).find(x => Store.samePerson(x.name, n)); return team ? team.name : n; };
      const parts = book.parts = book.parts || {};
      const partFor = r => { if (parts.n === r && !Object.keys(parts).some(k => k !== "n" && parts[k] === r)) return "n"; let k = Object.keys(parts).find(k => k !== "n" && parts[k] === r); if (!k) { k = "r:" + r; parts[k] = r; } return k; };
      // last first in each chapter, so earlier word numbers stay put (they don't move, but it costs nothing)
      offs.sort((x, y) => y.a - x.a).forEach(o => Prep.setPart(o.c, o.a, o.b, partFor(readerOfName(o.readBy))));
      save(true); toast("✓ " + offs.length + " lines now follow the actors' scripts."); viewBook(); }; }
    $$("[data-csby]", el).forEach(sel => sel.onchange = () => { const x = (book.cues.scripts || []).find(z => z.id === sel.dataset.csby); if (!x) return; if (sel.value) x.readBy = sel.value; else delete x.readBy; save(true); });
    el.ontoggle = () => { const was = !!csOpen[book.id]; csOpen[book.id] = el.open; if (el.open && !was && LRCues.has(book)) viewBook(); };
    const pick = () => new Promise(res => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".docx"; inp.onchange = () => res(inp.files[0]); inp.click(); });
    const load = async (replaceId) => {
      const f = await pick(); if (!f) return;
      let sc; try { sc = LRCues.parse(await window.readDocx(await f.arrayBuffer(), {}), f.name); } catch (e) { toast("Couldn't read that file: " + e.message); return; }
      if (!sc.lines.length) { toast("No lines found. A character script has a chapter heading, then NAME, (tone) and the line."); return; }
      book.cues = book.cues || { scripts: [] }; book.cues.scripts = book.cues.scripts || [];
      const old = replaceId ? book.cues.scripts.find(x => x.id === replaceId) : book.cues.scripts.find(x => x.char === sc.char);
      const rec = { id: old ? old.id : Prep.uid(), char: sc.char, file: f.name, added: new Date().toISOString(), lines: sc.lines, mine: !!(book.shared && book.sharedOwner && book.sharedOwner !== Store.me()) };
      if (old) book.cues.scripts.splice(book.cues.scripts.indexOf(old), 1, rec); else book.cues.scripts.push(rec);
      csOpen[book.id] = true; save(true); toast("🎭 " + sc.char + ": " + sc.lines.length + " lines" + (old ? " (replaced)" : ""));
    };
    const ad = $("#csadd", el); if (ad) ad.onclick = () => load(null);
    $$("[data-csre]", el).forEach(b => b.onclick = () => load(b.dataset.csre));
    $$("[data-csdel]", el).forEach(b => b.onclick = () => { if (!confirm("Remove this character script? Its cues go too.")) return; book.cues.scripts = book.cues.scripts.filter(x => x.id !== b.dataset.csdel); csOpen[book.id] = true; save(true); });
  }
  function creditsCard(book) {
    const cr = book.credits = book.credits || {}, cl = LRCredits.clientOf(book), list = LRCredits.clients(), S = Store.settings;
    const has = book.chapters.some(c => c.credits), b = cl ? LRCredits.build(Object.assign({}, book, { parts: Object.assign({}, book.parts) })) : null;
    const readers = [...new Set([...(S.narrators || []).map(n => n.name), ...Object.values(book.parts || {}).filter(Boolean)])];
    return `<details class="card" id="credits" ${creditsOpen[book.id] ? "open" : ""}><summary>Credits ${has ? '<span class="small muted">· in the manuscript</span>' : cl ? '<span class="small muted">· ready to add</span>' : ""}</summary>
      <div class="row" style="margin-top:12px">
        <label style="flex:1">Client profile<select data-cr="clientId"><option value="">${cl ? "" : "— choose —"}</option>${list.map(c => `<option value="${esc(c.id)}" ${cl && cl.id === c.id ? "selected" : ""}>${esc(c.name || "Unnamed")}</option>`).join("")}</select></label>
        <label style="flex:2" title="Must match the Amazon listing exactly">Title as on Amazon<input data-cr="title" value="${esc(cr.title || "")}" placeholder="${esc(book.title)}"></label>
        <label title="The author's publishing year for this book">Author's year<input data-cr="authorYear" value="${esc(cr.authorYear || "")}" placeholder="2026" style="width:90px"></label></div>
      <div class="row">
        <label style="flex:2">Performed by<input data-cr="performedBy" value="${esc(cr.performedBy || "")}" placeholder="${esc(LRCredits.values(book).PerformedBy || "e.g. the NPC Audiobook Guild")}"></label>
        <label style="flex:1">Production year<input data-cr="year" value="${esc(cr.year || "")}" placeholder="${esc(LRCredits.values(book).Year)}" style="width:90px"></label></div>
      <p class="small muted">Performed by defaults to everyone reading, by their name in credits (Settings ▸ Narrators). For a full cast, write e.g. “the NPC Audiobook Guild” and add each cast member's tag below; each tag goes in that person's script, at the end of the closing credits.</p>
      <div class="section-label" style="margin-top:8px">Cast credit tags</div>
      ${(cr.cast || []).map((t, i) => `<div class="cast-row"><label style="flex:1">Name in credits<input data-ct="${i}" data-k="name" value="${esc(t.name || "")}"></label><label style="flex:2">as…<input data-ct="${i}" data-k="as" value="${esc(t.as || "")}" placeholder="The Narrator and Dottie"></label><label>Read by<select data-ct="${i}" data-k="reader"><option value="">Narrator</option>${readers.map(r => `<option ${t.reader === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label><button class="btn small quiet" data-ctdel="${i}">✕</button></div>`).join("")}
      <button class="btn small" id="addct">+ Cast tag</button>
      ${b ? `<div class="cr-prev"><div class="section-label">Opening credits</div>${b.open.map(p => `<p>${esc(p)}</p>`).join("")}<div class="section-label">Closing credits</div>${b.close.map(p => `<p>${esc(Prep.paraText(p))}</p>`).join("")}</div>` : `<p class="small muted">Choose a client profile to see the credits. Profiles live in Settings ▸ Clients & credits.</p>`}
      <div class="row" style="margin-top:10px"><div class="spacer"></div><button class="btn primary" id="crapply" ${cl ? "" : "disabled"}>${has ? "Update the credit chapters" : "Add credits to the manuscript"}</button></div></details>`;
  }
  const creditsOpen = {};
  function bindCredits(book, save) {
    const el = $("#credits"); if (!el) return;
    el.ontoggle = () => { creditsOpen[book.id] = el.open; };
    const cr = book.credits = book.credits || {};
    $$("[data-cr]", el).forEach(i => i.onchange = () => { const k = i.dataset.cr; if (k === "clientId") book.clientId = i.value; else cr[k] = i.value.trim(); creditsOpen[book.id] = true; save(true); });
    $$("[data-ct]", el).forEach(i => i.onchange = () => { cr.cast[+i.dataset.ct][i.dataset.k] = i.value.trim(); creditsOpen[book.id] = true; save(true); });
    $$("[data-ctdel]", el).forEach(b => b.onclick = () => { cr.cast.splice(+b.dataset.ctdel, 1); creditsOpen[book.id] = true; save(true); });
    $("#addct", el).onclick = () => { (cr.cast = cr.cast || []).push({ name: "", as: "", reader: "" }); creditsOpen[book.id] = true; save(true); };
    const ap = $("#crapply", el); if (ap) ap.onclick = () => {
      let r = LRCredits.apply(book, false);
      if (r.error) { toast(r.error); return; }
      if (r.kept.length && confirm(r.kept.join(" and ") + (r.kept.length > 1 ? " are" : " is") + " already recorded. Replace the text anyway? (The recording stays; you'd re-record the changed lines.)")) r = Object.assign(r, LRCredits.apply(book, true), { kept: [] });
      creditsOpen[book.id] = true; save(true);
      toast([r.added.length ? "Added " + r.added.join(" and ") : "", r.updated.length ? "Updated " + r.updated.join(" and ") : "", r.kept.length ? "Kept " + r.kept.join(" and ") + " as recorded" : ""].filter(Boolean).join(". ") || "The credits already match.");
    };
  }
  // Restore: choose a backup, then a book (Lead only) or the planner. Nothing is written until the last button.
  async function restoreDialog() {
    const ov = document.createElement("div"); ov.className = "overlay"; document.body.appendChild(ov);
    const close = () => ov.remove();
    const fmtDay = b => LRProblems.stamp(b.modified) + " · " + b.by + (b.beforeRestore ? " · before a restore" : "");
    let all = [];
    try { all = await LRBackup.list(); } catch (e) {}
    if (!all.length) { ov.innerHTML = `<div class="card reader"><h2>Restore</h2><p>No backups yet. The first one is made a few seconds after the Lamp Room opens each day, or press <b>Back up now</b>.</p><div class="row"><div class="spacer"></div><button class="btn" data-x>Close</button></div></div>`; $("[data-x]", ov).onclick = close; return; }
    const pick = async name => {
      let info = {}; try { info = (await LRBackup.open(name)).info || {}; } catch (e) { toast("Couldn't open that backup: " + e.message); return; }
      const rows = (info.books || []).slice().sort((a, b) => (a.title || "").localeCompare(b.title || "")).map((b, i) => {
        const live = Store.books.find(x => x.folder === b.folder || (b.id && x.id === b.id));
        const ok = LRBackup.canRestore(live || { lead: b.lead });
        const lead = LRBackup.leadOf(live || {}) || b.lead;
        return `<tr><td><b>${esc(b.title)}</b><div class="small muted">${b.chapters} chapter${b.chapters === 1 ? "" : "s"}${live ? "" : " · not in the Library now"}${lead ? " · Lead: " + esc(lead) : ""}</div></td>
          <td style="text-align:right">${ok ? `<button class="btn small" data-rb="${i}">Restore this book…</button>` : `<span class="small muted">Only ${esc(lead)} can restore it</span>`}</td></tr>`; }).join("");
      $("#rsBody", ov).innerHTML = `<p class="small muted">Saved ${esc(info.made ? LRProblems.stamp(Date.parse(info.made)) : "")} by ${esc(info.by || "?")}.</p>
        <table class="ch" style="width:100%">${rows}${info.planner ? `<tr><td><b>The planner</b><div class="small muted">Titles, log, ledger, bills, days off, pipeline, settings</div></td><td style="text-align:right"><button class="btn small" data-rp>Restore the planner…</button></td></tr>` : ""}</table>`;
      const sorted = (info.books || []).slice().sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      $$("[data-rb]", ov).forEach(bt => bt.onclick = () => confirmBook(name, info, sorted[+bt.dataset.rb]));
      const rp = $("[data-rp]", ov); if (rp) rp.onclick = () => confirmPlanner(name, info);
    };
    const confirmBook = (name, info, b) => {
      const me = Store.me(), ppl = b.people || [];
      $("#rsBody", ov).innerHTML = `<h3>${esc(b.title)}, as it was ${esc(LRProblems.stamp(Date.parse(info.made)))}</h3>
        <label class="small rs-chk"><input type="checkbox" checked disabled><span>The book itself: text, chapters, parts, credits, cues</span></label>
        ${ppl.slice().sort((a, b) => Store.samePerson(b, me) - Store.samePerson(a, me)).map(p => `<div><label class="small rs-chk"><input type="checkbox" data-rpp="${esc(p)}" ${Store.samePerson(p, me) ? "checked" : ""}><span>${Store.samePerson(p, me) ? "Your own file (" + esc(p) + "): your takes list, markers, track effects and progress" : esc(p) + "'s own file: their takes list, markers, track effects and progress"}${Store.samePerson(p, me) ? "" : ` <span class="muted">(only tick if ${esc(p)} agrees: it replaces their latest)</span>`}</span></label></div>`).join("")}
        <p class="small muted">Recordings themselves aren't touched. Anything changed since then is saved in a backup first.</p>
        <div class="row"><div class="spacer"></div><button class="btn quiet" data-back>Back</button><button class="btn primary" id="rsGo">Restore ${esc(b.title)}</button></div>`;
      $("[data-back]", ov).onclick = () => pick(name);
      $("#rsGo", ov).onclick = async () => { const bt = $("#rsGo", ov); bt.disabled = true; bt.textContent = "Restoring…";
        try { await LRBackup.restoreBook(name, b.folder, $$("[data-rpp]", ov).filter(x => x.checked).map(x => x.dataset.rpp)); close(); toast("↩ " + b.title + " is back as it was " + LRProblems.stamp(Date.parse(info.made)) + "."); render(); }
        catch (e) { toast("Couldn't restore: " + e.message); bt.disabled = false; bt.textContent = "Restore " + b.title; } };
    };
    const confirmPlanner = (name, info) => {
      $("#rsBody", ov).innerHTML = `<h3>The planner, as it was ${esc(LRProblems.stamp(Date.parse(info.made)))}</h3>
        <p>Titles, log entries, ledger, bills, days off and the pipeline go back to exactly that moment, for everyone sharing this Library. Anything added since then disappears from the planner, but it's kept in a backup made right before, so this can be undone.</p>
        <div class="row"><div class="spacer"></div><button class="btn quiet" data-back>Back</button><button class="btn primary" id="rsGo">Restore the planner</button></div>`;
      $("[data-back]", ov).onclick = () => pick(name);
      $("#rsGo", ov).onclick = async () => { const bt = $("#rsGo", ov); bt.disabled = true; bt.textContent = "Restoring…";
        try { await LRBackup.restorePlanner(name); close(); toast("↩ The planner is back as it was " + LRProblems.stamp(Date.parse(info.made)) + "."); render(); }
        catch (e) { toast("Couldn't restore: " + e.message); bt.disabled = false; bt.textContent = "Restore the planner"; } };
    };
    ov.innerHTML = `<div class="card reader" style="max-width:720px"><h2>Restore from a backup</h2>
      <div class="row"><label style="flex:1">Backup<select id="rsPick">${all.map(b => `<option value="${esc(b.name)}">${esc(fmtDay(b))}</option>`).join("")}</select></label><button class="btn quiet" data-x>Close</button></div>
      <div id="rsBody" style="margin-top:10px"><p class="muted small">Opening…</p></div></div>`;
    $("[data-x]", ov).onclick = close;
    $("#rsPick", ov).onchange = e => pick(e.target.value);
    pick(all[0].name);
  }
  // Settings in four tabs, with a search across all of them. Cards are sorted by their title, so new cards only
  // need a line here; an unknown card lands in "Me". The open tab is remembered on this computer.
  const SET_TABS = [["me", "Me"], ["computer", "This computer"], ["money", "Books & money"], ["look", "Look"]];
  const SET_CARD_TAB = { "Who's working here": "me", "Estimates": "money", "Who works in this Library": "money", "Reading & proofing": "me",
    "This computer": "computer", "Auphonic": "computer", "Library folder": "computer", "Recordings on this computer": "computer", "Backups": "computer", "Problem log": "computer",
    "Clients & credits": "money", "Planning & money": "money", "Export file names": "money", "Look & feel": "look" };
  function settingsTabs() {
    const root = main(), cards = $$(":scope > .card", root);
    const order = Object.keys(SET_CARD_TAB), title = c => { const h = $("h3", c); return h ? h.textContent.trim() : ""; };
    cards.forEach(c => { c.dataset.stab = SET_CARD_TAB[title(c)] || "me"; });
    cards.slice().sort((a, b) => (order.indexOf(title(a)) + 1 || 99) - (order.indexOf(title(b)) + 1 || 99)).forEach(c => root.appendChild(c));   // cards in the order listed above
    const want = route.q && route.q.get("tab");
    let cur = SET_TABS.some(([k]) => k === want) ? want : (() => { try { return localStorage.getItem("lr-settab") || "me"; } catch (e) { return "me"; } })();
    const bar = document.createElement("div"); bar.className = "set-bar";
    bar.innerHTML = `<div class="set-tabs" role="tablist">${SET_TABS.map(([k, l]) => `<button role="tab" data-stab="${k}">${l}</button>`).join("")}</div>
      <label class="set-find"><span class="sr">Search settings</span><input type="search" id="setq" placeholder="Search settings…" autocomplete="off"></label>`;
    $("h1", root).after(bar);
    const none = document.createElement("p"); none.className = "muted set-none hidden"; bar.after(none);
    const show = () => {
      const q = ($("#setq").value || "").trim().toLowerCase();
      $$("[role=tab]", bar).forEach(b => b.setAttribute("aria-selected", String(!q && b.dataset.stab === cur)));
      let n = 0;
      cards.forEach(c => {
        const hit = q ? c.textContent.toLowerCase().includes(q) : c.dataset.stab === cur;
        c.classList.toggle("hidden", !hit); if (hit) n++;
        const h = $("h3", c); if (h) h.dataset.where = q && hit ? (SET_TABS.find(([k]) => k === c.dataset.stab) || [, ""])[1] : "";
        $$("label, .row, p", c).forEach(el => el.classList.toggle("set-hit", !!q && el.children.length < 8 && el.textContent.toLowerCase().includes(q)));
      });
      none.textContent = q && !n ? "Nothing in Settings matches “" + $("#setq").value.trim() + "”." : ""; none.classList.toggle("hidden", !(q && !n));
    };
    $$("[role=tab]", bar).forEach(b => b.onclick = () => { cur = b.dataset.stab; try { localStorage.setItem("lr-settab", cur); } catch (e) {} $("#setq").value = ""; show(); });
    $("#setq").oninput = show;
    show();
  }
  async function viewSettings() {
    const aupDriveSet = await Store.hasKeptFolder("auphonic-drive").catch(() => false);
    const S = Store.settings;
    const sample = S.namePattern.replace(/\{(\w+)\}/g, (m, k) => ({ book: "The Salt Crown", chapter: "Chapter 3", n: "3", nn: "03", nnn: "003", title: "The Drowned Road" }[k] || m));
    main().innerHTML = `<h1>Settings</h1>
      <div class="card"><h3>Look &amp; feel</h3><div class="row">
        <label>Theme<select id="th">${[["ledger", "Ledger — warm paper & brass (light)"], ["archive", "Archive — cool paper & ink (light)"], ["lamp", "Lamp — lamplit dark"], ["nocturne", "Nocturne — violet dark"], ["foundry", "Foundry — soot, smoke & whisky (Small Heath)"], ["afterglow", "Afterglow — violet night & sunset neon (Synthwave)"], ["velvet", "Velvet — wine, black velvet & rose gold (Dark Romance)"], ["signal", "Signal — hot pink & acid yellow on black (Cyberpunk)"], ["phosphor", "Phosphor — neon green on a green-screen terminal (the Matrix)"], ["sanguine", "Sanguine — neon blood red on black, blackletter titles (Vampire)"]].map(([k, l]) => `<option value="${k}" ${S.theme === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="check"><input type="checkbox" id="cele" ${S.celebrations !== false ? "checked" : ""}> Celebrations — big glowing words for goals, pace, chapters and books</label>
        <label class="check"><input type="checkbox" id="combo" ${S.combo !== false ? "checked" : ""}> Combo meter in the Booth (Finished Hour's tiers)</label>
        <label class="check"><input type="checkbox" id="cf" ${S.confetti ? "checked" : ""}> Confetti</label>
        <label class="check"><input type="checkbox" id="calm" ${S.calm ? "checked" : ""}> Calm: keep the words, drop the sparks, lightning and flashes</label>
        <label class="check"><input type="checkbox" id="en" ${S.encouragement ? "checked" : ""}> Small encouraging lines</label>
        <label class="check"><input type="checkbox" id="vw" ${S.voiceWave !== false ? "checked" : ""}> Voice wave across the bottom of the page while recording</label>
        <div class="section-label" style="margin-top:10px">Notices</div>
        <p class="small muted" style="margin:0 0 6px">Warnings (microphone, dropouts, clipping, anything that failed) always show. Everything else waits until you stop recording.</p>
        <label class="check"><input type="checkbox" id="conf" ${S.confirmations === true ? "checked" : ""}> Confirmations: “copied”, “fades set”, “lines spliced”, “marker dropped”…</label>
        <label class="check"><input type="checkbox" id="prog" ${S.progressNotes !== false ? "checked" : ""}> Progress lines in the Booth's top bar: “Splicing…”, “Checking…”</label>
        <label>Duet cues (“JACK · 2.1 s”, “YOUR TURN”)<select id="cues">${[["full", "Big, in the middle"], ["small", "Small, in the corner"], ["off", "Off"]].map(([v, l]) => `<option value="${v}" ${(S.duetCues || "full") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Daily earnings goal ($, for the celebration; 0 = none)<input type="number" id="gearn" min="0" step="10" value="${esc(S.goalEarn || 0)}" style="max-width:120px"></label>
        <div class="row"><button class="btn quiet small" id="try2">Try a celebration</button><button class="btn quiet small" id="try3">Try the big one</button><button class="btn quiet small" id="tryc">Try a combo tier</button></div>
        <button class="btn small" id="try">Try it</button>
      </div></div>
      <div class="card"><h3>Reading & proofing</h3>
        <label>Moving on to the next sentence<select id="pcr"><option value="auto" ${S.pacer !== "manual" ? "selected" : ""}>Automatic: the highlight follows my voice into the next sentence</option><option value="manual" ${S.pacer === "manual" ? "selected" : ""}>Manual: it waits at the end of each sentence until I press Next (for re-reading)</option></select></label>
        <div class="section-label" style="margin-top:10px">Proofing</div>
        <p class="small muted" style="margin:0 0 6px">Listens back to what you read and underlines anything that doesn't match the text: a skipped word, a swapped word, an extra one. It runs in Chrome on this computer; your audio never leaves it. The first time, it downloads its listening model (about 40–80 MB), then Chrome keeps it.</p>
        <div class="row"><label>Proof<select id="pfm">${[["off", "Off"], ["stop", "When I stop: check each take"], ["live", "Live: check every ~20 seconds as I read"]].map(([v, l]) => `<option value="${v}" ${(S.proofMode || "off") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Listening<select id="pfk">${[["careful", "Careful (better with names, a bit slower)"], ["fast", "Fast"]].map(([v, l]) => `<option value="${v}" ${(S.proofModel || "careful") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button class="btn small quiet" id="pfl">Download it now</button></div>
        <p class="small muted" style="margin:6px 0 0">Live always listens fast, so it keeps up. Names and made-up words it doesn't know: press <b>Always ignore</b> on the flag and it won't flag that word again in the book.</p></div>
      <div class="card"><h3>Who works in this Library</h3><p class="small muted">The people who share this Library (its books, planner and money): for you two, that's you and Jack. Each has a name, the full and credit names they go by, and a booth pace (words per booth hour) used until the Booth has measured it. Cast and co-narrators aren't listed here: they live on each book (Who reads what, Cast 1–4 and the shared project list).</p>
        ${(S.people || []).map((p, i) => `<div class="person-row ${p.team ? "team" : ""}">
          <label>Name<input data-pp="${i}" data-k="name" value="${esc(p.name)}"></label>
          <label>Full name<input data-pp="${i}" data-k="full" value="${esc(p.full || "")}" placeholder="${esc(p.name)}"></label>
          <label title="How they appear in audiobook credits">Credit name<input data-pp="${i}" data-k="credit" value="${esc(p.credit || "")}" placeholder="${esc(p.full || p.name)}"></label>
          <label class="wide" title="Other spellings, separated by commas">Also known as<input data-pp="${i}" data-k="aka" value="${esc((p.aka || []).join(", "))}" placeholder="other spellings"></label>
          <label>Booth pace<input type="number" data-pp="${i}" data-k="pace" value="${esc(p.pace || "")}" placeholder="—" style="width:96px"></label>
          <button class="btn small quiet" data-delp="${i}" title="Remove ${esc(p.name)}" ${p.team && (S.people || []).filter(x => x.team).length < 2 ? "disabled" : ""}>✕</button>
          ${p.team && LRPace.ready ? (o => `<div class="small muted pace-line">Measured: ${o && o.pace && o.hours ? `<b>${num(o.pace)}</b> words / booth hour overall (last 60 days, ${o.hours} h)` : "not enough booth time yet"}${LRPace.bySeries(p.name).filter(x => x.hours >= 1).map(x => ` · ${esc(x.name)} <b>${num(x.pace)}</b> (${x.hours} h)`).join("")}</div>`)(LRPace.overall(p.name)) : ""}</div>`).join("")}
        <div class="row" style="margin-top:8px"><button class="btn small" id="addp">+ Someone else who works in this Library</button></div></div>
      <div class="card"><h3>Estimates</h3><div class="row">
        <label title="Shared with the planner: one setting. Once books are finished in the Lamp Room, it's measured from them.">Words per finished hour<input type="number" id="wp" value="${(window.LL && LL.S && LL.S.cfg && LL.S.cfg.wordsPerFH) || S.wpfh}" style="width:120px"><span class="small muted">now using ${num(LRPace.wpfh())}: ${esc(LRPace.wpfhFrom())}</span></label>
        <div class="small muted" style="align-self:center">Hours a day: ${(S.narrators || []).map(n => esc(n.name) + " " + LRPace.hoursPerDay(n.name)).join(" · ")}, from <a href="#/settings?tab=money">Planning &amp; money</a>.</div>
        <label title="Shared: new full-cast books go on the schedule paying outside cast this much per word they voice. Change it per title in the planner.">Cast pay, $ per word<input type="number" step="0.001" id="cpw" value="${S.castPerWord != null && S.castPerWord !== "" ? S.castPerWord : 0.05}" style="width:110px"><span class="small muted">$100 / booth hr at 2,000 words / hr = 0.05</span></label>
      </div><p class="small muted">Workdays are Monday–Friday, skipping US federal holidays. In a full-cast book, the book page and dashboard count only the lines read by the narrators on this computer (the whole book is shown beside them).</p></div>
      <div class="card"><h3>Export file names</h3><div class="row">
        <label style="flex:1">Pattern<input id="np" value="${esc(S.namePattern && S.namePattern !== "{book} - {nn} - {chapter}" ? S.namePattern : "{seq}_{name}")}"></label></div>
        <p class="small muted">The default is your delivery rule: <b>{seq}_{name}</b> gives 001_Opening_Credits, 002_Previously, 003_Chapter_01 (a running number across everything included, chapters padded to two digits). Also: {book} {chapter} {n} {nn} {nnn}. A client profile can set its own.</p></div>
      <div class="card"><h3>Clients & credits</h3><p class="small muted">Each client's credit wording, filled in from the book: {Publisher} {PublisherLegal} {Website} {Title} {Author} {PerformedBy} {AuthorYear} {Year}. {Year} is the delivery year (the due date's year, or this year). A blank line starts a new paragraph.</p>
        ${LRCredits.clients().map((c, i) => `<details class="cl-card" ${B_openClient === c.id ? "open" : ""} data-cid="${esc(c.id)}"><summary><b>${esc(c.name || "New client")}</b></summary>
          <div class="row"><label style="flex:1">Client name (as on the book)<input data-cl="${i}" data-k="name" value="${esc(c.name || "")}"></label><label style="flex:1">Publisher, as said in credits<input data-cl="${i}" data-k="publisher" value="${esc(c.publisher || "")}"></label></div>
          <div class="row"><label style="flex:1">Legal name (for the copyright line)<input data-cl="${i}" data-k="legal" value="${esc(c.legal || "")}"></label><label style="flex:1">Website<input data-cl="${i}" data-k="website" value="${esc(c.website || "")}"></label><label>File names<input data-cl="${i}" data-k="naming" value="${esc(c.naming || "{seq}_{name}")}"></label></div>
          <label>Opening credits<textarea data-cl="${i}" data-k="opening" rows="3">${esc(c.opening || "")}</textarea></label>
          <label>Closing credits<textarea data-cl="${i}" data-k="closing" rows="7">${esc(c.closing || "")}</textarea></label>
          <div class="row"><div class="spacer"></div><button class="btn small quiet" data-cldel="${i}">Remove this client</button></div></details>`).join("")}
        <button class="btn small" id="addcl">+ Client</button></div>
      <div class="card"><h3>This computer</h3><div class="row"><label>Keyboard<select id="platSel"><option value="">Automatic (${LRPlat.guess() === "mac" ? "Mac" : "Windows"})</option><option value="mac" ${LRPlat.chosen() === "mac" ? "selected" : ""}>Mac: ⌘ Command, ⌥ Option</option><option value="pc" ${LRPlat.chosen() === "pc" ? "selected" : ""}>Windows: Ctrl, Alt</option></select></label></div><p class="small muted">Shortcuts and their labels follow this. The shortcuts work with Ctrl either way.</p></div>
      <div class="card"><h3>Problem log</h3><p class="small muted">The last 100 things that went wrong on this computer: errors, failed saves, "couldn't" messages. It never interrupts you. When something misbehaves, press Copy for Claude and paste it into the chat.</p>
        <div class="row"><span class="small" id="plCount"></span><div class="spacer"></div><button class="btn small" id="plCopy">Copy for Claude</button><button class="btn small quiet" id="plClear">Clear</button></div>
        <details style="margin-top:8px"><summary class="small">Show the latest</summary><div id="plList" class="small" style="max-height:260px;overflow:auto;margin-top:6px"></div></details></div>
      <div class="card"><h3>Who's working here</h3><div class="row"><label>Working as<select id="meSel">${S.narrators.map(n => `<option ${n.name === Store.me() ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label></div>
        <p class="small muted">Same as the 👤 name in the top bar. Sharing one computer? Switch before you record. Each person keeps their own theme, celebrations, hotkeys, text size and track sizes on each computer; titles, books, the schedule and the ledger are shared.</p></div>
      <div class="card" id="aupcard"><h3>Auphonic</h3><p class="small muted">Master chapters from the Booth's Export (🎚 Master with Auphonic). Your API key is in your Auphonic account settings (API Key); paste it here. It stays in this browser on this computer: never in the Library, the shared folder or anyone else's Lamp Room.</p>
        <div class="row" style="align-items:center"><label style="flex:1">API key<input type="password" id="aupkey" autocomplete="off" value="${LRAuphonic.key() ? "••••••••••••" : ""}" placeholder="Paste your Auphonic API key"></label><button class="btn small" id="aupsave">Save &amp; check</button>${LRAuphonic.key() ? `<button class="btn small quiet" id="aupclear">Remove</button>` : ""}</div>
        <div class="small" id="aupstat">${LRAuphonic.key() ? "Key saved on this computer." : ""}</div>
        ${LRAuphonic.key() ? `<div class="section-label" style="margin-top:12px">Results come home through Google Drive</div>
          <p class="small muted" style="margin:2px 0 6px">In Auphonic, connect your Google Drive (Account ▸ External Services). Pick it here, then show the Lamp Room the folder Auphonic writes into on this computer (inside My Drive). Mastered files land there, Drive brings them down, and they're filed into Studio ▸ Mastered.</p>
          <div class="row" style="align-items:center;gap:8px"><select id="aupsvc" style="flex:1"><option value="">Download straight from Auphonic</option>${(l => (LRAuphonic.service() && !l.some(x => x.uuid === LRAuphonic.service()) ? l.concat([{ uuid: LRAuphonic.service(), name: Store.lsGet("lr-auphonic-svcname") || "Google Drive", type: "" }]) : l).map(x => `<option value="${esc(x.uuid)}" ${x.uuid === LRAuphonic.service() ? "selected" : ""}>${esc(x.name)}${x.type ? " (" + esc(x.type) + ")" : ""}</option>`).join(""))(LRAuphonic.cachedServices())}</select><button class="btn small quiet" id="aupsvcload">↻ Get my services</button></div>
          <div class="row" style="align-items:center;gap:8px;margin-top:6px"><button class="btn small" id="aupdrive">📁 ${aupDriveSet ? "Change the Auphonic folder…" : "Show me the Auphonic folder…"}</button><span class="small muted">${aupDriveSet ? "Set on this computer." : "Not set yet."}</span></div>` : ""}
        ${(j => j.length ? `<div class="section-label" style="margin-top:10px">At Auphonic now</div>${j.map(x => `<div class="small">${esc(x.title || x.name)} · <b>${esc(x.state || "")}</b> ${x.need === "click" ? `<button class="lnk" data-aupretry>allow</button> · ` : ""}<button class="lnk" data-aupx="${esc(x.uuid)}">remove from list</button></div>`).join("")}` : "")(LRAuphonic.jobs())}</div>
      <div class="card"><h3>Recordings on this computer</h3><p class="small muted">Recordings live in this computer's Studio folder${Store.studio ? " (📁 " + esc(Store.studio.name) + ")" : ""}, not in the shared folder. After sharing one booth, move a person's takes to their own computer: copy them out here to a USB drive or a Drive folder, then bring them in on the other Mac. Nothing is deleted or overwritten.</p>
        <div class="row"><label>Whose takes<select id="tkWho">${S.narrators.map(n => `<option ${n.name === Store.me() ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label><button class="btn small" id="tkOut">Copy their takes to a folder…</button><button class="btn small" id="tkIn">Bring takes in from a folder…</button><span class="small muted" id="tkRes"></span></div></div>
      <div class="card"><h3>Backups</h3><p class="small muted">Once a day this computer saves a copy of your books, everyone's progress, the planner and booth sessions into the Library's <b>Backups</b> folder (recordings stay in the Studio folder). Each of you keeps your last ${LRBackup.KEEP} days. Restoring a book is for its Lead; a fresh backup is made first, so a restore can be undone.</p>
        <div class="row"><span class="small" id="bkLast"></span><div class="spacer"></div><button class="btn small" id="bkNow">Back up now</button><button class="btn small" id="bkRestore">Restore…</button></div></div>
      <div class="card"><h3>Library folder</h3><p>📁 ${esc(Store.testMode ? "test library (browser storage)" : Store.folderName())}</p><button class="btn small" id="sw">Switch to a different folder</button>
        <details style="margin-top:10px"><summary class="small">Sharing it with ${esc((S.narrators.find(n => n.name !== Store.me()) || {}).name || "your partner")} through Google Drive</summary><ol class="small" style="line-height:1.6">
          <li>Install <b>Google Drive for desktop</b> on both Macs and sign in to the same Google account (or share one folder between your two accounts).</li>
          <li>On one Mac, make a folder in Google Drive called <i>Lamp Room Library</i>. Move your current library's contents into it (Books, Ledger, Covers, Sessions and lamp-room.json), or start it fresh.</li>
          <li>In Drive's settings, set that folder to <b>Available offline</b> (Mirror files) on both Macs, so the Lamp Room reads real files, not placeholders.</li>
          <li>Here, press <b>Switch to a different folder</b> and choose it. Do the same on the other Mac.</li></ol>
          <p class="small muted">Recordings stay in each computer's Studio folder, outside Drive. Each of you only rewrites your own progress files, so you can both work at the same time. Changes from the other computer show up within about 20 seconds.</p></details></div>
      <div class="card"><h3>Planning &amp; money</h3><p class="small muted">The planner's house rules: hours, workdays and paces for each of you (they keep learning as stages finish), turnaround times, goals and holidays.</p><div class="ll" id="llset"></div></div>`;
    settingsTabs();
    const ls = $("#llset"); ls.innerHTML = LL.settingsHTML().replace(/^<h2>Settings<\/h2>/, ""); LL.views.el = null;
    const save = () => { Store.saveSettings().catch(e => toast("Couldn't save settings: " + e.message)); };
    const plDraw = () => { const L = LRProblems.read(); $("#plCount").textContent = L.length ? L.length + " logged, latest " + LRProblems.stamp(L[L.length - 1].t) : "Nothing logged. Good.";
      $("#plList").innerHTML = L.length ? L.slice(-20).reverse().map(p => `<div style="padding:4px 0;border-bottom:1px solid var(--line)"><span class="muted">${esc(LRProblems.stamp(p.t))} · ${esc(p.kind)} · ${esc(p.where)}${p.n > 1 ? " · ×" + p.n : ""}</span><br>${esc(p.msg)}</div>`).join("") : ""; };
    plDraw();
    const bkDraw = () => { const t = LRBackup.last(); $("#bkLast").textContent = t ? "Last backup from here: " + LRProblems.stamp(Date.parse(t)) : "No backup from this computer yet."; };
    bkDraw();
    $("#bkNow").onclick = async () => { const bt = $("#bkNow"); bt.disabled = true; bt.textContent = "Backing up…";
      try { const r = await LRBackup.make("by hand"); toast("Backed up " + r.books + " book" + (r.books === 1 ? "" : "s") + " and the planner (" + Math.max(1, Math.round(r.size / 1024)) + " KB)."); bkDraw(); }
      catch (e) { toast("Couldn't back up: " + e.message); } bt.disabled = false; bt.textContent = "Back up now"; };
    $("#bkRestore").onclick = () => restoreDialog();
    $("#plCopy").onclick = async () => { try { await navigator.clipboard.writeText(LRProblems.forClaude()); toast("Copied. Paste it into the chat with Claude."); } catch (e) { toast("Couldn't reach the clipboard. Click the page once, then try again."); } };
    $("#plClear").onclick = () => { LRProblems.clear(); plDraw(); toast("Problem log cleared."); };
    $("#th").onchange = e => { S.theme = e.target.value; applyTheme(); save(); };
    $("#cf").onchange = e => { S.confetti = e.target.checked; save(); };
    $("#cele").onchange = e => { S.celebrations = e.target.checked; save(); };
    $("#vw").onchange = e => { S.voiceWave = e.target.checked; save(); };
    $("#conf").onchange = e => { S.confirmations = e.target.checked; save(); };
    $("#prog").onchange = e => { S.progressNotes = e.target.checked; save(); };
    $("#cues").onchange = e => { S.duetCues = e.target.value; save(); };
    $("#pfm").onchange = e => { S.proofMode = e.target.value; save(); };
    $("#pcr").onchange = e => { S.pacer = e.target.value; save(); };
    $("#pfk").onchange = e => { S.proofModel = e.target.value; save(); };
    $("#pfl").onclick = async e => { const bt = e.target; bt.disabled = true; bt.textContent = "Downloading…"; LRProof.onProgress = m => { if (!m.done) bt.textContent = "Downloading… " + Math.round(100 * m.loaded / m.total) + "%"; };
      try { await LRProof.load(S.proofModel === "fast" ? "fast" : "careful"); if (S.proofMode === "live" && S.proofModel !== "fast") await LRProof.load("fast"); bt.textContent = "Ready ✓"; } catch (er) { bt.textContent = "Couldn't download"; toast("The proofer couldn't download: " + er.message); bt.disabled = false; } };
    $("#combo").onchange = e => { S.combo = e.target.checked; S.comboHidden = false; save(); };
    $("#calm").onchange = e => { S.calm = e.target.checked; save(); };
    $("#gearn").onchange = e => { S.goalEarn = Math.max(0, +e.target.value || 0); save(); };
    $("#try2").onclick = () => LRCele.celebrate({ title: "DAILY WORDS: DONE", sub: "24,210 of your own words today", level: 2 });
    $("#try3").onclick = () => LRCele.celebrate({ title: "BOOK RECORDED", sub: "Every one of your lines. Go outside. Briefly.", level: 3 });
    $("#tryc").onclick = () => { const t = 9 + Math.floor(Math.random() * 12), [n, c] = LRCele.TIERS[t]; LRCele.celebrate({ title: n, color: c, live: true, level: 2, flash: true, noConfetti: true, hold: 1600 }); LRCele.lightning(2, c); LRCele.shootingStars(2, c); };
    $("#en").onchange = e => { S.encouragement = e.target.checked; save(); };
    $("#try").onclick = () => cheer("chapterDone");
    // People: a rename keeps the old spelling under Also known as, so books that use it still find the person
    $$("[data-pp]").forEach(el => el.onchange = () => {
      const p = S.people[+el.dataset.pp], k = el.dataset.k, old = p.name;
      if (k === "team") p.team = el.checked;
      else if (k === "aka") p.aka = el.value.split(",").map(x => x.trim()).filter(Boolean);
      else if (k === "pace") p.pace = el.value === "" ? "" : Number(el.value);
      else p[k] = el.value.trim();
      if (k === "name" && old && p.name && old !== p.name) { LRPeople.addAka(p, old); Store.books.forEach(b => (b.cast || []).forEach(c => { if (c.name === old) { c.name = p.name; Store.saveBook(b); } })); if (Store.me() === old) Store.setMe(p.name); }
      LRPeople.mirror(); save(); if (k === "name" || k === "team") viewSettings();
    });
    $$("[data-delp]").forEach(b => b.onclick = () => { const p = S.people[+b.dataset.delp]; if (!confirm("Remove " + p.name + " from People? Books that name them keep the name.")) return; S.people.splice(+b.dataset.delp, 1); LRPeople.mirror(); save(); viewSettings(); });
    $("#addp").onclick = () => { LRPeople.add({ name: "New person", team: true }); LRPeople.mirror(); save(); viewSettings(); };
    { const k = $("#aupkey"), sv = $("#aupsave"), cl = $("#aupclear"), stt = $("#aupstat");
      if (sv) sv.onclick = async () => { const v = k.value.trim(); if (v && !/^•+$/.test(v)) LRAuphonic.setKey(v); if (!LRAuphonic.key()) { stt.textContent = "Paste your key first."; return; }
        stt.textContent = "Checking with Auphonic…"; try { const u = await LRAuphonic.user(); const ps = await LRAuphonic.presets(); stt.innerHTML = "✓ Connected as <b>" + esc(u.username || u.email || "you") + "</b>" + (u.credits != null ? " · " + esc(String(u.credits)) + " h of credits" : "") + " · " + ps.length + " presets: " + esc(ps.map(p => p.name).join(", ")); k.value = "••••••••••••"; } catch (e) { stt.textContent = e.message; } };
      if (cl) cl.onclick = () => { LRAuphonic.setKey(""); viewSettings(); };
      $$("[data-aupx]").forEach(b => b.onclick = () => { LRAuphonic.remove(b.dataset.aupx); viewSettings(); });
      $$("[data-aupretry]").forEach(b => b.onclick = async () => { await LRAuphonic.retry(); viewSettings(); });
      const svc = $("#aupsvc"); if (svc) svc.onchange = () => { LRAuphonic.setService(svc.value); Store.lsSet("lr-auphonic-svcname", svc.selectedOptions[0].textContent); };
      const sl = $("#aupsvcload"); if (sl) sl.onclick = async () => { try { const list = await LRAuphonic.services(), cur = LRAuphonic.service();
        svc.innerHTML = `<option value="">Download straight from Auphonic</option>` + list.map(x => `<option value="${esc(x.uuid)}" ${x.uuid === cur ? "selected" : ""}>${esc(x.name)} (${esc(x.type)})</option>`).join("");
        if (!list.some(x => /drive/i.test(x.type))) toast("No Google Drive connected in Auphonic yet: Auphonic ▸ Account ▸ External Services."); } catch (e) { toast(e.message); } };
      const dv = $("#aupdrive"); if (dv) dv.onclick = async () => { try { const h = await window.showDirectoryPicker({ id: "lamp-room-auphonic", mode: "readwrite" }); await Store.keepFolder("auphonic-drive", h); toast("✓ The Lamp Room will look for mastered files in “" + h.name + "”."); viewSettings(); } catch (e) { if (e.name !== "AbortError") toast(e.message); } }; }
    $("#cpw").onchange = e => { const v = Number(e.target.value); S.castPerWord = v >= 0 ? v : 0.05; save(); };
    $("#wp").onchange = async e => { const v = Number(e.target.value) || 9300; S.wpfh = v; save(); if (window.LL && LL.saveCfg) await LL.saveCfg({ wordsPerFH: v }); viewSettings(); };
    $("#platSel").onchange = e => LRPlat.set(e.target.value);
    $("#np").onchange = e => { S.namePattern = e.target.value; save(); viewSettings(); };
    $$("[data-cl]").forEach(el => el.onchange = () => { const c = S.clients[+el.dataset.cl]; c[el.dataset.k] = el.value; B_openClient = c.id; save(); if (el.dataset.k === "name") viewSettings(); });
    $$("[data-cldel]").forEach(b => b.onclick = () => { const c = S.clients[+b.dataset.cldel]; if (!confirm("Remove " + (c.name || "this client") + "?")) return; S.clients.splice(+b.dataset.cldel, 1); save(); viewSettings(); });
    $("#addcl").onclick = () => { const c = { id: Prep.uid(), name: "", publisher: "", legal: "", website: "", opening: "{Publisher} Presents “{Title}” written by {Author}, performed by {PerformedBy}.", closing: "You have been listening to “{Title}” written by {Author}, performed by {PerformedBy}.\n\nText copyright {AuthorYear} {Author}, Production copyright {Year} {PublisherLegal} All rights reserved.", naming: "{seq}_{name}" }; LRCredits.clients().push(c); B_openClient = c.id; save(); viewSettings(); };
    $("#meSel").onchange = e => Store.setMe(e.target.value);
    const needStudio = async () => { const st = await Store.studioStatus(); if (st === "ready") return true; try { if (st === "needs-permission") await Store.reopenStudio(); else await Store.pickStudio(); return true; } catch (e) { if (e.name !== "AbortError") toast(e.message); return false; } };
    $("#tkOut").onclick = async () => { if (!(await needStudio())) return; const who = $("#tkWho").value, n = Store.takesOf(who).length; if (!n) { toast("No recordings for " + who + " in this library yet."); return; }
      let d; try { d = await window.showDirectoryPicker({ id: "lamp-room-takes", mode: "readwrite" }); } catch (e) { return; }
      const res = $("#tkRes"); try { const dest = await d.getDirectoryHandle("Lamp Room takes - " + who, { create: true }); const r = await Store.exportTakes(who, dest, (i, t) => res.textContent = i + " / " + t);
        res.textContent = `${r.copied} copied${r.total - r.copied - r.missing ? ", " + (r.total - r.copied - r.missing) + " already there" : ""}${r.missing ? ", " + r.missing + " not on this computer" : ""}.`; toast("Copied into “Lamp Room takes - " + who + "”. On the other Mac: Bring takes in, and choose that folder."); } catch (e) { toast("Couldn't copy: " + e.message); } };
    $("#tkIn").onclick = async () => { if (!(await needStudio())) return; let d; try { d = await window.showDirectoryPicker({ id: "lamp-room-takes", mode: "read" }); } catch (e) { return; }
      const res = $("#tkRes"); try { const r = await Store.importTakes(d, n => res.textContent = n + " copied…"); res.textContent = r.copied + " brought in" + (r.skipped ? ", " + r.skipped + " already here" : "") + "."; toast("Takes are in. Open the book and they play."); } catch (e) { toast("Couldn't bring them in: " + e.message); } };
    $("#sw").onclick = async () => { try { await Store.pickFolder(); applyTheme(); render(); } catch (e) { if (e.name !== "AbortError") toast(e.message); } };
  }

  // ---------------- ? : the guide ----------------
  function hotkeyGroups() {
    const A = (window.Booth && Booth.ACTIONS) || {}, L = a => (window.Booth ? Booth.keyLabel(a) : "");
    const G = [["Record", ["rec", "stop", "play", "punch", "flub", "marker", "custom", "click", "fxLast"]],
      ["Edit", ["undo", "redo", "cut", "copy", "paste", "pasteOver", "del", "split", "selAll", "selToStart", "selToEnd"]],
      ["Move & view", ["home", "end", "prevFlag", "nextFlag", "track", "addTrack", "smaller", "bigger", "zoomOut", "zoomIn", "textSmaller", "textBigger", "tools", "escape"]]];
    return G.map(([g, list]) => [g, list.filter(a => A[a]).map(a => [L(a), A[a][0]])]).concat([["Fixed", [["1–6", "Pick a track (while recording: carry the take onto it)"], ["⌥1–6", "Record on that track"]]]]);
  }
  function viewHelp() {
    const H = window.LRHelp.HELP, sec = s => `<section class="hp-sec" id="hp-${s.id}"><h2>${s.icon} ${esc(s.title)}</h2>${s.lead ? `<p class="hp-lead">${esc(s.lead)}</p>` : ""}
      <dl class="hp-dl">${s.items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></section>`;
    const keysSec = `<section class="hp-sec" id="hp-keys"><h2>⌨ Booth hotkeys</h2><p class="hp-lead">${esc(Store.me() || "Your")}'s keys on this computer. ⌘ is Command. Change any of them with ⌨ Hotkeys in the Booth.</p>
      <div class="hp-keys">${hotkeyGroups().map(([g, rows]) => `<div><h3>${esc(g)}</h3>${rows.map(([k, d]) => `<div class="hp-k"><kbd>${esc(k || "—")}</kbd><span>${esc(d)}</span></div>`).join("")}</div>`).join("")}</div></section>`;
    const order = H.slice(0, 5).map(sec).join("") + keysSec + H.slice(5).map(sec).join("");
    main().innerHTML = `<div class="hp"><aside class="hp-nav"><div class="section-label">Guide</div>${H.slice(0, 5).concat([{ id: "keys", icon: "⌨", title: "Hotkeys" }], H.slice(5)).map(s => `<a href="#" data-go="hp-${s.id}">${s.icon} ${esc(s.title)}</a>`).join("")}
        <div class="hp-dl-btns"><a class="btn small" href="guide/Lamp Room Guide${LRPlat.pc ? " (PC)" : ""}.pdf" target="_blank" rel="noopener">📄 Guide (PDF)</a><a class="btn small" href="guide/Lamp Room Keyboard${LRPlat.pc ? " (PC)" : ""}.pdf" target="_blank" rel="noopener">⌨ Keyboard sheet${LRPlat.pc ? " (PC)" : ""}</a><a class="btn small" href="guide/Lamp Room Co-narrator Quick Start${LRPlat.pc ? " (PC)" : ""}.pdf" target="_blank" rel="noopener">🎙 Co-narrator quick start</a><a class="btn small" href="guide/Lamp Room FX Guide.pdf" target="_blank" rel="noopener">🎚 FX guide</a><a class="btn small quiet" href="#/key">The Key: how the planner thinks →</a></div></aside>
      <div class="hp-main"><h1>How the Lamp Room works</h1>${order}</div></div>`;
    $$("[data-go]").forEach(a => a.onclick = e => { e.preventDefault(); const t = document.getElementById(a.dataset.go); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }

  // ---------------- Ledger & Lamp import ----------------
  async function importLL(data) {
    if (!data || !data.collections) throw new Error("That isn't a Ledger & Lamp export.");
    const counts = [];
    for (const c of ["titles", "logs", "fh", "bills", "daysoff", "pipeline", "deposits"]) {
      const list = data.collections[c] || []; for (const r of list) { const { id, ...rest } = r; await Store.llPut(c, id, rest); }
      if (list.length) counts.push(list.length + " " + c);
    }
    if (data.config) await Store.llPut("config", "main", data.config);
    // link titles to books with the same name
    const norm = x => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); let linked = 0;
    for (const b of Store.books.filter(b => !b.titleId)) {
      const t = Store.ll.titles.find(t => t.kind !== "author" && (norm(t.name) === norm(b.title)) && !Store.books.some(x => x.titleId === t.id));
      if (t) { b.titleId = t.id; b.color = t.color || b.color; b.due = t.due || b.due; b.client = t.client || b.client; Store.saveBook(b, true); linked++; }
    }
    LL.init(); await LL.loadBoothFh();
    return counts.join(", ") + (linked ? " · " + linked + " book" + (linked === 1 ? "" : "s") + " linked by name" : "");
  }

  boot();
})();
