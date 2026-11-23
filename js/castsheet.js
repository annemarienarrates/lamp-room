/* The Lamp Room — casting sheet.
   A CSV (or tab-separated text) with a character column and an actor column; header names vary ("Character" / "Role",
   "Actor" / "Voice" / "Performer"), and a Gender column is ignored. One actor can play many characters.
   Matching: the manuscript's colours say who speaks, not which character. So for every coloured passage we read the
   unshaded words around it (the dialogue tags: '"Hold the gate," Corin said.') and count whose characters are named
   there. Each colour goes to the actor named most often around it, one colour per actor, as the script builder shades
   them. A row whose character is the narrator ("Narrator", "Narration") says who reads the unshaded text.
   Then actors become readers: a Library narrator (by any spelling People knows, or first name) stays themselves;
   anyone else takes the next free Cast 1–4 with their real name. */
(function () {
  "use strict";
  const CAST = ["Cast 1", "Cast 2", "Cast 3", "Cast 4"];
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const first = s => norm(s).split(" ")[0];
  const STOP = new Set(["the", "old", "young", "mr", "mrs", "ms", "miss", "lady", "lord", "sir", "dame", "dr", "doctor", "captain", "king", "queen", "prince", "princess", "master", "headmaster", "professor", "misc", "male", "female", "voice", "and", "of", "a", "an"]);

  function splitLine(line, sep) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) { const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur); return out.map(s => s.trim());
  }
  function parse(text) {
    const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { rows: [], error: "The sheet is empty." };
    const sep = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? "\t" : ",";
    const head = splitLine(lines[0], sep).map(norm);
    const ci = head.findIndex(h => /^(character|role|part|char)/.test(h)), ai = head.findIndex(h => /(actor|voice|performer|narrator|cast|talent|performed)/.test(h) && !/^(character|role)/.test(h));
    if (ci < 0 || ai < 0) return { rows: [], error: "I couldn't find a Character column and an Actor column in the first row." };
    const rows = [];
    for (const l of lines.slice(1)) { const c = splitLine(l, sep), character = (c[ci] || "").trim(), actor = (c[ai] || "").trim(); if (character && actor) rows.push({ character, actor }); }
    return rows.length ? { rows } : { rows: [], error: "No rows with both a character and an actor." };
  }
  const isNarration = ch => /^(the )?narrat(or|ion)\b/i.test(ch.trim());
  function nameRes(ch) {
    const words = norm(ch).replace(/[^a-z0-9' -]/g, " ").split(" ").filter(w => w.length >= 3 && !STOP.has(w));
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...new Set(words)].map(w => new RegExp("\\b" + esc(w) + "(?:'s)?\\b", "gi"));
  }
  // chapters: the book's (or the import's) chapters; rows from parse()
  function match(chapters, rows) {
    const chars = rows.filter(r => !isNarration(r.character)).map(r => ({ actor: r.actor, res: nameRes(r.character) })).filter(c => c.res.length);
    const actors = [...new Set(rows.map(r => r.actor))];
    const score = {}, paras = [];
    for (const c of chapters) for (const p of (c.paras || [])) {
      if (p === "⁂") { paras.push(null); continue; }
      const runs = Prep.paraRuns(p), parts = [...new Set(runs.map(r => r[1]).filter(k => k !== "n"))];
      paras.push({ parts, plain: runs.filter(r => r[1] === "n").map(r => r[0]).join(" ") });
    }
    const count = txt => { const hits = {}; if (!txt) return hits; for (const c of chars) { let n = 0; for (const re of c.res) { re.lastIndex = 0; n += (txt.match(re) || []).length; } if (n) hits[c.actor] = (hits[c.actor] || 0) + n; } return hits; };
    const add = (parts, hits, w) => { for (const k of parts) { const s = score[k] = score[k] || {}; for (const a in hits) s[a] = (s[a] || 0) + hits[a] * w / parts.length; } };
    paras.forEach((x, i) => {
      if (!x || !x.parts.length) return;
      add(x.parts, count(x.plain), 1);
      for (const j of [i - 1, i + 1]) { const y = paras[j]; if (y && !y.parts.length) add(x.parts, count(y.plain), 0.25); }
    });
    // one colour per actor: take the strongest pairs first
    const pairs = []; for (const k in score) for (const a in score[k]) pairs.push([k, a, score[k][a]]);
    pairs.sort((a, b) => b[2] - a[2]);
    const parts = {}, used = new Set();
    for (const [k, a, s] of pairs) { if (parts[k] || used.has(a) || s < 1) continue; parts[k] = a; used.add(a); }
    const narr = rows.find(r => isNarration(r.character));
    if (narr) parts.n = narr.actor;
    const charsOf = a => rows.filter(r => r.actor === a && !isNarration(r.character)).map(r => r.character);
    const unplaced = actors.filter(a => !used.has(a) && !(narr && narr.actor === a));
    return { parts, score, charsOf, unplaced, actors };
  }
  // actor → reader: a narrator of this Library stays themselves; anyone else takes a free Cast slot
  function readerFor(actor, castNames) {
    const team = (Store.settings.narrators || []).map(n => n.name);
    const hit = team.find(n => { const s = window.LRPeople ? LRPeople.same(actor, n) : null; return s === true || (s === null && first(actor) === first(n)); });
    if (hit) return hit;
    for (const c of CAST) if (norm(castNames[c]) === norm(actor)) return c;
    const free = CAST.find(c => !castNames[c]); if (!free) return null;
    castNames[free] = actor; return free;
  }
  // fills parts and castNames in place from a match; returns what couldn't be placed
  function apply(result, parts, castNames) {
    const missed = [];
    for (const k in result.parts) { const r = readerFor(result.parts[k], castNames); if (r) parts[k] = r; else missed.push(result.parts[k]); }
    return missed;
  }
  window.LRCastSheet = { parse, match, apply, readerFor, isNarration };
})();
