/* The Lamp Room — Prep logic: cleaning, chapter detection, counting, estimates.
   Pure functions, no DOM. Works in the browser (window.Prep) and in Node (module.exports). */
(function (root) {
  "use strict";

  // ---------- words ----------
  // A word is any run of non-space characters containing a letter or digit (matches Word's count closely).
  function countWords(s) {
    if (!s) return 0;
    const m = String(s).match(/\S+/g);
    if (!m) return 0;
    let n = 0;
    for (const t of m) if (/[\p{L}\p{N}]/u.test(t)) n++;
    return n;
  }

  // ---------- paragraphs ----------
  // A "block" is { text, heading } — heading = true when the source marked it as a heading (docx h1–h3).
  function blocksFromPlainText(text) {
    const t = String(text || "").replace(/\r\n?/g, "\n");
    const hasBlank = /\n[ \t]*\n/.test(t);
    const parts = hasBlank ? t.split(/\n[ \t]*\n+/) : t.split(/\n/);
    return parts.map(p => ({ text: p.replace(/\s*\n\s*/g, " "), heading: false }));
  }

  const SCENE_BREAK = /^\s*(?:[*#~•·⁂◆◇❖✦✧=_-]\s*){1,7}\s*$/;
  const SCENE_MARK = "⁂";

  // Cleaner. Options:
  //   joinBrokenLines   – already handled per-source; kept for pasted text with hard wraps
  //   sceneBreaks       – turn "* * *", "###", "~" etc. into a single ⁂ marker block
  //   normalizePunct    – straight quotes → curly, -- → em dash, ... → …
  //   dropEmpty         – remove empty paragraphs (always on)
  function cleanBlocks(blocks, opts) {
    const o = Object.assign({ sceneBreaks: true, normalizePunct: false, joinBrokenLines: false }, opts || {});
    const tidy = t => String(t || "").replace(/\u00A0/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[ \t\r\n]+/g, " ");
    let out = [];
    for (const b of blocks) {
      let runs = b.runs ? b.runs.map(([t, part]) => [tidy(t), part || "n"]) : [[tidy(b.text), "n"]];
      // trim the paragraph's outer whitespace, drop empty runs, merge neighbours with the same part
      if (runs.length) { runs[0][0] = runs[0][0].replace(/^\s+/, ""); runs[runs.length - 1][0] = runs[runs.length - 1][0].replace(/\s+$/, ""); }
      const merged = [];
      for (const r of runs) { if (!r[0]) continue; const last = merged[merged.length - 1]; if (last && last[1] === r[1]) last[0] += r[0]; else merged.push([r[0], r[1]]); }
      let text = merged.map(r => r[0]).join("");
      if (!text.trim()) continue;
      if (o.sceneBreaks && SCENE_BREAK.test(text)) { out.push({ text: SCENE_MARK, heading: false, brk: true }); continue; }
      if (o.normalizePunct) { merged.forEach(r => r[0] = normalizePunct(r[0])); text = merged.map(r => r[0]).join(""); }
      const blk = { text, heading: !!b.heading };
      if (merged.some(r => r[1] !== "n")) blk.runs = merged;
      out.push(blk);
    }
    if (o.joinBrokenLines) out = joinHardWraps(out);
    return out.filter((b, i) => !(b.brk && out[i - 1] && out[i - 1].brk));
  }

  function normalizePunct(t) {
    return t
      .replace(/(^|[\s(\[{—–-])"/g, "$1“").replace(/"/g, "”")
      .replace(/(^|[\s(\[{—–-])'/g, "$1‘").replace(/'/g, "’")
      .replace(/\s?--\s?/g, "—")
      .replace(/\.\.\./g, "…");
  }

  // For pasted text where every line was a hard wrap: join a block onto the previous one
  // when the previous doesn't end a sentence and this one starts lowercase.
  function joinHardWraps(blocks) {
    const out = [];
    for (const b of blocks) {
      const prev = out[out.length - 1];
      if (prev && !prev.heading && !b.heading && !prev.brk && !b.brk &&
          !/[.!?…:"”’)\]]$/.test(prev.text) && /^[a-z]/.test(b.text)) {
        prev.text = prev.text.replace(/-$/, "") + (/-$/.test(prev.text) ? "" : " ") + b.text;
      } else out.push(Object.assign({}, b));
    }
    return out;
  }

  // ---------- PDF line assembly ----------
  // pages: [{ lines: [{ text, y, x, w, h }] , height }] with y measured from the TOP of the page.
  // Returns blocks: drops running headers/footers and page numbers, rejoins hyphenated & wrapped lines.
  function blocksFromPdfPages(pages) {
    const norm = s => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
    // count edge lines (top 2 / bottom 2 of each page) that repeat across pages
    const edgeCount = new Map();
    for (const p of pages) {
      const L = p.lines; if (!L.length) continue;
      const edges = new Set([...L.slice(0, 2), ...L.slice(-2)].filter(l => !/^[-–—\s]*(?:page\s*)?\d{1,4}[-–—\s]*$/i.test(l.text)).map(l => norm(l.text)));
      for (const e of edges) edgeCount.set(e, (edgeCount.get(e) || 0) + 1);
    }
    const minRepeat = Math.max(3, Math.ceil(pages.length * 0.25));
    const isRunning = l => (edgeCount.get(norm(l.text)) || 0) >= minRepeat;
    // Page numbers climb in step with the page index (page − number stays constant); chapter numbers don't.
    const numOf = l => { const m = /^(?:page\s*)?[-–—]?\s*(\d{1,4})\s*[-–—]?$/i.exec(l.text.trim()); return m ? parseInt(m[1], 10) : null; };
    const offsets = new Map();
    pages.forEach((p, pi) => {
      const L = p.lines, seen = new Set();
      // key = page offset + rough vertical position, so a chapter "1" near the top of page 1 isn't mistaken for the folio at the bottom
      [...L.slice(0, 2), ...L.slice(-2)].forEach(l => { const n = numOf(l); if (n == null) return; const k = (pi - n) + "@" + Math.round(l.y / 25); if (!seen.has(k)) { seen.add(k); offsets.set(k, (offsets.get(k) || 0) + 1); } });
    });
    const pageOffsets = new Set([...offsets].filter(([, c]) => c >= minRepeat).map(([o]) => o));
    const isPageNum = (l, pi) => { const n = numOf(l); return (n != null && pageOffsets.has((pi - n) + "@" + Math.round(l.y / 25))) || /^[ivxlc]{1,7}$/.test(l.text.trim()); };

    const kept = [];
    for (const [pi, p] of pages.entries()) {
      const L = p.lines;
      L.forEach((l, i) => {
        const edge = i < 2 || i >= L.length - 2;
        if (edge && (isRunning(l) || isPageNum(l, pi))) return;
        kept.push(Object.assign({ page: p.index }, l));
      });
    }
    if (!kept.length) return [];

    // typical line spacing and line width
    const gaps = [];
    for (let i = 1; i < kept.length; i++) {
      const a = kept[i - 1], b = kept[i];
      if (a.page === b.page) { const g = b.y - a.y; if (g > 0) gaps.push(g); }
    }
    gaps.sort((a, b) => a - b);
    const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
    const widths = kept.map(l => l.w).sort((a, b) => a - b);
    const fullW = widths[Math.floor(widths.length * 0.9)] || 400;
    const xs = kept.map(l => l.x).sort((a, b) => a - b);
    const leftX = xs[Math.floor(xs.length * 0.1)] || 0;

    // a short line followed by a gap or an indented line stands alone (chapter number, heading, "* * *")
    const standalone = i => {
      const l = kept[i], n = kept[i + 1];
      if (l.text.length > 30 || /[a-z,;]$/.test(l.text)) return false;
      return !n || n.page !== l.page || n.y - l.y > lineGap * 1.3 || n.x > leftX + 8;
    };
    const blocks = [];
    let cur = null;
    for (let i = 0; i < kept.length; i++) {
      const l = kept[i], prev = kept[i - 1];
      let newPara = !cur || standalone(i) || (i > 0 && standalone(i - 1));
      if (prev && cur) {
        const samePage = prev.page === l.page;
        const gap = samePage ? l.y - prev.y : lineGap;
        const prevShort = prev.w < fullW * 0.8;
        const indented = l.x > leftX + 8;
        const prevEnds = /[.!?…"”’:)]$/.test(prev.text.trim());
        if (samePage && gap > lineGap * 1.3) newPara = true;            // visible gap
        else if (indented && prev.w < fullW * 0.5) newPara = true;       // indented line after a short one (heading, number, last line)
        else if (indented && prevEnds) newPara = true;                   // first-line indent
        else if (prevShort && prevEnds) newPara = true;                  // short last line of a paragraph
        else if (l.text.length <= 40 && prevShort && !/[a-z,]$/.test(prev.text.trim())) newPara = true;
      }
      const t = l.text.replace(/\s+/g, " ").trim();
      if (newPara) { cur = { text: t, heading: false }; blocks.push(cur); }
      else if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(t)) cur.text = cur.text.slice(0, -1) + t; // de-hyphenate
      else cur.text += (cur.text.endsWith("—") ? "" : " ") + t;
    }
    return blocks;
  }
  // pdf.js textContent items → lines (top-to-bottom). items: [{str, transform:[a,b,c,d,x,y], width, height}]
  function linesFromPdfItems(items, pageHeight) {
    const pieces = items.filter(it => it.str && it.str.trim() !== "" || (it.str === " "))
      .map(it => ({ str: it.str, x: it.transform[4], y: pageHeight - it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 10 }));
    pieces.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const p of pieces) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(p.y - L.y) <= Math.max(2, L.h * 0.4)) {
        const gap = p.x - (L.x + L.w);
        L.text += (gap > L.h * 0.15 && !/\s$/.test(L.text) && !/^\s/.test(p.str) ? " " : "") + p.str;
        L.w = Math.max(L.w, p.x + p.w - L.x);
      } else if (p.str.trim()) lines.push({ text: p.str, x: p.x, y: p.y, w: p.w, h: p.h });
    }
    lines.forEach(l => l.text = l.text.replace(/\s+/g, " ").trim());
    return lines.filter(l => l.text);
  }


  // ---------- chapter detection ----------
  const ROMAN = (() => { const m = {}; const r = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"], t = ["", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC"];
    for (let n = 1; n < 150; n++) m[(n >= 100 ? "C" : "") + t[Math.floor((n % 100) / 10)] + r[n % 10]] = n; return m; })();
  const ONES = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
  const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
  const WORDNUM = (() => { const m = {}; ONES.forEach((w, i) => m[w] = i + 1);
    TENS.forEach((t, i) => { m[t] = (i + 2) * 10; ONES.slice(0, 9).forEach((o, j) => { m[t + "-" + o] = m[t + " " + o] = (i + 2) * 10 + j + 1; }); });
    m["one hundred"] = 100; return m; })();
  const KEYWORD = /^(chapter|prologue|epilogue|interlude|part|book|act|afterword|foreword|introduction|preface|coda|previously|recap|bonus|intermission|author['’]s note|acknowledg(?:e)?ments|about the author)\b/i;

  // keep the longest run where numbers go 1,2,3… (allowing a start other than 1 and the odd skip)
  function chain(cands) {
    let best = [];
    for (let s = 0; s < cands.length; s++) {
      if (cands[s].n > 3) continue;
      const run = [cands[s]];
      for (let k = s + 1; k < cands.length; k++) {
        const want = run[run.length - 1].n + 1;
        if (cands[k].n === want) run.push(cands[k]);
        else if (cands[k].n === want + 1 && run.length > 2) run.push(cands[k]); // tolerate one missing number
      }
      if (run.length > best.length) best = run;
    }
    return best.map(c => c.i);
  }

  const detectors = {
    headings: B => B.map((b, i) => (b.heading && b.text.length <= 90 ? i : -1)).filter(i => i >= 0),
    keyword: B => B.map((b, i) => (b.text.length <= 80 && KEYWORD.test(b.text) ? i : -1)).filter(i => i >= 0),
    number: B => chain(B.map((b, i) => ({ i, n: /^\d{1,3}\.?$/.test(b.text) ? parseInt(b.text, 10) : -1 })).filter(c => c.n > 0)),
    roman: B => chain(B.map((b, i) => ({ i, n: ROMAN[b.text.replace(/\.$/, "").toUpperCase()] || -1 })).filter(c => c.n > 0 && /^[IVXLC]+\.?$/.test(c && B[c.i].text))),
    spelled: B => chain(B.map((b, i) => ({ i, n: b.text.length < 22 ? (WORDNUM[b.text.toLowerCase().replace(/\.$/, "")] || -1) : -1 })).filter(c => c.n > 0)),
    runin: B => chain(B.map((b, i) => { const m = /^(\d{1,3})\.\s+\S/.exec(b.text); return { i, n: m && b.text.length > 40 ? parseInt(m[1], 10) : -1 }; }).filter(c => c.n > 0))
  };
  const METHOD_LABELS = { auto: "Auto", headings: "Word headings (Heading styles)", keyword: "“Chapter / Prologue / Part…” lines",
    number: "Bare numbers (1, 2, 3)", roman: "Roman numerals (I, II, III)", spelled: "Spelled-out numbers (One, Two)", runin: "Run-in numbers (“1. The morning…”)", none: "No split (one chunk)" };

  // Remove table-of-contents runs: 3+ headings in a row with almost nothing between them.
  function dropToc(B, idx) {
    const words = idx.map((s, k) => { let n = 0; const e = k + 1 < idx.length ? idx[k + 1] : B.length; for (let j = s + 1; j < e; j++) n += countWords(B[j].text); return n; });
    const keep = new Array(idx.length).fill(true);
    let k = 0;
    while (k < idx.length) {
      let r = k; while (r < idx.length && words[r] < 15) r++;
      if (r - k >= 3) for (let q = k; q < r; q++) keep[q] = false;
      k = Math.max(r, k + 1);
    }
    return idx.filter((_, k2) => keep[k2]);
  }

  function detect(blocks, method) {
    const B = blocks;
    if (method === "none") return { method: "none", starts: [] };
    if (method && method !== "auto") return { method, starts: dropToc(B, detectors[method](B)) };
    const res = {};
    for (const k of Object.keys(detectors)) res[k] = dropToc(B, detectors[k](B));
    // preference: keyword lines, then headings, then numbered styles — pick the richest sensible one
    const order = ["keyword", "headings", "number", "roman", "spelled", "runin"];
    let best = "none", bestN = 1;
    for (const k of order) {
      const n = res[k].length;
      // a later style must beat the current pick clearly to win (avoids stray "Part" lines beating real chapters)
      if (n >= 2 && (best === "none" || n > bestN * 1.5)) { best = k; bestN = n; }
    }
    // Word headings that hold every keyword line and a few more ("Previously", a titled interlude): the headings are the chapters
    if (best === "keyword" && res.headings.length > res.keyword.length && res.headings.length <= res.keyword.length * 1.5 && res.keyword.every(i => res.headings.includes(i))) { best = "headings"; bestN = res.headings.length; }
    // if keyword won but numbers/roman found many more, a "Part One" + "1, 2, 3" book: merge both
    if (best === "keyword") {
      for (const k of ["number", "roman", "spelled"]) {
        if (res[k].length > res.keyword.length * 1.5) { best = k + "+keyword"; res[best] = [...new Set([...res[k], ...res.keyword])].sort((a, b) => a - b); break; }
      }
    }
    return { method: best, starts: best === "none" ? [] : res[best], all: res };
  }

  // Build chapter objects from blocks + start indices. Text before the first start becomes "Front matter" (excluded by default).
  function buildChapters(blocks, starts) {
    const chapters = [];
    const S = starts.slice().sort((a, b) => a - b);
    const mk = (title, paras, opts) => {
      const ps = paras.map(p => p.runs ? { r: p.runs } : p.text);
      return Object.assign({ id: uid(), title, paras: ps, words: countWords(ps.map(paraText).join(" ")), included: true, status: "todo", boothSeconds: 0, notes: "" }, opts || {});
    };
    if (!S.length) return [mk("Full text", blocks)];
    if (S[0] > 0) {
      const fm = blocks.slice(0, S[0]);
      if (fm.some(b => !b.brk)) chapters.push(mk("Front matter", fm, { included: false }));
    }
    for (let k = 0; k < S.length; k++) {
      const s = S[k], e = k + 1 < S.length ? S[k + 1] : blocks.length;
      let title = blocks[s].text.replace(/\s+/g, " ").trim();
      let bodyStart = s; // heading line stays in the chapter text — it gets read aloud
      // Chapter heading followed by a short subtitle line → "Chapter 3: The Dark Wood"
      const nxt = blocks[s + 1];
      if (nxt && s + 1 < e && !nxt.brk && nxt.text.length <= 60 && !/[.!?,;]$/.test(nxt.text) && !/^["“'‘]/.test(nxt.text) &&
          (/^(chapter|part|book)\s+\S+$/i.test(title) || /^\d{1,3}\.?$/.test(title) || /^[IVXLC]+\.?$/.test(title) || WORDNUM[title.toLowerCase().replace(/\.$/, "")])) {
        title = title.replace(/\.$/, "") + ": " + nxt.text;
      }
      if (/^\d{1,3}\.?$/.test(title)) title = "Chapter " + parseInt(title, 10);
      if (title.length > 80) title = title.slice(0, 77) + "…";
      chapters.push(mk(title, blocks.slice(bodyStart, e)));
    }
    return chapters;
  }

  function mergeChapters(a, b) {
    const paras = a.paras.concat(b.paras);
    return Object.assign({}, a, { paras, words: countWords(paras.map(paraText).join(" ")), boothSeconds: (a.boothSeconds || 0) + (b.boothSeconds || 0) });
  }
  function splitChapter(ch, paraIndex, newTitle) {
    const A = ch.paras.slice(0, paraIndex), Bp = ch.paras.slice(paraIndex);
    return [
      Object.assign({}, ch, { paras: A, words: countWords(A.map(paraText).join(" ")) }),
      { id: uid(), title: newTitle || paraText(Bp[0]).slice(0, 60), paras: Bp, words: countWords(Bp.map(paraText).join(" ")), included: true, status: "todo", boothSeconds: 0, notes: "" }
    ];
  }


  // ---------- paragraphs with parts ----------
  // A paragraph is a plain string (narration) or { r: [[text, part], ...] }.
  // Parts: "n" narration, "m" male lines, "f" female lines, "s" system voice, or "c:<hex>" for anything else.
  const paraText = p => typeof p === "string" ? p : p.r.map(x => x[0]).join("");
  const paraRuns = p => typeof p === "string" ? [[p, "n"]] : p.r;

  const MALE = ["BDD7EE", "C6E0B4", "D9D9D9", "C5CAE9", "B4E5E1", "DDEBF7", "D6DCE4"];
  const FEMALE = ["F8CBDE", "E4D1F2", "FCE4D6", "FFF2CC", "F4CCCC", "EAD1DC", "FBE5F0"];
  const SYSTEM = ["FFF59D"];
  const HL_NAMES = { cyan: "m", blue: "m", darkBlue: "m", darkCyan: "m", magenta: "f", red: "f", darkMagenta: "f", darkRed: "f", yellow: "s", darkYellow: "s" };
  const PART_LABEL = { n: "Narration", m: "Male lines", f: "Female lines", s: "System voice" };
  // Full cast: every distinct highlight colour is its own voice (no grouping into blue/pink/yellow families)
  function partOfColor(c, fullCast) {
    if (!c) return "n";
    if (fullCast || partOfColor.full) {
      if (/^(none|auto|white|FFFFFF)$/i.test(c)) return "n";
      return "c:" + (/^#?[0-9A-F]{6}$/i.test(c) ? c.toUpperCase().replace(/^#/, "") : c);
    }
    if (HL_NAMES[c]) return HL_NAMES[c];
    if (/^(none|auto|white|FFFFFF)$/i.test(c)) return "n";
    const h = c.toUpperCase().replace(/^#/, "");
    if (!/^[0-9A-F]{6}$/.test(h)) return "c:" + c;
    if (MALE.includes(h)) return "m"; if (FEMALE.includes(h)) return "f"; if (SYSTEM.includes(h)) return "s";
    // unknown colour: decide by hue, so a hand-picked blue or pink still lands in the right family
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 0.06) return "c:" + h;                       // grey/white-ish: its own part
    let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360;
    if (hue >= 185 && hue <= 255) return "m";
    if (hue >= 290 || hue <= 15) return "f";
    if (hue >= 45 && hue <= 70) return "s";
    return "c:" + h;
  }
  // a friendly name for a highlight colour: Word's highlight names, or the hue of a hex shade
  const WORD_HL = { yellow: ["Yellow", "#FFFF00"], green: ["Bright green", "#00FF00"], darkGreen: ["Dark green", "#008000"], cyan: ["Turquoise", "#00FFFF"], magenta: ["Pink", "#FF00FF"], blue: ["Blue", "#0000FF"], red: ["Red", "#FF0000"],
    darkBlue: ["Dark blue", "#000080"], darkCyan: ["Teal", "#008080"], darkMagenta: ["Violet", "#800080"], darkRed: ["Dark red", "#800000"], darkYellow: ["Dark yellow", "#808000"], darkGray: ["Dark grey", "#808080"], lightGray: ["Grey", "#C0C0C0"], black: ["Black", "#000000"] };
  function colorName(c) {
    if (WORD_HL[c]) return WORD_HL[c][0];
    const h = String(c).replace(/^#/, ""); if (!/^[0-9A-F]{6}$/i.test(h)) return c;
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const light = (mx + mn) / 2 > 0.72 ? "Light " : (mx + mn) / 2 < 0.3 ? "Dark " : "";
    if (d < 0.06) return light + "grey";
    let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360;
    const nm = hue < 15 ? "red" : hue < 40 ? "orange" : hue < 70 ? "yellow" : hue < 160 ? "green" : hue < 195 ? "teal" : hue < 255 ? "blue" : hue < 290 ? "purple" : hue < 335 ? "pink" : "red";
    return light ? light + nm : nm[0].toUpperCase() + nm.slice(1);
  }
  function colorCss(part) { const c = part.slice(2); return WORD_HL[c] ? WORD_HL[c][1] : /^[0-9A-F]{6}$/i.test(c) ? "#" + c : c; }
  function partLabel(part) { return PART_LABEL[part] || (part.startsWith("r:") ? part.slice(2) + "'s lines" : colorName(part.slice(2)) + " lines"); }

  // Give tokens [from, to] (inclusive, chapter token indexes as tokens() numbers them) a new part.
  // Works on the characters, so the text and its spacing are untouched; the spaces between two retagged words go with them.
  // Give words from..to (word numbers as Prep.tokens counts them: bits of punctuation standing alone don't count) to a part.
  function setPart(chapter, from, to, part) {
    let ti = -1;
    chapter.paras.forEach((p, pi) => {
      if (p === SCENE_MARK) return;
      const chars = []; for (const [t, pt] of paraRuns(p)) for (const ch of t) chars.push([ch, pt]);
      // this paragraph's words, as [start, end] character spans, numbered like Prep.tokens
      const spans = []; let st = -1;
      for (let i = 0; i <= chars.length; i++) { const sp = i === chars.length || /\s/.test(chars[i][0]); if (!sp && st < 0) st = i; if (sp && st >= 0) { const w = chars.slice(st, i).map(c => c[0]).join(""); if (/[\p{L}\p{N}]/u.test(w)) spans.push([st, i - 1, ++ti]); st = -1; } }
      const pick = spans.filter(x => x[2] >= from && x[2] <= to); if (!pick.length) return;
      for (let k = 0; k < pick.length; k++) { const [a0, b0] = pick[k], end = k < pick.length - 1 ? pick[k + 1][0] - 1 : b0; for (let i = a0; i <= end; i++) chars[i][1] = part; }
      const runs = [];
      for (const [ch, pt] of chars) { const last = runs[runs.length - 1]; if (last && last[1] === pt) last[0] += ch; else runs.push([ch, pt]); }
      chapter.paras[pi] = runs.length === 1 && runs[0][1] === "n" ? runs[0][0] : { r: runs };
    });
  }

  // Who reads a part: narration follows the chapter's POV switch; other parts follow the book's assignments.
  function readerOf(part, chapter, book) {
    const parts = (book && book.parts) || {};
    if (part && part[0] === "@") return part.slice(1);              // a personal assignment names its reader outright
    if (part === "n") return (chapter && chapter.pov) || parts.n || null;
    return parts[part] || parts.n || null;
  }
  // Every part found in a book, with passage and word counts
  function partsInBook(book) {
    const found = {};
    for (const c of book.chapters) for (const p of c.paras) {
      if (p === SCENE_MARK) continue;
      for (const [t, part] of paraRuns(p)) { const f = found[part] = found[part] || { passages: 0, words: 0 }; f.passages++; f.words += countWords(t); }
    }
    return found;
  }
  // Words each reader voices in one chapter (runs split mid-word are counted once, by tokens())
  function wordsByReader(chapter, book) {
    const out = {}, byPart = cached(chapter).byPart;
    for (const part in byPart) { const who = readerOf(part, chapter, book) || "?"; out[who] = (out[who] || 0) + byPart[part]; }
    return out;
  }

  // Splitting a chapter into words is the slow part of every count (about 100 ms for a whole novel), and the Booth
  // counts often while you record. So each chapter's words are kept until its text or highlights actually change:
  // the paragraphs are fingerprinted (a fraction of a millisecond) and compared, so no edit can leave a stale count.
  // Who reads which part is looked up fresh every time, since that can change without the text changing.
  // Personal assignments: anyone can give words to a reader in their own copy (chapter.mine[person] = [{ from, to,
  // part, text }], kept in their own people file). They apply for whoever is viewing (Prep.viewer); the Lead's
  // highlighting stays the shared master. A range whose words no longer match (the text was edited) is skipped.
  const tokCache = new WeakMap();
  function overlay(chapter) { const v = Prep.viewer || (window.Store && Store.me && Store.me()); return (v && chapter.mine && chapter.mine[v]) || null; }
  function cached(chapter) {
    const ov = overlay(chapter), sig = JSON.stringify(chapter.paras || []) + (ov ? "|" + Prep.viewer + JSON.stringify(ov) : ""), hit = tokCache.get(chapter);
    if (hit && hit.sig === sig) return hit;
    const toks = tokenize(chapter), byPart = {};
    if (ov) for (const o of ov) { if (o.to >= toks.length || (o.text && toks.slice(o.from, o.to + 1).map(t => t.k).join(" ") !== o.text)) continue; for (let i = o.from; i <= o.to; i++) toks[i] = Object.assign({}, toks[i], { part: o.part, own: true }); }
    for (const t of toks) byPart[t.part] = (byPart[t.part] || 0) + 1;
    const rec = { sig, toks, byPart }; tokCache.set(chapter, rec); return rec;
  }
  // Chapter → word tokens: { w (display text), k (match key), part, p (paragraph index), end (ends a sentence) }.
  // The list is shared between callers: read it, don't change it.
  function tokens(chapter) { return cached(chapter).toks; }
  function tokenize(chapter) {
    const out = [];
    chapter.paras.forEach((p, pi) => {
      if (p === SCENE_MARK) return;
      const chars = [];
      for (const [t, part] of paraRuns(p)) for (const ch of t) chars.push([ch, part]);
      let cur = null;
      for (const [ch, part] of chars) {
        if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = null; } continue; }
        if (!cur) cur = { w: "", part: null, p: pi };
        cur.w += ch;
        if (!cur.part && /[\p{L}\p{N}]/u.test(ch)) cur.part = part;
        if (!cur.firstPart) cur.firstPart = part;
      }
      if (cur) out.push(cur);
    });
    return out.filter(t => /[\p{L}\p{N}]/u.test(t.w)).map(t => ({ w: t.w, k: matchKey(t.w), part: t.part || t.firstPart, p: t.p, end: /[.!?…]["”’)\]]*$/.test(t.w) }));
  }
  const matchKey = w => w.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "").replace(/[^\p{L}\p{N}]/gu, "");

  // ---------- follow-along ----------
  // Matches recognised speech to the manuscript. `mine[i]` says whether token i is the reader's.
  // Feed it words as they're heard; it moves `pos` (the next token to read) forward, skipping other readers' lines.
  function editDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  const NUMWORDS = { "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten" };
  function wordsMatch(heard, want) {
    if (!heard || !want) return false;
    if (heard === want) return true;
    if (NUMWORDS[heard] === want || NUMWORDS[want] === heard) return true;
    if (want.length >= 5 && heard.length >= 4 && (want.startsWith(heard) || heard.startsWith(want))) return true;
    if (want.length >= 4) return editDist(heard, want, want.length >= 8 ? 2 : 1) <= (want.length >= 8 ? 2 : 1);
    return false;
  }
  function makeFollower(toks, mineFlags, startPos) {
    const F = { pos: 0, toks, mine: mineFlags };
    const nextMine = i => { while (i < toks.length && !mineFlags[i]) i++; return i; };
    F.pos = nextMine(startPos || 0);
    // end of the sentence that starts at (or contains) i: one past its last token
    const sentEnd = i => { let k = nextMine(i); if (k >= toks.length) return toks.length; while (k < toks.length - 1 && mineFlags[k + 1] && toks[k + 1].p === toks[k].p && !toks[k].end) k++; return k + 1; };
    // manual pacing: the voice moves you through the sentence but never past its end; Next moves on
    F.manual = false; F.lim = sentEnd(F.pos);
    F.set = i => { F.pos = nextMine(Math.max(0, Math.min(toks.length, i))); F.lim = sentEnd(F.pos); };
    F.setManual = on => { F.manual = !!on; F.lim = sentEnd(F.pos); };
    F.atEnd = () => F.manual && F.pos >= F.lim;
    F.next = () => { const from = F.pos >= F.lim ? F.lim : F.pos; F.pos = nextMine(sentEnd(from) > from && F.pos < F.lim ? F.lim : from); F.lim = sentEnd(F.pos); return F.pos; };
    // heard: array of recognised words (already split). Returns true if pos moved.
    // Rules (steady rather than eager):
    //   · the word you're due to read moves you on at once;
    //   · a word you've just read is a re-read, and moves nothing (re-reads used to match text further on and jump);
    //   · a word further ahead (past the next one, or into the next sentence) only counts when the next heard word
    //     agrees with what follows it there: two in a row, so a common word or a name can't drag the pacer ahead.
    const accept = hit => { F.pos = F.manual && hit + 1 >= F.lim ? F.lim : nextMine(hit + 1); if (!F.manual) F.lim = sentEnd(F.pos); F.pend = null; };
    const recent = h => { let j = F.pos - 1, n = 0; while (j >= 0 && n < 8) { if (mineFlags[j]) { if (wordsMatch(h, toks[j].k)) return true; n++; } j--; } return false; };
    F.pend = null;
    F.hear = heard => {
      let moved = false;
      for (const raw of heard) {
        const h = matchKey(raw); if (!h) continue;
        if (F.pos < toks.length && wordsMatch(h, toks[F.pos].k) && !(F.manual && F.pos >= F.lim)) { accept(F.pos); moved = true; continue; }
        if (F.pend != null) { const nx = nextMine(F.pend + 1); const ok = nx < toks.length && wordsMatch(h, toks[nx].k) && !(F.manual && nx >= F.lim); const at = F.pend; F.pend = null; if (ok) { accept(nx); moved = true; continue; } if (at != null && wordsMatch(h, toks[at].k)) { F.pend = at; continue; } }
        if (recent(h)) continue;
        // look ahead over the next 14 of the reader's tokens for this word
        let i = F.pos, seen = 0, hit = -1;
        while (i < toks.length && seen < 14) {
          if (mineFlags[i]) { if (wordsMatch(h, toks[i].k)) { hit = i; break; } seen++; }
          i++;
        }
        if (hit < 0 || (F.manual && hit >= F.lim)) continue;
        const crosses = hit >= sentEnd(F.pos);
        if (seen <= 1 && !crosses) { accept(hit); moved = true; } else F.pend = hit;
      }
      return moved;
    };
    // start of the sentence containing token i (for the flub key): back over the reader's tokens to a sentence end,
    // a paragraph break, or a change of speaker
    F.sentenceStart = i => {
      let j = Math.min(i, toks.length) - 1;
      while (j >= 0 && !mineFlags[j]) j--;
      if (j < 0) return nextMine(0);
      // if the reader is between sentences, back up to the start of the previous one
      let k = j;
      while (k > 0) {
        const prev = k - 1;
        if (!mineFlags[prev] || toks[prev].p !== toks[k].p || toks[prev].end) break;
        k--;
      }
      return k;
    };
    return F;
  }

  // ---------- estimates ----------
  // settings: { wpfh, narrators:[{name,pace}], boothHoursPerDay }
  // book: { rate:{type:'pfh'|'perword'|'flat'|'none', amount}, myShare (0–100), cast:[{name, share}] }
  function estimate(words, book, settings) {
    const wpfh = settings.wpfh || 9300;
    const fh = words / wpfh;
    const r = (book && book.rate) || { type: "none", amount: 0 };
    const amt = Number(r.amount) || 0;
    const gross = r.type === "pfh" ? fh * amt : r.type === "perword" ? words * amt : r.type === "flat" ? amt : 0;
    const share = book && book.myShare != null ? Number(book.myShare) : 100;
    const cast = (book && book.cast && book.cast.length) ? book.cast : [{ name: (settings.narrators[0] || {}).name, share: 100 }];
    const hpd = settings.boothHoursPerDay || 6;
    const perNarrator = cast.map(c => {
      const n = settings.narrators.find(x => x.name === c.name) || settings.narrators[0] || { pace: 4000 };
      const w = words * (Number(c.share) || 0) / 100;
      // measured pace and each person's hours a day when the caller has them (LRPace), else the typed settings
      const pace = settings.paceOf ? settings.paceOf(c.name) : n.pace, h = settings.hoursOf ? settings.hoursOf(c.name) : hpd;
      const boothHours = pace ? w / pace : 0;
      return { name: c.name, words: w, boothHours, pace, days: boothHours / (h || hpd) };
    });
    const days = Math.max(0, ...perNarrator.map(p => p.days)); // narrators record their parts in parallel
    return { words, fh, gross, mine: gross * share / 100, perNarrator, days };
  }

  // ---------- calendar: weekdays minus US federal holidays ----------
  function usFederalHolidays(year) {
    const d = (m, day) => new Date(year, m, day);
    const nth = (m, wd, n) => { const x = new Date(year, m, 1); const off = (wd - x.getDay() + 7) % 7; return new Date(year, m, 1 + off + 7 * (n - 1)); };
    const last = (m, wd) => { const x = new Date(year, m + 1, 0); const off = (x.getDay() - wd + 7) % 7; return new Date(year, m, x.getDate() - off); };
    const obs = x => { const w = x.getDay(); return w === 6 ? new Date(x.getFullYear(), x.getMonth(), x.getDate() - 1) : w === 0 ? new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1) : x; };
    return [obs(d(0, 1)), nth(0, 1, 3), nth(1, 1, 3), last(4, 1), obs(d(5, 19)), obs(d(6, 4)), nth(8, 1, 1), nth(9, 1, 2), obs(d(10, 11)), nth(10, 4, 4), obs(d(11, 25))];
  }
  const ymd = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  function isWorkday(x) {
    const w = x.getDay(); if (w === 0 || w === 6) return false;
    const key = ymd(x);
    return !usFederalHolidays(x.getFullYear()).some(h => ymd(h) === key) && !(x.getMonth() === 11 && x.getDate() === 31 && usFederalHolidays(x.getFullYear() + 1).some(h => ymd(h) === key));
  }
  // workdays from today (inclusive) up to and including `due` (YYYY-MM-DD)
  function workdaysUntil(due, from) {
    if (!due) return null;
    const start = from ? new Date(from) : new Date(); start.setHours(0, 0, 0, 0);
    const [y, m, dd] = due.split("-").map(Number); const end = new Date(y, m - 1, dd);
    let n = 0; for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) if (isWorkday(x)) n++;
    return n;
  }
  // date after `days` workdays starting today
  function addWorkdays(days, from) {
    const x = from ? new Date(from) : new Date(); x.setHours(0, 0, 0, 0);
    let left = Math.ceil(days);
    if (left <= 0) return ymd(x);
    while (true) { if (isWorkday(x)) { left--; if (left === 0) return ymd(x); } x.setDate(x.getDate() + 1); }
  }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  // docx → HTML (mammoth) → blocks. `parse` turns an HTML string into [{tag, text}] (DOMParser in the browser, regex in tests).
  function blocksFromHtmlParts(parts) {
    return parts.map(p => ({ text: p.text, heading: /^h[1-3]$/i.test(p.tag) }));
  }

  const Prep = { viewer: null, setPart, paraText, paraRuns, partOfColor, partLabel, colorName, colorCss, readerOf, partsInBook, wordsByReader, tokens, matchKey, makeFollower, wordsMatch, countWords, blocksFromPlainText, blocksFromPdfPages, linesFromPdfItems, blocksFromHtmlParts, cleanBlocks, detect, buildChapters, mergeChapters, splitChapter,
    __tokenizeForTest: tokenize, estimate, usFederalHolidays, isWorkday, workdaysUntil, addWorkdays, ymd, uid, METHOD_LABELS, SCENE_MARK };
  if (typeof module !== "undefined" && module.exports) module.exports = Prep; else root.Prep = Prep;
})(typeof window !== "undefined" ? window : globalThis);
