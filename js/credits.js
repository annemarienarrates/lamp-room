/* The Lamp Room — credits and delivery file names.
   Client profiles keep each client's opening and closing credit wording, with blanks that fill themselves in from the book.
   The credits become real chapters (Opening Credits, Closing Credits) so they're recorded like any chapter.
   File names: a running 3-digit number across everything included, then the cleaned title: 001_Opening_Credits, 003_Chapter_01. */
(function () {
  "use strict";
  const ROYAL_GUARD = {
    id: "royal-guard", name: "Royal Guard Publishing", publisher: "Royal Guard Publishing", legal: "Royal Guard Publishing LLC", website: "Royalguardpublishing.com",
    opening: "{Publisher} Presents “{Title}” written by {Author}, performed by {PerformedBy}.",
    closing: "This is the end of “{Title}” - a Royal Guard Production. If you enjoyed this audiobook we would love for you to rate and review it. For more books and audiobooks like this one check us out on {Website} Also connect with us on social media. We are active on Facebook, Tik Tok, Twitter, Reddit, and Instagram. We can’t wait to hear from you.\n\nYou have been listening to “{Title}” written by {Author}, performed by {PerformedBy}.\n\nText copyright {AuthorYear} {Author}, Production copyright {Year} {PublisherLegal} All rights reserved.",
    naming: "{seq}_{name}"
  };
  const DEFAULT_NAMING = "{seq}_{name}";
  function clients() { const S = Store.settings; if (!Array.isArray(S.clients)) { S.clients = [JSON.parse(JSON.stringify(ROYAL_GUARD))]; } return S.clients; }
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  function clientOf(book) { const list = clients(); return list.find(c => c.id === book.clientId) || list.find(c => norm(c.name) === norm(book.client) || norm(c.publisher) === norm(book.client)) || null; }
  const andList = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  // the people credited: the book's own list, or each reader's credit name from Settings
  function performers(book) {
    if ((book.credits || {}).narrators) return book.credits.narrators.split(/\s*[,;]\s*|\s+and\s+/).filter(Boolean);
    const S = Store.settings, names = [...new Set(Object.values(book.parts || {}).filter(Boolean))];
    if (!names.length && S.narrators && S.narrators[0]) names.push(S.narrators[0].name);
    return names.map(n => window.LRPeople && LRPeople.find(n) ? LRPeople.creditOf(n) : ((S.narrators || []).find(x => x.name === n) || {}).credit || n);
  }
  function values(book) {
    const c = clientOf(book) || {}, cr = book.credits || {}, due = book.due ? +String(book.due).slice(0, 4) : null;
    const performed = (cr.performedBy || "").trim() || andList(performers(book));
    return { Publisher: c.publisher || book.client || "", PublisherLegal: c.legal || c.publisher || book.client || "", Website: c.website || "", Title: (cr.title || "").trim() || book.title, Author: book.author || "",
      PerformedBy: performed, Narrators: performed, AuthorYear: cr.authorYear || "", Year: String(cr.year || due || new Date().getFullYear()) };
  }
  const fill = (tpl, v) => String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const paras = text => String(text || "").split(/\n\s*\n|\r?\n/).map(s => s.trim()).filter(Boolean);
  // the part key whose reader is this person (made if there isn't one), so a cast tag lands in their script
  function partFor(book, reader) {
    const P = book.parts = book.parts || {}; for (const [k, v] of Object.entries(P)) if (v === reader && k !== "n") return k;
    const k = "c:credit-" + reader.toLowerCase().replace(/[^a-z0-9]+/g, "-"); P[k] = reader; return k;
  }
  function build(book) {
    const c = clientOf(book); if (!c) return null;
    const v = values(book), cr = book.credits || {};
    const open = paras(fill(c.opening, v)), close = paras(fill(c.closing, v));
    const tags = (cr.cast || []).filter(t => t.name && t.as).map(t => {
      const line = t.name + " as " + t.as + ".";
      return t.reader ? { r: [[line, partFor(book, t.reader)]] } : line;
    });
    return { open, close: close.concat(tags) };
  }
  const recorded = ch => Object.values(ch.audio || {}).some(a => a && (a.tracks || []).some(t => (t.clips || []).length));
  const words = ps => ps.reduce((n, p) => n + Prep.paraText(p).split(/\s+/).filter(Boolean).length, 0);
  // add the credit chapters, or bring their text up to date; returns what happened
  function apply(book, force) {
    const b = build(book); if (!b) return { error: "This book has no client profile. Pick one under Credits, or add the client in Settings ▸ Clients & credits." };
    const res = { added: [], updated: [], kept: [] };
    for (const [kind, title, ps] of [["open", "Opening Credits", b.open], ["close", "Closing Credits", b.close]]) {
      let ch = book.chapters.find(x => x.credits === kind);
      const p = [title, ...ps];
      if (!ch) {
        ch = { id: Prep.uid(), title, paras: p, words: words(p), included: true, status: "todo", credits: kind };
        if (kind === "open") { const i = book.chapters.findIndex(x => x.included); book.chapters.splice(i < 0 ? 0 : i, 0, ch); }
        else { let i = -1; book.chapters.forEach((x, k) => { if (x.included) i = k; }); book.chapters.splice(i + 1, 0, ch); }
        res.added.push(title);
      } else if (JSON.stringify(ch.paras) !== JSON.stringify(p)) {
        if (recorded(ch) && !force) { res.kept.push(title); continue; }
        ch.paras = p; ch.words = words(p); res.updated.push(title);
      }
    }
    return res;
  }
  // ---------- delivery file names ----------
  function seqOf(book, chapter) { const inc = book.chapters.filter(c => c.included); const i = inc.indexOf(chapter); return i < 0 ? book.chapters.indexOf(chapter) + 1 : i + 1; }
  function cleanName(title) {
    const t = String(title || "").trim(), m = t.match(/^chapter\s*(\d+)/i);
    if (m) return "Chapter_" + m[1].padStart(2, "0");
    return t.replace(/<3/g, "").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "Untitled";
  }
  function pattern(book) { const c = clientOf(book); return (c && c.naming) || null; }
  window.LRCredits = { ROYAL_GUARD, DEFAULT_NAMING, clients, clientOf, values, build, apply, seqOf, cleanName, pattern, performers, fill };
})();
