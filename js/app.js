/* The Lamp Room — screens. */
(function () {
  "use strict";
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
    askMe(render);
  }
  function chip(text, err) {
    const c = $("#savechip"); c.textContent = text; c.classList.remove("hidden"); c.classList.toggle("err", !!err);
    clearTimeout(chip.t); if (!err) chip.t = setTimeout(() => c.classList.add("hidden"), 1500);
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
    const go = async fn => { try { await fn(); $("#nav").classList.remove("hidden"); applyTheme(); askMe(render); } catch (e) { if (e.name !== "AbortError") alertBox(e.message); } };
    const p = $("#pick"); if (p) p.onclick = () => go(() => Store.pickFolder());
    const r = $("#reopen"); if (r) r.onclick = () => go(() => Store.reopen());
  }
  // whose computer is this? asked once, remembered on this computer (stands in for a login)
  function askMe(then) {
    if (Store.me() || Store.testMode && Store.setMe((Store.settings.narrators[0] || {}).name || "Me") === undefined && Store.me()) return then();
    const ov = document.createElement("div"); ov.className = "overlay";
    ov.innerHTML = `<div class="card reader" style="max-width:480px"><h2>Whose computer is this?</h2>
      <p class="muted">The Lamp Room opens as you on this computer: your pace, your sessions, your lines in duets. You can switch in the Booth any time.</p>
      <div class="row">${Store.settings.narrators.map(n => `<button class="btn primary" data-me="${esc(n.name)}">${esc(n.name)}</button>`).join("")}</div></div>`;
    document.body.appendChild(ov);
    $$("[data-me]", ov).forEach(b => b.onclick = () => { Store.setMe(b.dataset.me); ov.remove(); then(); });
  }
  function alertBox(m) { window.toast ? toast(m) : console.warn(m); }

  function render() {
    const h = location.hash.replace(/^#\/?/, "").split("/");
    route = { name: h[0] || "library", id: h[1], ci: h[2] != null && h[2] !== "" ? +h[2] : null };
    $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === route.name || ((route.name === "book" || route.name === "booth") && a.dataset.r === "library")));
    const fc = $("#folderchip"); fc.textContent = "📁 " + (Store.testMode ? "test library" : Store.folderName()); fc.classList.remove("hidden");
    if (route.name !== "booth") window.scrollTo(0, 0);
    ({ library: viewLibrary, book: viewBook, import: viewImport, calc: viewCalc, settings: viewSettings, booth: () => Booth.open(route.id, route.ci),
      workspace: () => { const id = localStorage.getItem("lr-last-book"); if (id && Store.byId(id)) location.hash = "#/booth/" + id; else { toast("Open a book first — its Booth becomes your Workspace."); location.hash = "#/library"; } } }[route.name] || viewLibrary)();
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
  function bookStats(book) {
    const S = Store.settings, inc = book.chapters.filter(c => c.included);
    const words = inc.reduce((a, c) => a + c.words, 0);
    const byStatus = {}; STATUSES.forEach(([k]) => byStatus[k] = 0);
    inc.forEach(c => byStatus[c.status] = (byStatus[c.status] || 0) + c.words);
    const toRecord = byStatus.todo;
    const est = Prep.estimate(words, castFromParts(book, readerWords(book)), S);
    const left = Prep.estimate(toRecord, castFromParts(book, readerWords(book, c => c.status === "todo")), S);
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
    return { words, byStatus, toRecord, est, left, delivered, track, chapters: inc.length };
  }
  function progressBar(st) {
    if (!st.words) return `<div class="bar"></div>`;
    return `<div class="bar">${STATUSES.slice(1).reverse().map(([k]) => st.byStatus[k] ? `<i style="width:${100 * st.byStatus[k] / st.words}%;background:${STATUS_COLOR[k]}" title="${k}"></i>` : "").join("")}</div>`;
  }

  // ---------------- library ----------------
  function viewLibrary() {
    const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
    const lset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const opened = JSON.parse(ls("lr-opened", "{}")), mode = ls("lr-dash-mode", "cards"), sort = ls("lr-dash-sort", "opened");
    const all = Store.books.map(b => ({ b, st: bookStats(b) }));
    const sorters = {
      opened: (x, y) => (opened[y.b.id] || 0) - (opened[x.b.id] || 0),
      due: (x, y) => (x.b.due || "9999") < (y.b.due || "9999") ? -1 : 1,
      words: (x, y) => y.st.words - x.st.words,
      client: (x, y) => (x.b.client || "~").localeCompare(y.b.client || "~"),
      title: (x, y) => x.b.title.localeCompare(y.b.title) };
    all.sort(sorters[sort] || sorters.opened);
    const active = all.filter(x => x.b.status !== "archived" && !x.st.delivered), done = all.filter(x => x.b.status !== "archived" && x.st.delivered), arch = all.filter(x => x.b.status === "archived");
    const recW = st => st.words - st.byStatus.todo, pct = st => st.words ? Math.round(100 * recW(st) / st.words) : 0;
    const earned = st => st.words ? st.est.mine * recW(st) / st.words : 0;
    const doneCh = b => b.chapters.filter(c => c.included && c.status !== "todo").length;

    const card = ({ b, st }) => {
      const cur = !!b.star, p = pct(st), cls = st.delivered ? "completed" : cur ? "is-current" : "";
      return `<div class="project-card ${cls}" style="--c:${esc(b.color)}" data-id="${esc(b.id)}">
        <div class="pc-head"><div class="pc-spine">${esc((b.title || "?").trim()[0] || "?")}</div>
          <div class="pc-title">${esc(b.title)}
            <div class="project-meta" style="font-family:var(--sans);margin-top:3px">${esc([b.author, b.client].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
          <div class="pc-icons">${b.status === "archived" ? `<button data-restore="${esc(b.id)}" title="Restore from the archive">↩</button>` : ""}<button class="star" data-star="${esc(b.id)}" title="${cur ? "Unmark current" : "Mark as current project"}">${cur ? "★" : "☆"}</button><a href="#/booth/${esc(b.id)}/0" data-booth title="Open in the Booth">🎙</a></div></div>
        ${progressBar(st)}
        <div class="project-meta">${num(recW(st))} / ${num(st.words)} words (${p}%)</div>
        ${st.toRecord && !st.delivered ? `<div class="project-meta">${num(st.toRecord)} words remaining · ${fh(st.left.fh)} FH</div>` : ""}
        <div class="project-meta">${doneCh(b)} / ${st.chapters} chapters recorded</div>
        ${st.est.mine ? `<div class="project-meta earn">${money(earned(st))} earned${st.delivered ? "" : " of " + money(st.est.mine)}</div>` : ""}
        <div class="project-meta">${b.due ? "Due " + esc(prettyDate(b.due)) : "No due date"}${st.delivered ? `<span class="badge good">Delivered</span>` : st.track ? `<span class="badge ${st.track.cls}">${st.track.label}</span>` : ""}</div>
      </div>`;
    };
    const row = ({ b, st }) => `<div class="ptr ${st.delivered ? "completed" : ""}" data-id="${esc(b.id)}"><div class="ptr-title">${b.star ? "★ " : ""}${esc(b.title)}${b.status === "archived" ? ` <button class="btn small quiet" data-restore="${esc(b.id)}">↩ Restore</button>` : ""}</div><div>${pct(st)}% · ${num(st.words)} w</div><div>${doneCh(b)} / ${st.chapters} ch</div><div>${st.est.mine ? money(earned(st)) : "—"}</div><div>${b.due ? esc(prettyDate(b.due)) : "—"}${st.track ? ` <span class="badge ${st.track.cls}">${st.track.label}</span>` : ""}</div></div>`;
    const list = xs => mode === "list"
      ? `<div class="project-table"><div class="ptr head"><div>Title</div><div>Progress</div><div>Chapters</div><div>Earned</div><div>Due</div></div>${xs.map(row).join("")}</div>`
      : `<div class="project-grid">${xs.map(card).join("")}</div>`;

    // Today strip: Continue · Today rings · Waiting on
    const cont = all.find(x => x.b.star && x.b.status !== "archived" && !x.st.delivered) || active[0];
    const contCard = cont ? `<div class="dt-card"><div class="dt-label">Continue</div><div class="dt-title">${esc(cont.b.title)}</div>
        <div class="dt-sub">${doneCh(cont.b)} of ${cont.st.chapters} chapters · ${pct(cont.st)}% read</div>
        <div class="gpr-bar" style="margin:10px 0"><div class="gpr-fill" style="width:${pct(cont.st)}%"></div></div>
        <a class="btn primary small" href="#/booth/${esc(cont.b.id)}/${Math.max(0, cont.b.chapters.findIndex(c => c.included && c.status === "todo"))}">Resume ▸</a></div>`
      : `<div class="dt-card"><div class="dt-label">Continue</div><div class="dt-empty">Nothing in progress. <a href="#/import">Start a project</a>.</div></div>`;
    const me = Store.me ? Store.me() : "", S = Store.settings;
    const nar = (S.narrators || []).find(n => n.name === me) || (S.narrators || [])[0] || { pace: 4000 };
    const hrsGoal = S.boothHoursPerDay || 6, wordsGoal = Math.round((nar.pace || 4000) * hrsGoal);
    const today = todayYmd(), dueSoon = active.filter(x => x.b.due && Prep.workdaysUntil(x.b.due) <= 5);
    const unpaid = done.filter(x => !x.b.paid && x.st.est.mine);
    const ring = (id, label, sub) => `<div class="ring" id="${id}"><svg width="64" height="64" viewBox="0 0 64 64"><circle class="trk" cx="32" cy="32" r="28.5" stroke-width="7"/><circle class="arc" cx="32" cy="32" r="28.5" stroke-width="7" transform="rotate(-90 32 32)" stroke-dasharray="179.07" stroke-dashoffset="179.07"/></svg><div class="ctr">—</div><div class="lbl">${label}</div><div class="sub">${sub}</div></div>`;
    const todayCard = `<div class="dt-card"><div class="dt-label">Today${me ? " · " + esc(me) : ""}</div><div class="rings">
        ${ring("r-words", "Words", "of " + num(wordsGoal))}${ring("r-booth", "Booth hrs", "of " + hrsGoal)}${ring("r-earn", "Earned", "today")}</div></div>`;
    const waitCard = `<div class="dt-card"><div class="dt-label">Waiting on</div>
        <div class="dt-row"><span>Unpaid (${unpaid.length} book${unpaid.length === 1 ? "" : "s"})</span><b>${money(unpaid.reduce((a, x) => a + x.st.est.mine, 0))}</b></div>
        <div class="dt-row"><span>Due within a week</span><b>${dueSoon.length}</b></div>
        <div class="dt-row"><span>Behind or overdue</span><b>${active.filter(x => x.st.track && x.st.track.cls !== "good").length}</b></div>
        <div class="dt-row"><span>Awaiting proof / delivery</span><b>${active.filter(x => !x.st.toRecord && x.st.words).length}</b></div></div>`;

    main().innerHTML = `
      <div class="view-header"><h2>Your Projects</h2>
        <div class="view-header-actions">
          <div class="mode-toggle"><button class="mode-btn ${mode !== "list" ? "on" : ""}" data-mode="cards">▦ Thumbnails</button><button class="mode-btn ${mode === "list" ? "on" : ""}" data-mode="list">☰ List</button></div>
          <select id="dash-sort">${[["opened", "Recently Opened"], ["due", "Due Date"], ["words", "Word Count"], ["client", "Client"], ["title", "Title"]].map(([k, l]) => `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          <a class="btn primary" href="#/import">+ New Project</a></div></div>
      ${all.length ? `<div class="dash-today">${contCard}${todayCard}${waitCard}</div>` : ""}
      ${active.length ? list(active) : all.length ? "" : `<div class="card welcome"><p>No books yet.</p><a class="btn primary" href="#/import">Import a manuscript</a></div>`}
      ${done.length ? `<div class="section-label">Completed (${done.length})</div>${list(done)}` : ""}
      ${arch.length ? `<details style="margin-top:26px" ${ls("lr-arch-open", "") ? "open" : ""} ontoggle="try{localStorage.setItem('lr-arch-open', this.open ? '1' : '')}catch(e){}"><summary class="section-label" style="display:list-item;cursor:pointer">Archived (${arch.length})</summary>${list(arch)}</details>` : ""}`;

    $$("[data-id]").forEach(el => el.onclick = e => { if (e.target.closest("[data-star],[data-booth],[data-restore]")) return; location.hash = "#/book/" + el.dataset.id; });
    $$("[data-star]").forEach(el => el.onclick = e => { e.stopPropagation(); const b = Store.byId(el.dataset.star), on = !b.star; Store.books.forEach(x => { if (x.star && x !== b) { x.star = false; Store.saveBook(x); } }); b.star = on; Store.saveBook(b); viewLibrary(); });
    $$("[data-restore]").forEach(el => el.onclick = e => { e.stopPropagation(); const b = Store.byId(el.dataset.restore); b.status = "active"; Store.saveBook(b); toast("“" + b.title + "” is back on your dashboard."); viewLibrary(); });
    $$("[data-mode]").forEach(el => el.onclick = () => { lset("lr-dash-mode", el.dataset.mode); viewLibrary(); });
    $("#dash-sort").onchange = e => { lset("lr-dash-sort", e.target.value); viewLibrary(); };

    // fill the rings from today's booth sessions
    const setRing = (id, frac, txt) => { const r = $("#" + id); if (!r) return; const arc = r.querySelector(".arc"); arc.style.strokeDashoffset = 179.07 * (1 - Math.min(1, frac)); arc.classList.toggle("done", frac >= 1); r.querySelector(".ctr").textContent = txt; };
    if (me && Store.sessions) Store.sessions(me, 1).then(list => {
      const t = list.filter(s => s.date === today), w = t.reduce((a, s) => a + (s.words || 0), 0), sec = t.reduce((a, s) => a + (s.boothSec || 0), 0), v = t.reduce((a, s) => a + (s.value || 0), 0);
      setRing("r-words", w / wordsGoal, w >= 1000 ? (w / 1000).toFixed(1) + "k" : String(w));
      setRing("r-booth", sec / 3600 / hrsGoal, (sec / 3600).toFixed(1));
      setRing("r-earn", v ? 1 : 0, "$" + Math.round(v));
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
    const tr = st.track;
    main().innerHTML = `
      <div class="row" style="align-items:center">
        <div style="width:14px;height:40px;border-radius:3px;background:${esc(book.color)}"></div>
        <div><h1 style="margin:0">${esc(book.title)}</h1><div class="muted">${esc([book.author, book.client].filter(Boolean).join(" · "))}</div></div>
        <div class="spacer"></div>
        ${st.delivered ? `<span class="badge good">Delivered</span>` : tr ? `<span class="badge ${tr.cls}">${tr.label}</span>` : ""}
        <a class="btn primary" href="#/booth/${esc(book.id)}">🎙 Booth</a>
      </div>
      <div class="tiles">
        <div class="tile"><span>Words</span><b>${num(st.words)}</b><em>${st.chapters} chapters</em></div>
        <div class="tile"><span>Finished hours</span><b>${fh(st.est.fh)}</b><em>at ${num(S.wpfh)} words / FH</em></div>
        <div class="tile"><span>Pay</span><b>${money(st.est.mine)}</b><em>${st.est.gross !== st.est.mine ? "of " + money(st.est.gross) + " gross" : book.rate && book.rate.type !== "none" ? "gross" : "rate not set"}</em></div>
        <div class="tile"><span>Left to record</span><b>${num(st.toRecord)}</b><em>${st.left.perNarrator.map(p => esc(p.name) + " " + hrs(p.boothHours)).join(" · ")} in booth</em></div>
        <div class="tile"><span>Booth days left</span><b>${st.left.days.toFixed(1)}</b><em>at ${S.boothHoursPerDay} booth hrs / day</em></div>
        ${tr ? `<div class="tile"><span>Due ${esc(prettyDate(book.due))}</span><b>${tr.days} workdays</b><em>${num(tr.perDay)} words / day needed · recording done ${esc(prettyDate(tr.finish))}</em></div>` : `<div class="tile"><span>Due</span><b>—</b><em>set a due date below</em></div>`}
      </div>
      ${progressBar(st)}
      <div class="small muted" style="margin-bottom:18px">${STATUSES.map(([k, l]) => st.byStatus[k] ? `<span style="color:${STATUS_COLOR[k]}">■</span> ${l} ${num(st.byStatus[k])}` : "").filter(Boolean).join(" &nbsp; ")}</div>

      <details class="card" id="details" ${(detailsOpen[book.id] != null ? detailsOpen[book.id] : !(book.rate && book.rate.amount)) ? "open" : ""}>
        <summary>Book details</summary>
        <div class="row" style="margin-top:12px">
          <label style="flex:2">Title<input data-f="title" value="${esc(book.title)}"></label>
          <label style="flex:1">Author<input data-f="author" value="${esc(book.author || "")}"></label>
          <label style="flex:1">Client / publisher<input data-f="client" value="${esc(book.client || "")}"></label>
          <label>Due date<input type="date" data-f="due" value="${esc(book.due || "")}"></label>
        </div>
        <div class="row" style="margin-top:12px">
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
        <div class="row" style="margin-top:12px"><button class="btn small" id="redetect">Re-split chapters…</button><div class="spacer"></div>
          <button class="btn small quiet" id="archive">${book.status === "archived" ? "Restore from archive" : "Archive book"}</button></div>
      </details>

      <div class="card">
        <div class="row" style="align-items:center;margin-bottom:6px"><h2 style="margin:0">Chapters</h2><div class="spacer"></div>
          <span class="small muted">Set status for all included:</span><select class="status" id="bulk"><option value="">—</option>${statusOpts("")}</select></div>
        <table class="ch"><thead><tr><th title="Include in counts">In</th><th>#</th><th>Title</th><th class="num">Words</th><th class="num">FH</th>${book.parts ? "<th>POV</th>" : ""}<th>Status</th><th></th></tr></thead>
        <tbody>${book.chapters.map((c, i) => `<tr class="${c.included ? "" : "excl"}" data-i="${i}">
          <td><input type="checkbox" data-inc ${c.included ? "checked" : ""}></td>
          <td class="muted">${i + 1}</td>
          <td><input class="title" data-title value="${esc(c.title)}"></td>
          <td class="num">${num(c.words)}</td>
          <td class="num muted">${fh(c.words / S.wpfh)}</td>
          ${book.parts ? `<td><select class="status" data-pov title="Whose narration this chapter is"><option value="">—</option>${S.narrators.map(n => `<option ${c.pov === n.name ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></td>` : ""}
          <td><select class="status st-${c.status}" data-status>${statusOpts(c.status)}</select></td>
          <td style="white-space:nowrap"><a class="btn small quiet" href="#/booth/${esc(book.id)}/${i}" title="Record this chapter">🎙</a><button class="btn small quiet" data-open title="Read the text, add notes, split">Text</button>${i < book.chapters.length - 1 ? `<button class="btn small quiet" data-merge title="Merge with the next chapter">⤓ Merge</button>` : ""}</td>
        </tr>`).join("")}</tbody></table>
      </div>`;

    $("#details").ontoggle = e => { detailsOpen[book.id] = e.target.open; };
    const save = (rerender) => { Store.saveBook(book); if (rerender) viewBook(); };
    // details
    $$("[data-f]").forEach(el => el.onchange = () => {
      const f = el.dataset.f, v = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
      if (f.startsWith("rate.")) { book.rate = book.rate || { type: "none", amount: 0 }; book.rate[f.slice(5)] = v; } else book[f] = v;
      save(f !== "notes");
    });
    $$("[data-color]").forEach(b => b.onclick = () => { book.color = b.dataset.color; save(true); });
    $$("[data-cast]").forEach(el => el.onchange = () => { const c = book.cast[+el.dataset.cast]; c[el.dataset.k] = el.dataset.k === "share" ? Number(el.value) : el.value; save(true); });
    $$("[data-delcast]").forEach(b => b.onclick = () => { book.cast.splice(+b.dataset.delcast, 1); save(true); });
    const mk = $("#mkparts"); if (mk) mk.onclick = () => { book.parts = { n: Store.me() || (S.narrators[0] || {}).name }; save(true); };
    $$("[data-part]").forEach(el => el.onchange = () => { book.parts[el.dataset.part] = el.value; save(true); });
    const np = $("#noparts"); if (np) np.onclick = () => { if (!confirm("Turn off parts? Everyone's lines count as one reader again.")) return; delete book.parts; save(true); };
    const ac = $("#addcast"); if (ac) ac.onclick = () => { book.cast = book.cast || []; const used = book.cast.map(c => c.name); const n = S.narrators.find(x => !used.includes(x.name)) || S.narrators[0]; book.cast.push({ name: n.name, share: book.cast.length ? 0 : 100 }); save(true); };
    $("#archive").onclick = () => { book.status = book.status === "archived" ? "active" : "archived"; save(false); location.hash = "#/library"; };
    $("#redetect").onclick = () => openRedetect(book);
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
  }
  function partsTable(book) {
    const S = Store.settings, found = Prep.partsInBook(book);
    if (!found.n) found.n = { passages: 0, words: 0 };
    const order = ["n", "m", "f", "s"], keys = Object.keys(found).sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
    const sw = { n: "transparent", m: "#BDD7EE", f: "#F8CBDE", s: "#FFF59D" };
    const rw = readerWords(book);
    return `<div style="margin-top:14px"><div class="row" style="align-items:center"><div class="small muted">Who reads what — from the highlight colours in the manuscript</div><div class="spacer"></div><button class="btn small quiet" id="noparts">Turn off parts</button></div>
      <table class="ch" style="margin-top:6px"><thead><tr><th>Part</th><th class="num">Passages</th><th class="num">Words</th><th>Read by</th></tr></thead><tbody>
      ${keys.map(k => `<tr><td><span class="sw" style="background:${sw[k] || "#" + k.slice(2)}"></span> ${esc(Prep.partLabel(k))}${k === "n" ? ' <span class="muted small">(unhighlighted; a chapter\'s POV switch overrides it)</span>' : ""}</td><td class="num">${num(found[k].passages)}</td><td class="num">${num(found[k].words)}</td>
        <td><select data-part="${esc(k)}">${k === "n" ? "" : `<option value="">Same as narration</option>`}${S.narrators.map(n => `<option ${book.parts[k] === n.name ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></td></tr>`).join("")}
      </tbody></table>
      <div class="small muted" style="margin-top:6px">${Object.entries(rw).filter(([k]) => k !== "?").map(([k, v]) => esc(k) + " voices " + num(v) + " words").join(" · ")}</div></div>`;
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
      <div class="text">${c.paras.map((p, k) => p === Prep.SCENE_MARK ? `<div class="brk">⁂</div>` : `<div class="p">${esc(p)}${k ? `<button class="btn small cut" data-cut="${k}" title="Start a new chapter at this paragraph">✂</button>` : ""}</div>`).join("")}</div>
    </div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); viewBook(); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.onclick = e => { if (e.target === ov) close(); };
    $("[data-x]", ov).onclick = close;
    $("[data-notes]", ov).onchange = e => { c.notes = e.target.value; Store.saveBook(book); };
    $$("[data-nav]", ov).forEach(b => b.onclick = () => { ov.remove(); document.removeEventListener("keydown", onKey); openReader(book, i + Number(b.dataset.nav)); });
    $$("[data-cut]", ov).forEach(b => b.onclick = () => {
      const k = +b.dataset.cut, first = c.paras[k];
      const title = first.length <= 70 ? first : first.slice(0, 50).replace(/\s+\S*$/, "") + "…";
      book.chapters.splice(i, 1, ...Prep.splitChapter(c, k, title));
      Store.saveBook(book); ov.remove(); document.removeEventListener("keydown", onKey); openReader(book, i + 1);
      toast("Split. Rename the new chapter in the list if you like.");
    });
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
    if (!imp.raw) {
      main().innerHTML = `<h1>New book</h1>
        <div class="drop card" id="drop"><h2>Drop a manuscript here</h2><p class="muted">Word (.docx) — or click to browse.</p><input type="file" id="file" accept=".docx" class="hidden"></div>
        <div class="card"><h3>…or paste the text</h3><textarea id="paste" style="min-height:160px" placeholder="Paste the whole manuscript"></textarea><div class="row" style="margin-top:10px"><div class="spacer"></div><button class="btn" id="usepaste">Use pasted text</button></div></div>`;
      const d = $("#drop"), f = $("#file");
      d.onclick = () => f.click();
      d.ondragover = e => { e.preventDefault(); d.classList.add("over"); };
      d.ondragleave = () => d.classList.remove("over");
      d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
      f.onchange = () => f.files[0] && loadFile(f.files[0]);
      $("#usepaste").onclick = () => { const t = $("#paste").value; if (!t.trim()) return; imp.file = null; imp.raw = Prep.blocksFromPlainText(t); imp.opts.joinBrokenLines = !/\n[ \t]*\n/.test(t); imp.title = ""; viewImport(); };
      return;
    }
    const B = Prep.cleanBlocks(imp.raw, imp.opts);
    const r = Prep.detect(B, imp.method);
    imp.chapters = Prep.buildChapters(B, r.starts);
    const inc = imp.chapters.filter(c => c.included), words = inc.reduce((a, c) => a + c.words, 0);
    const e = Prep.estimate(words, {}, Store.settings);
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
        <div class="tile"><span>Booth time</span><b>${hrs(e.perNarrator[0].boothHours)}</b><em>${esc(e.perNarrator[0].name || "")} at ${num((Store.settings.narrators[0] || {}).pace)} w/h</em></div></div>
      ${impParts()}
      <div class="preview-list">${imp.chapters.map(c => `<div class="${c.included ? "" : "ex"}"><span>${esc(c.title)}${c.included ? "" : " (not counted)"}</span><span>${num(c.words)}</span></div>`).join("")}</div>
      <p class="small muted">Wrong splits? Pick a different rule above, or fix individual chapters after — merge, split and rename all work in the book view.</p>
      <div class="row"><button class="btn quiet" id="restart">Start over</button><div class="spacer"></div><button class="btn primary" id="create">Create book</button></div></div>`;
    const keep = () => { imp.title = $("#it").value; imp.author = $("#ia").value; imp.client = $("#ic").value; };
    $("#im").onchange = e => { keep(); imp.method = e.target.value; viewImport(); };
    [["#o-sb", "sceneBreaks"], ["#o-np", "normalizePunct"], ["#o-jb", "joinBrokenLines"]].forEach(([id, k]) => $(id).onchange = e => { keep(); imp.opts[k] = e.target.checked; viewImport(); });
    $$("[data-ipart]").forEach(el => el.onchange = () => { keep(); imp.parts[el.dataset.ipart] = el.value; });
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
      $("#create").disabled = true;
      try { await Store.createBook(book, imp.file); imp = null; cheer("bookCreated"); location.hash = "#/book/" + book.id; }
      catch (err) { $("#create").disabled = false; toast("Couldn't save: " + err.message); }
    };
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
    const sw = { n: "transparent", m: "#BDD7EE", f: "#F8CBDE", s: "#FFF59D" };
    return `<div class="card" style="background:var(--panel2)"><h3>Highlights found — who reads each part?</h3>
      <table class="ch"><thead><tr><th>Part</th><th class="num">Passages</th><th class="num">Words</th><th>Read by</th></tr></thead><tbody>
      ${["n", ...keys].map(k => `<tr><td><span class="sw" style="background:${sw[k] || "#" + k.slice(2)}"></span> ${esc(Prep.partLabel(k))}</td><td class="num">${num((found[k] || {}).passages || 0)}</td><td class="num">${num((found[k] || {}).words || 0)}</td>
        <td><select data-ipart="${esc(k)}">${S.narrators.map(n => `<option ${imp.parts[k] === n.name ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></td></tr>`).join("")}
      </tbody></table><p class="small muted">You can change this later in the book's details, and flip whole chapters to someone's POV.</p></div>`;
  }
  async function loadFile(file) {
    main().innerHTML = `<div class="card welcome"><p>Reading ${esc(file.name)}…</p></div>`;
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let raw;
      if (ext === "docx") raw = await window.readDocx(await file.arrayBuffer());
      else throw new Error("The Lamp Room reads Word .docx files. Save it as .docx, or paste the text instead.");
      if (!raw.length || raw.reduce((a, b) => a + b.text.length, 0) < 200) throw new Error("Hardly any text came out of that file.");
      imp.raw = raw; imp.file = file;
      imp.title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\b(final|manuscript|ms|draft|v\d+|copy)\b/gi, "").replace(/\s+[-–]\s*$/, "").replace(/\s+/g, " ").trim();
      imp.opts.joinBrokenLines = false;
    } catch (e) { imp.raw = null; toast(e.message); }
    viewImport();
  }
  // ---------------- calculator ----------------
  function viewCalc() {
    const S = Store.settings;
    const c = viewCalc.s = viewCalc.s || { words: 90000, rate: { type: "pfh", amount: 250 }, myShare: 100, cast: [{ name: (S.narrators[0] || {}).name, share: 100 }], due: "" };
    const e = Prep.estimate(c.words, c, S), days = c.due ? Prep.workdaysUntil(c.due) : null;
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
        <div class="tile"><span>Booth time</span><b>${hrs(e.perNarrator[0].boothHours)}</b><em>at ${num((S.narrators.find(n => n.name === c.cast[0].name) || {}).pace)} words / hr</em></div>
        <div class="tile"><span>Booth days</span><b>${e.days.toFixed(1)}</b><em>${S.boothHoursPerDay} hrs / day · done ${esc(prettyDate(Prep.addWorkdays(e.days)))}</em></div>
        <div class="tile"><span>Pay</span><b>${money(e.mine)}</b><em>${e.gross !== e.mine ? "of " + money(e.gross) : ""}</em></div>
        ${days != null ? `<div class="tile"><span>Workdays to due</span><b>${days}</b><em>${num(days ? c.words / days : c.words)} words / day needed</em></div>` : ""}
      </div></div>`;
    const upd = () => { c.words = Number($("#cw").value) || 0; c.cast = [{ name: $("#cn").value, share: 100 }]; c.rate = { type: $("#crt").value, amount: Number($("#cra").value) || 0 }; c.myShare = Number($("#csh").value); c.due = $("#cd").value; viewCalc(); };
    $$("#main input:not(#ct), #main select").forEach(el => el.onchange = upd);
    $("#ct").oninput = e => { $("#cw").value = Prep.countWords(e.target.value); clearTimeout(viewCalc.t); viewCalc.t = setTimeout(() => { const keepOpen = true; upd(); if (keepOpen) { $("#main details").open = true; $("#ct").value = e.target.value; $("#ct").focus(); } }, 500); };
  }

  // ---------------- settings ----------------
  function viewSettings() {
    const S = Store.settings;
    const sample = S.namePattern.replace(/\{(\w+)\}/g, (m, k) => ({ book: "The Salt Crown", chapter: "Chapter 3", n: "3", nn: "03", nnn: "003", title: "The Drowned Road" }[k] || m));
    main().innerHTML = `<h1>Settings</h1>
      <div class="card"><h3>Look &amp; feel</h3><div class="row">
        <label>Theme<select id="th">${[["ledger", "Ledger — warm paper & brass (light)"], ["archive", "Archive — cool paper & ink (light)"], ["lamp", "Lamp — lamplit dark"], ["nocturne", "Nocturne — violet dark"], ["foundry", "Foundry — soot, smoke & whisky (Small Heath)"], ["afterglow", "Afterglow — violet night & sunset neon (Synthwave)"], ["velvet", "Velvet — wine, black velvet & rose gold (Dark Romance)"], ["signal", "Signal — black glass & electric cyan (Cyberpunk)"]].map(([k, l]) => `<option value="${k}" ${S.theme === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="check"><input type="checkbox" id="cele" ${S.celebrations !== false ? "checked" : ""}> Celebrations — big glowing words for goals, pace, chapters and books</label>
        <label class="check"><input type="checkbox" id="combo" ${S.combo !== false ? "checked" : ""}> Combo meter in the Booth (Finished Hour's tiers)</label>
        <label class="check"><input type="checkbox" id="cf" ${S.confetti ? "checked" : ""}> Confetti</label>
        <label class="check"><input type="checkbox" id="calm" ${S.calm ? "checked" : ""}> Calm: keep the words, drop the sparks, lightning and flashes</label>
        <label class="check"><input type="checkbox" id="en" ${S.encouragement ? "checked" : ""}> Small encouraging lines</label>
        <label>Daily earnings goal ($, for the celebration; 0 = none)<input type="number" id="gearn" min="0" step="10" value="${esc(S.goalEarn || 0)}" style="max-width:120px"></label>
        <div class="row"><button class="btn quiet small" id="try2">Try a celebration</button><button class="btn quiet small" id="try3">Try the big one</button><button class="btn quiet small" id="tryc">Try a combo tier</button></div>
        <button class="btn small" id="try">Try it</button>
      </div></div>
      <div class="card"><h3>Narrators</h3><p class="small muted">Booth pace = manuscript words you get through per hour in the booth. The Booth module will keep these current once you're recording here.</p>
        ${S.narrators.map((n, i) => `<div class="cast-row"><label>Name<input data-n="${i}" data-k="name" value="${esc(n.name)}"></label><label>Booth pace (words / hr)<input type="number" data-n="${i}" data-k="pace" value="${n.pace}" style="width:120px"></label>${S.narrators.length > 1 ? `<button class="btn small quiet" data-deln="${i}">✕</button>` : ""}</div>`).join("")}
        <button class="btn small" id="addn">+ Narrator</button></div>
      <div class="card"><h3>Estimates</h3><div class="row">
        <label>Words per finished hour<input type="number" id="wp" value="${S.wpfh}" style="width:120px"></label>
        <label>Booth hours per workday<input type="number" step="0.5" id="bh" value="${S.boothHoursPerDay}" style="width:100px"></label>
      </div><p class="small muted">Workdays are Monday–Friday, skipping US federal holidays.</p></div>
      <div class="card"><h3>Export file names</h3><div class="row">
        <label style="flex:1">Pattern<input id="np" value="${esc(S.namePattern)}"></label></div>
        <p class="small muted">Use {book} {chapter} {n} {nn} {nnn}. Preview: <b>${esc(sample)}.wav</b></p></div>
      <div class="card"><h3>This computer</h3><div class="row"><label>Belongs to<select id="meSel">${S.narrators.map(n => `<option ${n.name === Store.me() ? "selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label></div>
        <p class="small muted">The Lamp Room opens as this person here: their pace, their sessions, their lines in duets.</p></div>
      <div class="card"><h3>Library folder</h3><p>📁 ${esc(Store.testMode ? "test library (browser storage)" : Store.folderName())}</p><button class="btn small" id="sw">Switch to a different folder</button></div>`;
    const save = () => { Store.saveSettings().catch(e => toast("Couldn't save settings: " + e.message)); };
    $("#th").onchange = e => { S.theme = e.target.value; applyTheme(); save(); };
    $("#cf").onchange = e => { S.confetti = e.target.checked; save(); };
    $("#cele").onchange = e => { S.celebrations = e.target.checked; save(); };
    $("#combo").onchange = e => { S.combo = e.target.checked; S.comboHidden = false; save(); };
    $("#calm").onchange = e => { S.calm = e.target.checked; save(); };
    $("#gearn").onchange = e => { S.goalEarn = Math.max(0, +e.target.value || 0); save(); };
    $("#try2").onclick = () => LRCele.celebrate({ title: "DAILY WORDS: DONE", sub: "24,210 of your own words today", level: 2 });
    $("#try3").onclick = () => LRCele.celebrate({ title: "BOOK RECORDED", sub: "Every one of your lines. Go outside. Briefly.", level: 3 });
    $("#tryc").onclick = () => { const t = 9 + Math.floor(Math.random() * 12), [n, c] = LRCele.TIERS[t]; LRCele.celebrate({ title: n, color: c, live: true, level: 2, flash: true, noConfetti: true, hold: 1600 }); LRCele.lightning(2, c); LRCele.shootingStars(2, c); };
    $("#en").onchange = e => { S.encouragement = e.target.checked; save(); };
    $("#try").onclick = () => cheer("chapterDone");
    $$("[data-n]").forEach(el => el.onchange = () => { const n = S.narrators[+el.dataset.n]; const old = n.name; n[el.dataset.k] = el.dataset.k === "pace" ? Number(el.value) : el.value.trim();
      if (el.dataset.k === "name") Store.books.forEach(b => (b.cast || []).forEach(c => { if (c.name === old) { c.name = n.name; Store.saveBook(b); } }));
      save(); });
    $$("[data-deln]").forEach(b => b.onclick = () => { S.narrators.splice(+b.dataset.deln, 1); save(); viewSettings(); });
    $("#addn").onclick = () => { S.narrators.push({ name: "Narrator " + (S.narrators.length + 1), pace: 3000 }); save(); viewSettings(); };
    $("#wp").onchange = e => { S.wpfh = Number(e.target.value) || 9300; save(); };
    $("#bh").onchange = e => { S.boothHoursPerDay = Number(e.target.value) || 6; save(); };
    $("#np").onchange = e => { S.namePattern = e.target.value; save(); viewSettings(); };
    $("#meSel").onchange = e => Store.setMe(e.target.value);
    $("#sw").onclick = async () => { try { await Store.pickFolder(); applyTheme(); render(); } catch (e) { if (e.name !== "AbortError") toast(e.message); } };
  }

  boot();
})();
