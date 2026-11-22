/* The Lamp Room — pace, measured.
   One answer, everywhere (book page, Dashboard, Booth, estimates, planner): how many words an hour in the booth this
   person reads, here.
     1. this series (or this book, if it isn't in one): once there's an hour of real reading on it;
     2. else their overall pace: the last 60 days, once there are 3 hours;
     3. else the pace typed in Settings ▸ Me ▸ People.
   "Real reading": booth sessions of 5 minutes or more with words read. Setup, testing and listening back don't count.
   Words per finished hour works the same way: measured from books whose chapters are all complete (once there's an
   hour of finished audio), else the planner's setting. */
(function () {
  "use strict";
  const MIN_SEC = 300, SERIES_H = 1, OVERALL_H = 3, DAYS = 60;
  let cache = null, wpfhCache = null, running = null;
  const norm = s => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  // "Monster Girls in Space 9" and "Monster Girls in Space 10" are one series; a set series name wins
  function seriesOf(book) {
    if (!book) return "";
    if (book.series) return norm(book.series);
    return norm(String(book.title || "").replace(/[\s:,\-–—]*(book|bk\.?|vol\.?|volume|part|#|no\.?)?\s*\d+\s*$/i, "")) || norm(book.title);
  }
  const team = () => (Store.settings.narrators || []).map(n => n.name).filter(n => n && n !== "Me");
  const keyOf = name => team().find(t => Store.samePerson(t, name)) || name;
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  function bookOf(s) { return Store.books.find(b => b.id === s.titleId) || (s.title ? Store.books.find(b => b.title === s.title) : null) || null; }

  async function refresh() {
    if (running) return running;
    running = (async () => {
      const next = {}, since = daysAgo(DAYS);
      for (const who of team()) {
        let list = []; try { list = await Store.sessions(who, 4); } catch (e) {}
        const real = list.filter(s => (+s.boothSec || 0) >= MIN_SEC && (+s.words || 0) > 0 && s.date <= today());
        const add = (acc, s) => { acc.words += +s.words || 0; acc.hours += (+s.boothSec || 0) / 3600; acc.sessions++; return acc; };
        const overall = real.filter(s => s.date >= since).reduce(add, { words: 0, hours: 0, sessions: 0 });
        const series = {};
        for (const s of real) { const b = bookOf(s); if (!b) continue; const k = seriesOf(b); add(series[k] = series[k] || { words: 0, hours: 0, sessions: 0, name: b.series || b.title }, s); }
        const fin = a => Object.assign(a, { pace: a.hours > 0 ? Math.round(a.words / a.hours) : 0, hours: Math.round(a.hours * 10) / 10 });
        fin(overall); Object.values(series).forEach(fin);
        next[who] = { overall, series };
      }
      cache = next; wpfhCache = measureWpfh();
      document.dispatchEvent(new CustomEvent("lr-pace"));
      return cache;
    })().finally(() => { running = null; });
    return running;
  }

  // { pace, from: "series" | "overall" | "typed" | "default", hours, name }
  function of(name, book) {
    const c = cache && cache[keyOf(name)];
    if (c && book) { const s = c.series[seriesOf(book)]; if (s && s.hours >= SERIES_H && s.pace) return { pace: s.pace, from: "series", hours: s.hours, name: s.name }; }
    if (c && c.overall.hours >= OVERALL_H && c.overall.pace) return { pace: c.overall.pace, from: "overall", hours: c.overall.hours };
    const typed = (window.LRPeople && LRPeople.paceOf(name)) || +(((Store.settings.narrators || []).find(n => Store.samePerson(n.name, name)) || {}).pace) || 0;
    if (typed) return { pace: typed, from: "typed" };
    return { pace: 4000, from: "default" };
  }
  const paceOf = (name, book) => of(name, book).pace;
  function overall(name) { const c = cache && cache[keyOf(name)]; return c ? c.overall : null; }
  function bySeries(name) { const c = cache && cache[keyOf(name)]; return c ? Object.values(c.series).filter(s => s.pace).sort((a, b) => b.hours - a.hours) : []; }
  function describe(name, book) {
    const r = of(name, book), n = Math.round(r.pace).toLocaleString();
    return r.from === "series" ? n + " words an hour on " + r.name + " (from " + r.hours + " booth hours)"
      : r.from === "overall" ? n + " words an hour across your books (last 60 days, " + r.hours + " booth hours)"
      : r.from === "typed" ? n + " words an hour (typed in People, until there's booth time to measure)" : n + " words an hour (a starting guess)";
  }

  // ---- words per finished hour ----
  const plannerWpfh = () => (window.LL && LL.S && LL.S.cfg && +LL.S.cfg.wordsPerFH) || +Store.settings.wpfh || 9300;
  function measureWpfh() {
    let words = 0, sec = 0;
    for (const b of Store.books) {
      const inc = b.chapters.filter(c => c.included); if (!inc.length) continue;
      const lead = Store.leadOf ? Store.leadOf(b) : "", readers = Object.keys(inc[0].prog || {});
      const done = inc.every(c => { const ps = Object.keys(c.prog || {}); return ps.length && ps.every(p => (c.prog[p] || {}).done); });
      if (!done) continue;
      let s = 0; for (const c of inc) { const a = (c.audio || {})[lead] || (c.audio || {})[readers[0]]; if (!a || !a.tracks) { s = 0; break; } s += a.tracks.reduce((m, tr) => Math.max(m, tr.clips.reduce((x, k) => Math.max(x, k.at + k.dur), 0)), 0); }
      if (s > 0) { words += inc.reduce((x, c) => x + (c.words || 0), 0); sec += s; }
    }
    const v = sec >= 3600 ? words / (sec / 3600) : 0;
    return v >= 5000 && v <= 15000 ? { wpfh: Math.round(v), hours: Math.round(sec / 360) / 10 } : null;
  }
  function wpfh() { return (wpfhCache && wpfhCache.wpfh) || plannerWpfh(); }
  function wpfhFrom() { return wpfhCache ? "measured from " + wpfhCache.hours + " finished hours" : "the planner's setting"; }

  // ---- hours a day: the planner's, per person ----
  function hoursPerDay(name) {
    try { const k = window.LL && LL.keyOf && LL.keyOf(name); const h = k && LL.S.cfg.people[k] && +LL.S.cfg.people[k].hours; if (h) return h; } catch (e) {}
    return +Store.settings.boothHoursPerDay || 6;
  }

  window.LRPace = { refresh, of, paceOf, overall, bySeries, describe, seriesOf, wpfh, wpfhFrom, hoursPerDay, get ready() { return !!cache; } };
  document.addEventListener("lr-saved", () => { clearTimeout(window.LRPace._t); window.LRPace._t = setTimeout(refresh, 5000); });
})();
