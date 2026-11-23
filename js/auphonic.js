/* The Lamp Room — Auphonic mastering.
   Your Auphonic API key lives in this browser only (localStorage on this computer): never in the Library, the shared
   folder or the repo. Settings ▸ This computer ▸ Auphonic holds it.
   One reader: the chapter goes up as one file with your chosen preset (Auphonic's Simple API).
   Several readers (a love scene, say): each reader goes up as their own track, lined up from 0, in one multitrack
   production. Each track takes the noise and breath settings of the preset you pick for that reader; the mix, the
   loudness and the output files come from the main preset.
   The Lamp Room keeps a list of what's at Auphonic on this computer, checks every half minute, and brings each result
   home to Studio ▸ Mastered ▸ <book>, named for delivery. Leaving the Booth (or closing the tab) doesn't lose a job. */
(function () {
  "use strict";
  const API = "https://auphonic.com/api", KEY = "lr-auphonic-key", JOBS = "lr-auphonic-jobs", LAST = "lr-auphonic-presets";
  const key = () => { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } };
  const setKey = k => { try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch (e) {} };
  const auth = () => ({ Authorization: "bearer " + key() });
  async function call(path, opts) {
    let res;
    try { res = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign(auth(), (opts || {}).headers || {}) })); }
    catch (e) { throw new Error("Couldn't reach Auphonic (" + e.message + ")."); }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || (j && j.status_code && j.status_code >= 400)) {
      const fe = j && j.form_errors && Object.keys(j.form_errors).length ? " " + JSON.stringify(j.form_errors) : "";
      throw new Error(res.status === 403 || res.status === 401 ? "Auphonic didn't accept the API key. Check it in Settings ▸ This computer." : "Auphonic: " + ((j && j.error_message) || res.status) + fe);
    }
    return j ? j.data : null;
  }
  // presets: [{ uuid, name, multitrack }], newest list cached for the dialog
  async function presets() {
    const d = await call("/presets.json?minimal_data=1");
    const list = (d || []).map(p => ({ uuid: p.uuid, name: p.preset_name, multitrack: !!p.is_multitrack }));
    try { localStorage.setItem(LAST, JSON.stringify(list)); } catch (e) {}
    return list;
  }
  const cachedPresets = () => { try { return JSON.parse(localStorage.getItem(LAST) || "[]"); } catch (e) { return []; } };
  const preset = uuid => call("/preset/" + uuid + ".json");
  async function user() { return call("/user.json"); }

  // a track takes its preset's noise, reverb, breath and filtering settings; the rest is the master's
  const TRACK_KEYS = /^(denoise|denoisemethod|denoiseamount|deverbamount|debreathamount|dehum|dehumamount|filtering|filtermethod|hipfilter|backforeground|gate|crossgate|music_denoise|mouthnoise|deess)/;
  const trackAlgos = a => { const o = {}; for (const k in (a || {})) if (TRACK_KEYS.test(k)) o[k] = a[k]; return o; };
  const masterAlgos = a => { const o = {}; for (const k in (a || {})) if (!TRACK_KEYS.test(k)) o[k] = a[k]; return o; };

  async function startSingle(file, presetUuid, title) {
    const fd = new FormData(); fd.append("preset", presetUuid); fd.append("title", title); fd.append("input_file", file, file.name); fd.append("action", "start");
    const d = await call("/simple/productions.json", { method: "POST", body: fd }); return d.uuid;
  }
  // tracks: [{ id, file, presetUuid }]; main: the preset for the mix and the output files
  async function startMulti(tracks, mainUuid, title) {
    const main = await preset(mainUuid), cache = {};
    const algosOf = async u => (cache[u] = cache[u] || (await preset(u)).algorithms || {});
    const body = { metadata: { title }, is_multitrack: true, algorithms: masterAlgos(main.algorithms), output_files: main.output_files || [{ format: "wav" }],
      multi_input_files: [] };
    for (const t of tracks) body.multi_input_files.push({ type: "multitrack", id: t.id, algorithms: trackAlgos(await algosOf(t.presetUuid)) });
    const d = await call("/productions.json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const fd = new FormData(); for (const t of tracks) fd.append(t.id, t.file, t.file.name);
    await call("/production/" + d.uuid + "/upload.json", { method: "POST", body: fd });
    await call("/production/" + d.uuid + "/start.json", { method: "POST" });
    return d.uuid;
  }
  const status = uuid => call("/production/" + uuid + ".json");

  // ---- jobs on this computer ----
  const jobs = () => { try { return JSON.parse(localStorage.getItem(JOBS) || "[]"); } catch (e) { return []; } };
  const saveJobs = l => { try { localStorage.setItem(JOBS, JSON.stringify(l)); } catch (e) {} document.dispatchEvent(new CustomEvent("lr-auphonic")); };
  function addJob(j) { const l = jobs().filter(x => !(x.bookId === j.bookId && x.chapId === j.chapId)); l.push(Object.assign({ started: new Date().toISOString(), state: "Uploading" }, j)); saveJobs(l); poll(true); }
  const jobFor = (bookId, chapId) => jobs().find(x => x.bookId === bookId && x.chapId === chapId) || null;

  async function masteredDir(book) {
    if ((await Store.studioStatus()) !== "ready") return null;
    const m = await Store.studio.getDirectoryHandle("Mastered", { create: true });
    return m.getDirectoryHandle(book.folder, { create: true });
  }
  async function bringHome(job, d) {
    const book = Store.byId(job.bookId); if (!book) return { gone: true };
    const dir = await masteredDir(book); if (!dir) return { wait: "studio" };
    const outs = (d.output_files || []).filter(o => o.download_url), saved = [];
    for (const o of outs) {
      const res = await fetch(o.download_url, { headers: auth() });
      if (!res.ok) throw new Error("Couldn't download " + (o.filename || o.format) + " (" + res.status + ").");
      const ext = (o.ending || (o.filename || "").split(".").pop() || o.format || "wav").replace(/^\./, "");
      const extra = outs.filter(x => (x.ending || x.format) === (o.ending || o.format)).length > 1 ? "-" + (o.suffix || o.format || saved.length) : "";
      const name = job.name + extra + "." + ext, fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
      await res.body.pipeTo(w); saved.push(name);
    }
    const ch = book.chapters.find(c => c.id === job.chapId);
    if (ch) { const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"]; if (order.indexOf(ch.status) < 3) ch.status = "mastered"; ch.masteredAt = new Date().toISOString(); Store.saveBook(book, true); }
    return { saved, book };
  }
  let timer = null, busy = false;
  async function poll(soon) {
    clearTimeout(timer);
    if (!key() || !jobs().length) return;
    if (soon) { timer = setTimeout(() => poll(), 4000); return; }
    if (busy) return; busy = true;
    try {
      for (const j of jobs()) {
        if (!j.uuid) continue;
        let d; try { d = await status(j.uuid); } catch (e) { update(j.uuid, { state: "Can't check: " + e.message }); continue; }
        if (d.status === 3) {
          update(j.uuid, { state: "Downloading" });
          try {
            const r = await bringHome(j, d);
            if (r.wait) { update(j.uuid, { state: "Done at Auphonic: open the Booth once so the Studio folder can be used" }); continue; }
            remove(j.uuid);
            if (r.saved && window.note) window.note("🎚 Mastered: " + r.saved.join(", ") + (r.saved.length === 1 ? " is" : " are") + " in Studio ▸ Mastered ▸ " + r.book.folder + ".");
          } catch (e) { update(j.uuid, { state: "Done at Auphonic, but " + e.message + " It's in your Auphonic account." }); }
        } else if (d.status === 2) update(j.uuid, { state: "Error at Auphonic: " + (d.error_message || d.status_string), error: true });
        else update(j.uuid, { state: d.status_string || "Working" });
      }
    } finally { busy = false; }
    if (jobs().some(j => !j.error)) timer = setTimeout(() => poll(), 30000);
  }
  function update(uuid, patch) { saveJobs(jobs().map(j => j.uuid === uuid ? Object.assign({}, j, patch) : j)); }
  function remove(uuid) { saveJobs(jobs().filter(j => j.uuid !== uuid)); }
  function dismiss(bookId, chapId) { saveJobs(jobs().filter(j => !(j.bookId === bookId && j.chapId === chapId))); }

  window.LRAuphonic = { key, setKey, presets, cachedPresets, preset, user, startSingle, startMulti, status, jobs, addJob, update, remove, dismiss, jobFor, poll, trackAlgos, masterAlgos, API };
  setTimeout(() => poll(), 3000);
})();
