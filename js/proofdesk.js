/* The Lamp Room — the Proofing desk (Tools ▸ 🔎 Proofing desk).
   Proof any finished audiobook against its manuscript, chapter by chapter, whoever read it and wherever it was made:
   the proofer listens on this computer and flags skipped, added and misread words; you review each flag (Pickup, Ignore,
   Ignore this word everywhere, or add your own), then copy a chapter's pickups as rows for a shared Google Sheet.
   Nothing here touches titles, the planner, words or booth time.
   Jobs live in the Library (Proofing/<id>.json, small, synced); the audio is copied to the Studio folder on this computer. */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = m => window.toast ? window.toast(m, true) : console.log(m);
  const DIR = "Proofing", ISSUES = ["Misread", "Skipped", "Added", "Mispronounced", "Noise", "Performance", "Other"];
  const S = { jobs: null, job: null, ch: null, run: null, stop: false, sel: 0, form: null, splitMethod: "auto" };
  let el = null, audioEl = null, audioUrl = null, audioFor = null;

  // ---------------- storage ----------------
  async function dir(create) { if (!Store.root) throw new Error("Open your Library first."); return Store.root.getDirectoryHandle(DIR, { create: !!create }); }
  async function listJobs() {
    const out = []; let d; try { d = await dir(false); } catch (e) { return out; }
    for await (const [name, h] of d.entries()) if (h.kind === "file" && /\.json$/.test(name) && !/\(\d+\)\.json$/.test(name)) {
      try { const j = JSON.parse(await (await h.getFile()).text()); if (j && j.id) out.push(j); } catch (e) {}
    }
    return out.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  }
  async function saveJob(j) {
    j.updated = new Date().toISOString();
    const d = await dir(true), fh = await d.getFileHandle(j.id + ".json", { create: true }), w = await fh.createWritable();
    await w.write(JSON.stringify(j)); await w.close();
  }
  async function deleteJob(j) {
    const d = await dir(false); await d.removeEntry(j.id + ".json").catch(() => {});
    try { const s = await studio(false); if (s) await (await s.getDirectoryHandle(DIR)).removeEntry(j.id, { recursive: true }); } catch (e) {}
  }
  async function studio(ask) {
    let st = await Store.studioStatus();
    if (st === "ready") return Store.studio;
    if (!ask) return null;
    if (st === "needs-permission") await Store.reopenStudio();
    else { say("Choose your Studio folder (on this computer, outside Google Drive): the chapter audio is copied there."); await Store.pickStudio(); }
    return Store.studio;
  }
  async function audioDir(j, create) { const s = await studio(create); if (!s) return null; const p = await s.getDirectoryHandle(DIR, { create }); return p.getDirectoryHandle(j.id, { create }); }
  async function audioFile(j, ci) {
    const c = j.chapters[ci]; if (!c.audio) return null;
    try { const d = await audioDir(j, false); return d ? await (await d.getFileHandle(c.audio.file)).getFile() : null; } catch (e) { return null; }
  }

  // ---------------- a new job: the manuscript, split into chapters ----------------
  async function readManuscript(file, text) {
    let raw;
    if (file && /\.docx$/i.test(file.name)) raw = await window.readDocx(await file.arrayBuffer(), {});
    else raw = Prep.blocksFromPlainText(file ? await file.text() : text);
    const blocks = Prep.cleanBlocks(raw, { sceneBreaks: true, normalizePunct: false, joinBrokenLines: !file && !/\n[ \t]*\n/.test(text || "") });
    return blocks;
  }
  function split(blocks, method) { const r = Prep.detect(blocks, method); return Prep.buildChapters(blocks, r.starts).filter(c => c.included); }
  async function createJob(name, chapters) {
    const j = { id: Prep.uid(), name: name || "Proof", created: new Date().toISOString(), ignore: [],
      chapters: chapters.map(c => ({ id: c.id, title: c.title, paras: c.paras, words: c.words, audio: null, status: "", flags: [], map: [] })) };
    await saveJob(j); S.jobs = null; S.job = j; S.ch = null; S.form = null; render(); return j;
  }

  // ---------------- bringing in audio ----------------
  async function attach(ci, file) {
    const j = S.job, d = await audioDir(j, true); if (!d) return;
    const c = j.chapters[ci], name = String(ci + 1).padStart(3, "0") + "-" + file.name.replace(/[\\/:*?"<>|]+/g, "");
    if (c.audio && c.audio.file !== name) await d.removeEntry(c.audio.file).catch(() => {});
    const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(file); await w.close();
    c.audio = { file: name, name: file.name, size: file.size };
    if (c.flags.length && !confirm("“" + c.title + "” already has " + c.flags.length + " flag" + (c.flags.length === 1 ? "" : "s") + ". Keep them? (Cancel clears them so you can proof the new audio fresh.)")) { c.flags = []; c.map = []; c.status = ""; }
    else if (!c.flags.length) c.status = "";
  }
  async function attachMany(files) {
    const j = S.job, list = [...files].filter(f => /\.(wav|mp3|m4a|aac|aif|aiff|flac|ogg)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!list.length) { say("No audio files there."); return; }
    const pairs = list.slice(0, j.chapters.length).map((f, i) => "  " + j.chapters[i].title + "  ←  " + f.name).join("\n");
    if (!confirm("Matched in file-name order:\n\n" + pairs + (list.length !== j.chapters.length ? "\n\n(" + list.length + " files for " + j.chapters.length + " chapters.)" : "") + "\n\nBring them in?")) return;
    if (!(await studio(true))) return;
    for (let i = 0; i < Math.min(list.length, j.chapters.length); i++) { setNote("Copying " + list[i].name + "…"); await attach(i, list[i]); }
    setNote(""); await saveJob(j); render();
  }

  // ---------------- proofing ----------------
  async function proofChapter(j, ci, onP) {
    const c = j.chapters[ci], f = await audioFile(j, ci); if (!f) throw new Error("“" + c.title + "”: its audio isn't on this computer. Bring it in again.");
    const ab = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await f.arrayBuffer()), x = ab.getChannelData(0), L = x.length / 16000;
    const toks = Prep.tokens(c), ignore = new Set([...(j.ignore || []), ...(Store.settings.proofIgnore || [])].map(w => LRProof.norm(w)));
    const flags = [], map = []; let cur = 0;
    const STEP = 27, LEN = 30;
    for (let a = 0; a < L - 0.5; a += STEP) {
      if (S.stop) throw Object.assign(new Error("stopped"), { stopped: true });
      const seg = x.subarray(Math.round(a * 16000), Math.round(Math.min(L, a + LEN) * 16000));
      const chunks = await LRProof.hearTimed(seg, 16000);
      const words = [], when = [];
      for (const ck of chunks) { const ws = LRProof.split(ck.text || ""), t0 = (ck.t && ck.t[0]) || 0, t1 = (ck.t && ck.t[1] != null ? ck.t[1] : t0 + 2); ws.forEach((w, k) => { words.push(w); when.push(a + t0 + (t1 - t0) * k / Math.max(1, ws.length)); }); }
      const text = []; for (let i = Math.max(0, cur - 15); i < toks.length && text.length < 260; i++) text.push({ w: toks[i].w, i });
      if (!text.length || !words.length) { onP && onP(Math.min(1, (a + LEN) / L)); continue; }
      const m = LRProof.matches(text, words);
      // where each text word sits in the audio (for times, and for clicking a word to hear it)
      let last = -9; for (const p of m) if (p.i > cur - 15 && when[p.h] - last >= 1.5) { map.push([+when[p.h].toFixed(2), p.i]); last = when[p.h]; }
      const timeOf = i => { let t = null; for (const p of m) { if (p.i > i) { if (t == null) t = when[p.h]; break; } t = when[p.h]; } return t == null ? a : t; };
      // keep what this window owns: its middle (the overlap with the next window is the next one's)
      const lo = a === 0 ? 0 : a + 1.5, hi = a + STEP >= L - 0.5 ? Infinity : a + STEP + 1.5;
      const spoken = words.join(" ");
      for (const it of LRProof.align(text, spoken, ignore)) {
        const t = timeOf(it.from); if (t < lo || t >= hi) continue;
        if (flags.some(z => z.from <= it.to && z.to >= it.from)) continue;
        flags.push({ id: Prep.uid(), from: it.from, to: it.to, kind: it.kind, text: it.kind === "extra" ? "" : toks.slice(it.from, it.to + 1).map(z => z.w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).join(" "), heard: it.heard, t: +t.toFixed(2), state: "open", issue: it.kind === "missed" ? "Skipped" : it.kind === "extra" ? "Added" : "Misread", note: "" });
      }
      if (m.length) cur = Math.max(cur, m[m.length - 1].i);
      onP && onP(Math.min(1, (a + LEN) / L));
    }
    const clean = []; for (const p of map) if (!clean.length || (p[1] > clean[clean.length - 1][1] && p[0] > clean[clean.length - 1][0])) clean.push(p);
    // keep what was already decided on this chapter (a re-proof doesn't undo your review)
    const old = c.flags || [];
    for (const f2 of flags) { const o = old.find(z => z.from === f2.from && z.to === f2.to && z.state !== "open"); if (o) Object.assign(f2, { state: o.state, issue: o.issue, note: o.note }); }
    c.flags = flags.concat(old.filter(z => z.manual)).sort((p, q) => p.t - q.t);
    c.map = clean; c.dur = +L.toFixed(1); c.status = "proofed"; c.proofedAt = new Date().toISOString();
    return flags.length;
  }
  async function runQueue(list) {
    if (S.run) return;
    const j = S.job; S.stop = false; S.run = { list, k: 0, p: 0 }; render();
    try {
      setNote("Loading the proofer (the first time it downloads once)…");
      await LRProof.load("careful");
      for (const ci of list) {
        S.run.ci = ci; S.run.k++; S.run.p = 0; j.chapters[ci].status = "proofing"; render();
        try { await proofChapter(j, ci, p => { S.run.p = p; setNote("Proofing " + j.chapters[ci].title + " (" + S.run.k + " of " + list.length + ")… " + Math.round(p * 100) + "%"); }); }
        catch (e) { j.chapters[ci].status = j.chapters[ci].proofedAt ? "proofed" : ""; if (e.stopped) break; say(e.message); continue; }
        await saveJob(j); render();
      }
    } catch (e) { say("The proofer stopped: " + (e.message || e)); }
    finally { const was = S.run; S.run = null; S.stop = false; setNote(""); await saveJob(j).catch(() => {}); render();
      if (was && !S.ch && was.list.length === 1) openChapter(was.list[0]); }
  }

  // ---------------- review ----------------
  const open = c => (c.flags || []).filter(f => f.state === "open").length;
  const picks = c => (c.flags || []).filter(f => f.state === "pickup");
  function clock(t) { t = Math.max(0, Math.round(t || 0)); return Math.floor(t / 3600) + ":" + String(Math.floor(t / 60) % 60).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"); }
  function lineOf(c, f) {
    // the sentence it's in, with the words in question in [brackets]; a skipped word is marked where it should be
    const toks = Prep.tokens(c); let s = f.from, e = f.to;
    while (s > 0 && !toks[s - 1].end && toks[s - 1].p === toks[s].p && f.from - s < 25) s--;
    while (e < toks.length - 1 && !toks[e].end && toks[e + 1].p === toks[e].p && e - f.to < 25) e++;
    const out = []; for (let i = s; i <= e; i++) { let w = toks[i].w; if (i === f.from) w = "[" + w; if (i === f.to) w += "]"; out.push(w); }
    return out.join(" ");
  }
  function what(f) { return f.manual ? "" : f.kind === "missed" ? "skipped “" + f.text + "”" : f.kind === "extra" ? "added “" + f.heard + "”" : "heard “" + f.heard + "” for “" + f.text + "”"; }
  // what the proofer heard, when it adds something the line doesn't show
  const detail = f => f.manual || f.kind === "missed" ? "" : f.kind === "extra" ? "added “" + f.heard + "”" : "heard “" + f.heard + "”";
  function rowsFor(c) { return picks(c).map(f => [c.title, clock(f.t), lineOf(c, f), f.issue + (detail(f) ? " (" + detail(f) + ")" : ""), f.note || ""]); }
  const tsv = rows => rows.map(r => r.map(v => String(v).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
  const HEAD = ["Chapter", "Time", "Line", "Issue", "Note"];
  async function copy(rows, head) {
    const t = tsv(head ? [HEAD].concat(rows) : rows);
    try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    say("📋 " + rows.length + " pickup" + (rows.length === 1 ? "" : "s") + " copied. Click the first empty row in your sheet and paste."); return t;
  }

  async function play(t) {
    const j = S.job, c = j.chapters[S.ch];
    if (audioFor !== c.audio?.file) {
      const f = await audioFile(j, S.ch); if (!f) { say("This chapter's audio isn't on this computer. Bring it in again to listen."); return; }
      if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = URL.createObjectURL(f); audioFor = c.audio.file;
      audioEl = audioEl || new Audio(); audioEl.src = audioUrl; await new Promise(r => { audioEl.onloadedmetadata = r; setTimeout(r, 1500); });
    }
    audioEl.currentTime = Math.max(0, t - 2); audioEl.play().catch(() => {}); render();
  }
  function stopAudio() { if (audioEl) audioEl.pause(); }
  function timeAt(c, i) { let t = 0; for (const p of c.map || []) { if (p[1] > i) break; t = p[0]; } return t; }
  async function setFlag(fid, patch, quiet) {
    const c = S.job.chapters[S.ch], f = c.flags.find(z => z.id === fid); if (!f) return;
    Object.assign(f, patch); if (quiet) return saveJob(S.job);          // an issue or a note: no redraw, so typing is never interrupted if (!open(c) && c.status === "proofed") c.status = "reviewed"; else if (open(c) && c.status === "reviewed") c.status = "proofed";
    await saveJob(S.job); render();
  }
  async function ignoreWord(fid) {
    const j = S.job, c = j.chapters[S.ch], f = c.flags.find(z => z.id === fid); if (!f) return;
    const words = (f.text || f.heard || "").split(/\s+/).filter(Boolean); if (!words.length) return setFlag(fid, { state: "ignored" });
    j.ignore = [...new Set([...(j.ignore || []), ...words])];
    const ig = new Set(j.ignore.map(w => LRProof.norm(w))); let n = 0;
    for (const ch of j.chapters) for (const z of ch.flags || []) if (z.state === "open" && !z.manual && (z.text || "").split(/\s+/).filter(Boolean).every(w => ig.has(LRProof.norm(w)))) { z.state = "ignored"; n++; }
    for (const ch of j.chapters) if (ch.status === "proofed" && !open(ch)) ch.status = "reviewed";
    await saveJob(j); say("Ignoring “" + words.join(" ") + "” in this proof" + (n > 1 ? ": " + n + " flags cleared" : "") + "."); render();
  }
  async function addManual(i) {
    const c = S.job.chapters[S.ch], toks = Prep.tokens(c);
    const f = { id: Prep.uid(), from: i, to: i, kind: "manual", manual: true, text: toks[i].w, heard: "", t: timeAt(c, i), state: "pickup", issue: "Other", note: "" };
    c.flags.push(f); c.flags.sort((p, q) => p.t - q.t || p.from - q.from); S.sel = c.flags.indexOf(f); await saveJob(S.job); render();
    const n = el.querySelector(`[data-pd-note="${f.id}"]`); if (n) n.focus();
  }
  function openChapter(ci) { S.ch = ci; stopAudio(); const c = S.job.chapters[ci]; S.sel = Math.max(0, (c.flags || []).findIndex(f => f.state === "open")); render(); }

  // ---------------- the panel ----------------
  let noteText = "";
  function setNote(t) { noteText = t; const n = el && el.querySelector("#pd-note"); if (n) n.textContent = t; }
  async function render() {
    if (!el || !el.isConnected) return;
    if (!S.job) {
      if (!S.jobs) { el.innerHTML = `<div class="card pdesk"><span class="muted small">Looking for proof jobs…</span></div>`; S.jobs = await listJobs().catch(() => []); }
      return renderJobs();
    }
    renderJob();
  }
  function renderJobs() {
    const F = S.form;
    el.innerHTML = `<div class="card pdesk">
      ${S.jobs.length ? `<div class="pd-jobs">${S.jobs.map(j => { const n = j.chapters.length, done = j.chapters.filter(c => c.status === "reviewed").length, pk = j.chapters.reduce((a, c) => a + picks(c).length, 0);
        return `<button class="pd-job" data-pd="job:${esc(j.id)}"><b>${esc(j.name)}</b><span class="small muted">${n} chapters · ${done} reviewed · ${pk} pickup${pk === 1 ? "" : "s"}</span></button>`; }).join("")}</div>` : `<p class="small muted" style="margin-top:0">No proof jobs yet.</p>`}
      <details class="pd-new" ${F || !S.jobs.length ? "open" : ""}><summary><b>New proof job</b></summary>
        <div class="row" style="align-items:flex-end;margin-top:8px"><label>Name<input id="pd-name" value="${esc(F ? F.name : "")}" placeholder="e.g. SAB1 proof" style="width:220px"></label>
          <label>Manuscript<input type="file" id="pd-file" accept=".docx,.txt,.md"></label>
          ${F && F.blocks ? `<label>Split chapters on<select id="pd-split">${Object.entries(Prep.METHOD_LABELS).map(([k, l]) => `<option value="${k}" ${S.splitMethod === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}</div>
        <details class="small" style="margin-top:6px"><summary>…or paste the text</summary><textarea id="pd-paste" rows="5" placeholder="Paste the whole manuscript">${esc(F && F.pasted || "")}</textarea><button class="btn small" id="pd-usepaste">Use this text</button></details>
        ${F && F.chapters ? `<p class="small" style="margin:10px 0 4px"><b>${F.chapters.length} chapter${F.chapters.length === 1 ? "" : "s"}</b>: ${esc(F.chapters.slice(0, 8).map(c => c.title).join(" · "))}${F.chapters.length > 8 ? " …" : ""}</p>
          <div class="row"><div class="spacer"></div><button class="btn primary" id="pd-create">Create the job</button></div>` : ""}
      </details></div>`;
    el.querySelectorAll("[data-pd^='job:']").forEach(b => b.onclick = () => { S.job = S.jobs.find(j => j.id === b.dataset.pd.slice(4)); S.ch = null; render(); });
    const name = el.querySelector("#pd-name"); name.oninput = () => { S.form = S.form || {}; S.form.name = name.value; };
    const resplit = () => { S.form.chapters = split(S.form.blocks, S.splitMethod); renderJobs(); };
    el.querySelector("#pd-file").onchange = async e => { const f = e.target.files[0]; if (!f) return;
      try { S.form = Object.assign(S.form || {}, { blocks: await readManuscript(f), name: (S.form && S.form.name) || f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ") }); resplit(); } catch (er) { say(er.message || String(er)); } };
    el.querySelector("#pd-usepaste").onclick = async () => { const t = el.querySelector("#pd-paste").value; if (!t.trim()) return;
      S.form = Object.assign(S.form || {}, { pasted: t, blocks: await readManuscript(null, t), name: (S.form && S.form.name) || "Proof" }); resplit(); };
    const sp = el.querySelector("#pd-split"); if (sp) sp.onchange = () => { S.splitMethod = sp.value; resplit(); };
    const cr = el.querySelector("#pd-create"); if (cr) cr.onclick = () => createJob(S.form.name, S.form.chapters).catch(e => say(e.message));
  }
  function statusOf(c, ci) {
    if (S.run && S.run.ci === ci) return `<span class="pd-st run">proofing ${Math.round(S.run.p * 100)}%</span>`;
    if (S.run && S.run.list.includes(ci) && !c.proofedAt) return `<span class="pd-st">waiting</span>`;
    if (!c.audio) return `<span class="pd-st muted">no audio</span>`;
    if (!c.proofedAt) return `<span class="pd-st muted">ready to proof</span>`;
    const o = open(c), p = picks(c).length;
    return o ? `<span class="pd-st warn">${o} to review</span>${p ? ` <span class="pd-st">${p} pickup${p === 1 ? "" : "s"}</span>` : ""}` : `<span class="pd-st ok">✓ reviewed · ${p} pickup${p === 1 ? "" : "s"}</span>`;
  }
  function renderJob() {
    const j = S.job, busy = !!S.run, todo = j.chapters.map((c, i) => i).filter(i => j.chapters[i].audio && !j.chapters[i].proofedAt);
    const allPk = j.chapters.reduce((a, c) => a + picks(c).length, 0);
    let h = `<div class="card pdesk">
      <div class="row" style="align-items:center"><button class="btn small quiet" data-pd="back">← All proof jobs</button><h3 style="margin:0 0 0 8px">${esc(j.name)}</h3><div class="spacer"></div>
        <button class="btn small" data-pd="bringall" ${busy ? "disabled" : ""}>📼 Bring in chapter audio…</button>
        ${busy ? `<button class="btn small" data-pd="stop">Stop after this chapter</button>` : `<button class="btn small primary" data-pd="proofall" ${todo.length ? "" : "disabled"}>🔎 Proof ${todo.length ? todo.length + " chapter" + (todo.length === 1 ? "" : "s") : "all"}</button>`}</div>
      <div class="small muted" id="pd-note">${esc(noteText)}</div>
      <table class="pd-chs"><tbody>${j.chapters.map((c, i) => `<tr class="${S.ch === i ? "on" : ""}">
          <td class="muted">${i + 1}</td><td><b>${esc(c.title)}</b><br><span class="small muted">${(c.words || 0).toLocaleString()} words${c.audio ? " · " + esc(c.audio.name) : ""}${c.dur ? " · " + clock(c.dur) : ""}</span></td>
          <td>${statusOf(c, i)}</td>
          <td class="pd-acts"><label class="btn small quiet" title="Choose this chapter's audio">${c.audio ? "Replace audio" : "Add audio"}<input type="file" accept="audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac" data-pd-one="${i}" hidden ${busy ? "disabled" : ""}></label>
            ${c.audio ? `<button class="btn small" data-pd="proof:${i}" ${busy ? "disabled" : ""}>${c.proofedAt ? "Proof again" : "Proof"}</button>` : ""}
            ${c.proofedAt ? `<button class="btn small ${S.ch === i ? "primary" : ""}" data-pd="review:${i}">Review</button>` : ""}
            ${picks(c).length ? `<button class="btn small" data-pd="copy:${i}" title="Copy this chapter's pickups as rows for a Google Sheet">📋 Copy</button>` : ""}</td></tr>`).join("")}</tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn small quiet danger" data-pd="delete" ${busy ? "disabled" : ""}>Delete this proof job</button><div class="spacer"></div>
        ${allPk ? `<label class="check small"><input type="checkbox" id="pd-head"> With a header row</label><button class="btn small" data-pd="copyall">📋 Copy every pickup (${allPk})</button>` : ""}</div></div>`;
    if (S.ch != null && j.chapters[S.ch]) h += reviewHtml();
    el.innerHTML = h;
    wireJob();
  }
  function reviewHtml() {
    const j = S.job, c = j.chapters[S.ch], toks = Prep.tokens(c), fl = c.flags || [], f = fl[S.sel];
    const mark = {}; fl.forEach((z, k) => { for (let i = z.from; i <= z.to; i++) mark[i] = mark[i] || []; for (let i = z.from; i <= z.to; i++) mark[i].push(k); });
    const paras = []; let cur = -1, buf = [];
    toks.forEach((t, i) => { if (t.p !== cur) { if (buf.length) paras.push(buf.join(" ")); buf = []; cur = t.p; }
      const ks = mark[i], st = ks ? fl[ks[0]].state : "";
      buf.push(`<span class="w ${ks ? "f-" + st : ""} ${ks && ks.includes(S.sel) ? "sel" : ""}" data-i="${i}"${ks ? ` data-k="${ks[0]}"` : ""}>${esc(t.w)}</span>`); });
    if (buf.length) paras.push(buf.join(" "));
    const o = open(c), k = picks(c).length;
    return `<div class="card pd-review">
      <div class="row" style="align-items:center"><h3 style="margin:0">${esc(c.title)}</h3><span class="small muted" style="margin-left:10px">${fl.length} flag${fl.length === 1 ? "" : "s"} · ${o} to review · ${k} pickup${k === 1 ? "" : "s"}</span><div class="spacer"></div>
        ${k ? `<button class="btn small primary" data-pd="copy:${S.ch}">📋 Copy ${k} pickup${k === 1 ? "" : "s"} for the sheet</button>` : ""}<button class="btn small quiet" data-pd="close">✕</button></div>
      <p class="small muted" style="margin:4px 0 10px">J / K: next and previous flag · Space: listen · P: pickup · I: ignore. Click any word to hear it there; double-click to add your own pickup.</p>
      <div class="pd-grid"><div class="pd-flags">${fl.length ? fl.map((z, n) => `<div class="pd-flag ${z.state} ${n === S.sel ? "sel" : ""}" data-sel="${n}">
          <div class="row" style="align-items:center;gap:6px"><b class="pd-t">${clock(z.t)}</b><button class="btn tiny" data-pd="play:${z.id}" title="Listen from just before">▶</button><span class="small">${z.manual ? "your flag" : esc(what(z))}</span><div class="spacer"></div>
            <span class="pd-state">${z.state === "pickup" ? "Pickup" : z.state === "ignored" ? "Ignored" : ""}</span></div>
          <div class="pd-line">${esc(lineOf(c, z)).replace(/\[([^\]]*)\]/, "<mark>$1</mark>")}</div>
          ${n === S.sel || z.state === "pickup" ? `<div class="row pd-do" style="gap:6px;align-items:center">
            ${z.state !== "pickup" ? `<button class="btn small primary" data-pd="pick:${z.id}">Pickup</button>` : `<select class="pd-issue" data-pd-issue="${z.id}">${ISSUES.map(x => `<option ${x === z.issue ? "selected" : ""}>${x}</option>`).join("")}</select><input class="pd-note" data-pd-note="${z.id}" value="${esc(z.note)}" placeholder="Note for the reader (optional)">`}
            ${z.state !== "ignored" ? `<button class="btn small" data-pd="ign:${z.id}">Ignore</button>` : `<button class="btn small" data-pd="reopen:${z.id}">Undo ignore</button>`}
            ${!z.manual && z.state !== "ignored" && (z.text || "").trim() ? `<button class="btn small quiet" data-pd="ignw:${z.id}" title="Names and invented words the proofer keeps tripping on">Ignore “${esc(short(z.text))}” everywhere</button>` : ""}
            ${z.manual ? `<button class="btn small quiet" data-pd="del:${z.id}">Remove</button>` : ""}</div>` : ""}</div>`).join("") : `<p class="muted">Nothing flagged. Listen through anything you're unsure of, and double-click a word to add your own pickup.</p>`}</div>
        <div class="pd-text">${paras.map(p => `<p>${p}</p>`).join("")}</div></div></div>`;
  }
  const short = s => { s = String(s || ""); return s.length > 18 ? s.slice(0, 16) + "…" : s; };
  function wireJob() {
    const j = S.job;
    el.querySelectorAll("[data-pd]").forEach(b => b.onclick = e => { e.stopPropagation(); act(b.dataset.pd); });
    el.querySelectorAll("[data-pd-one]").forEach(inp => inp.onchange = async () => { const f = inp.files[0]; if (!f) return; if (!(await studio(true))) return; setNote("Copying " + f.name + "…"); await attach(+inp.dataset.pdOne, f); setNote(""); await saveJob(j); render(); });
    el.querySelectorAll("[data-sel]").forEach(d => d.onclick = e => { if (e.target.closest("button,select,input")) return; S.sel = +d.dataset.sel; render(); });
    el.querySelectorAll("[data-pd-issue]").forEach(s => s.onchange = () => setFlag(s.dataset.pdIssue, { issue: s.value }, true));
    el.querySelectorAll("[data-pd-note]").forEach(n => { n.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") n.blur(); }; n.onchange = () => setFlag(n.dataset.pdNote, { note: n.value }, true); n.oninput = () => { clearTimeout(n._t); n._t = setTimeout(() => setFlag(n.dataset.pdNote, { note: n.value }, true), 600); }; });
    const tx = el.querySelector(".pd-text");
    if (tx) {
      tx.onclick = e => { const w = e.target.closest(".w"); if (!w) return; if (w.dataset.k != null) { S.sel = +w.dataset.k; render(); } const c = j.chapters[S.ch]; play(timeAt(c, +w.dataset.i) + 1.5); };
      tx.ondblclick = e => { const w = e.target.closest(".w"); if (w) addManual(+w.dataset.i); };
      const s = el.querySelector(".pd-flag.sel"); if (s && S.scroll) { s.scrollIntoView({ block: "nearest" }); const ws = tx.querySelector(".w.sel"); if (ws) ws.scrollIntoView({ block: "center" }); } S.scroll = false;
    }
  }
  async function act(a) {
    const j = S.job, [k, x] = [a.split(":")[0], a.slice(a.indexOf(":") + 1)];
    const c = S.ch != null ? j.chapters[S.ch] : null;
    switch (k) {
      case "back": stopAudio(); S.job = null; S.ch = null; S.jobs = null; return render();
      case "bringall": { const inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = "audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac"; inp.onchange = () => attachMany(inp.files); inp.click(); return; }
      case "proofall": return runQueue(j.chapters.map((z, i) => i).filter(i => j.chapters[i].audio && !j.chapters[i].proofedAt));
      case "proof": { const i = +x; if (j.chapters[i].proofedAt && !confirm("Proof “" + j.chapters[i].title + "” again? Pickups and ignores you've already marked are kept.")) return; return runQueue([i]); }
      case "stop": S.stop = true; setNote("Stopping after this chapter…"); return;
      case "review": return openChapter(+x);
      case "close": stopAudio(); S.ch = null; return render();
      case "copy": return copy(rowsFor(j.chapters[+x]), el.querySelector("#pd-head")?.checked);
      case "copyall": return copy(j.chapters.flatMap(rowsFor), el.querySelector("#pd-head")?.checked);
      case "delete": if (!confirm("Delete the proof job “" + j.name + "”? Its flags and pickups go, and so does its copy of the audio in your Studio folder. Your own audio files elsewhere aren't touched.")) return;
        await deleteJob(j); S.job = null; S.ch = null; S.jobs = null; return render();
      case "play": { const f = c.flags.find(z => z.id === x); S.sel = c.flags.indexOf(f); return play(f.t); }
      case "pick": return setFlag(x, { state: "pickup" });
      case "ign": return setFlag(x, { state: "ignored" });
      case "reopen": return setFlag(x, { state: "open" });
      case "ignw": return ignoreWord(x);
      case "del": { c.flags = c.flags.filter(z => z.id !== x); S.sel = Math.min(S.sel, c.flags.length - 1); await saveJob(j); return render(); }
    }
  }
  // keys while reviewing
  document.addEventListener("keydown", e => {
    if (!el || !el.isConnected || !S.job || S.ch == null || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input,textarea,select,[contenteditable]")) return;
    const c = S.job.chapters[S.ch], fl = c.flags || [], f = fl[S.sel]; if (!fl.length) return;
    const k = e.key.toLowerCase();
    if (k === "j" || k === "k") { e.preventDefault(); S.sel = Math.max(0, Math.min(fl.length - 1, S.sel + (k === "j" ? 1 : -1))); S.scroll = true; render(); }
    else if (k === " ") { e.preventDefault(); if (audioEl && !audioEl.paused) stopAudio(); else if (f) play(f.t); }
    else if (k === "p" && f) { e.preventDefault(); setFlag(f.id, { state: "pickup" }).then(() => { const nx = fl.findIndex((z, n) => n > S.sel && z.state === "open"); if (nx >= 0) { S.sel = nx; S.scroll = true; render(); } }); }
    else if (k === "i" && f) { e.preventDefault(); setFlag(f.id, { state: "ignored" }).then(() => { const nx = fl.findIndex((z, n) => n > S.sel && z.state === "open"); if (nx >= 0) { S.sel = nx; S.scroll = true; render(); } }); }
  });

  function mount(target) { el = target; render(); }
  window.LRProofDesk = { mount, createJob, readManuscript, split, attach, attachMany, runQueue, proofChapter, rowsFor, tsv, copy, listJobs, get state() { return S; }, act, setFlag, addManual, lineOf };
})();
