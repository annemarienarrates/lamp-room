/* The Lamp Room — character scripts: who speaks each line, and how.
   An actor script (.docx) is laid out as: a chapter heading, then for each line the character's NAME,
   a (tone) in brackets, and the dialogue; the line before it from someone else appears as "NAME: text".
   The lines are matched to the manuscript by their words, chapter by chapter. */
(function () {
  "use strict";
  const key = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const NAME = /^(?:[A-Z][A-Z0-9 .'’\-]{0,30}[A-Z0-9]|[A-Z])$/;
  const CUE = /^([A-Z][A-Z0-9 .'’\-]{0,30}):\s+(.+)$/;
  // "(sly)", or "(as Knight Cid, shrill) [FX: Primal manifestation]"
  const TONE = /^\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(?:\[([^\]]+)\])?$/;

  // blocks from readDocx → { char, lines: [{ ch, who, tone, text, prev }] }
  function parse(blocks, fileName) {
    let ch = null, who = null, tone = "", fx = "", prev = null, char = "", sawHead = false;
    const lines = [];
    for (const b of blocks) {
      const t = String(b.text || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      const m0 = /\b(?:actor|duet|cast|partner|character)\s+script\s*[—–-]\s*(.+)$/i.exec(t);
      if (m0 && !char) { char = m0[1].trim(); continue; }
      if (b.heading) { ch = t; sawHead = true; who = null; prev = null; continue; }
      if (!sawHead) continue;                                   // title page and highlight key
      if (/^\d+\s+lines?\s+this\s+chapter$/i.test(t)) continue;
      const cue = CUE.exec(t);
      if (cue && !NAME.test(t)) { prev = { who: cue[1].trim(), text: cue[2].trim() }; who = null; continue; }
      if (/^CREDITS$/.test(t)) break;                          // the credit list at the end
      if (NAME.test(t) && /[A-Z]{2}/.test(t)) { who = t.trim(); tone = ""; fx = ""; continue; }
      const tm = TONE.exec(t);
      if (tm && who) { tone = tm[1].trim(); fx = (tm[2] || "").replace(/^FX:\s*/i, "").trim(); continue; }
      if (/_{4,}|^performed by\b/i.test(t)) continue;           // credit blanks at the end
      if (who) { lines.push({ ch, who, tone, fx, text: t, prev }); prev = null; }
    }
    if (!char) { const c = {}; lines.forEach(l => c[l.who] = (c[l.who] || 0) + 1); char = Object.keys(c).sort((a, b) => c[b] - c[a])[0] || String(fileName || "").replace(/\.docx$/i, ""); }
    const tidy = s => s.toLowerCase().replace(/(^|[\s\-'’])\S/g, x => x.toUpperCase());
    lines.forEach(l => l.whoName = tidy(l.who));
    return { char: tidy(char), lines };
  }

  function tidyLines(lines) {
    const out = []; let tone = null, fx = "", who = null, carry = null;
    for (const l of lines || []) {
      if (l.who === "CREDITS") continue;
      if (l.who !== who) { who = l.who; tone = null; fx = ""; }
      const tm = TONE.exec(l.text);
      if (tm) { tone = tm[1].trim(); fx = (tm[2] || "").replace(/^FX:\s*/i, "").trim(); if (l.prev) carry = l.prev; continue; }
      let x = tone != null && !l.tone ? Object.assign({}, l, { tone, fx: l.fx || fx }) : l;
      if (carry && !x.prev) x = Object.assign({}, x, { prev: carry }); carry = null;
      out.push(x);
      if (l.tone) { tone = null; fx = ""; }
    }
    return out;
  }
  const words = t => String(t).split(/\s+/).map(w => w.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "").replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  // best place for one line in a chapter's tokens, at or after `from`
  function place(toks, text, from) {
    const W = words(text); if (!W.length) return null;
    const cands = [];
    const tryAt = s => {
      let j = s, hit = 0, last = s;
      for (const w of W) {
        let k = -1; for (let d = 0; d <= 2 && j + d < toks.length; d++) if (toks[j + d].k === w) { k = j + d; break; }
        if (k >= 0) { hit++; last = k; j = k + 1; }
      }
      cands.push({ a: s, b: last, sc: hit / W.length });
    };
    const two = W.length >= 2;
    for (let s = 0; s < toks.length; s++) if (toks[s].k === W[0] && (!two || (toks[s + 1] && toks[s + 1].k === W[1]) || W.length > 4)) tryAt(s);
    // the best match; ties go to the first one after the last line placed
    const after = c => c.a >= from ? 0 : 1;
    const best = cands.sort((x, y) => (y.sc - x.sc) || (after(x) - after(y)) || (after(x) ? y.a - x.a : x.a - y.a))[0];
    if (!best) return null;
    const need = W.length <= 3 ? 1 : W.length <= 8 ? 0.75 : 0.6;
    return best.sc >= need ? best : null;
  }

  // this chapter's cues from every script: [{ a, b, who, tone, prev, sid }], in reading order
  function forChapter(book, chapter, toks) {
    const out = [], ck = key(chapter.title);
    for (const sc of (book.cues && book.cues.scripts) || []) {
      let from = 0;
      for (const l of tidyLines(sc.lines)) {
        if (key(l.ch) !== ck) continue;
        const p = place(toks, l.text, from); if (!p) continue;
        from = p.b + 1;
        out.push({ a: p.a, b: p.b, who: l.whoName || l.who, tone: l.tone, fx: l.fx || "", prev: l.prev, sid: sc.id });
      }
    }
    // the same line in two scripts (a full-cast script and an actor's own) is cued once
    const seen = new Set();
    return out.sort((x, y) => x.a - y.a).filter(q => { const k = q.a + "|" + q.who.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // every line that didn't find a home, for the book page
  function unplaced(book, tokensOf) {
    const res = [], byKey = {};
    book.chapters.forEach(c => (byKey[key(c.title)] = byKey[key(c.title)] || c));
    for (const sc of (book.cues && book.cues.scripts) || []) {
      const froms = {};
      for (const l of tidyLines(sc.lines)) {
        const c = byKey[key(l.ch)];
        if (!c) { res.push({ sid: sc.id, char: sc.char, ch: l.ch, text: l.text, why: "no chapter called that" }); continue; }
        const p = place(tokensOf(c), l.text, froms[c.id] || 0);
        if (!p) res.push({ sid: sc.id, char: sc.char, ch: l.ch, text: l.text, why: "not found in the chapter" }); else froms[c.id] = p.b + 1;
      }
    }
    return res;
  }

  const has = book => !!(book && book.cues && (book.cues.scripts || []).length);
  window.LRCues = { parse, place, forChapter, unplaced, has, key, tidyLines };
})();
