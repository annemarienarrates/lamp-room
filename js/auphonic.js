/* The Lamp Room — Auphonic mastering.
   Your Auphonic API key lives in this browser only (localStorage on this computer): never in the Library, the shared
   folder or the repo. Settings ▸ This computer ▸ Auphonic holds it.
   Sending: the chapter goes up as a lossless FLAC (48 kHz, 16-bit: about a third of a raw WAV) in the background,
   with progress, while you keep working. One reader: one file with your preset. Several readers (a love scene): a
   track each in one multitrack production, each track taking the noise and breath settings of its reader's preset.
   Coming back: the result is named for delivery (output_basename). If you've connected Google Drive in Auphonic and
   shown the Lamp Room the folder Auphonic writes to, Auphonic puts it there, Drive brings it down to this computer,
   and the Lamp Room files it into Studio ▸ Mastered ▸ <book>. Failing that, it downloads it straight from Auphonic.
   Jobs are remembered on this computer, so a closed tab catches up when it's next open. */
(function () {
  "use strict";
  const API = "https://auphonic.com/api", KEY = "lr-auphonic-key", JOBS = "lr-auphonic-jobs", LAST = "lr-auphonic-presets", SVC = "lr-auphonic-svc";
  const ls = { get: k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} } };
  const key = () => ls.get(KEY), setKey = k => ls.set(KEY, (k || "").trim());
  const auth = () => ({ Authorization: "bearer " + key() });
  const fail = (status, j) => {
    const fe = j && j.form_errors && Object.keys(j.form_errors).length ? " " + JSON.stringify(j.form_errors) : "";
    return new Error(status === 403 || status === 401 ? "Auphonic didn't accept the API key. Check it in Settings ▸ This computer." : "Auphonic: " + ((j && j.error_message) || status) + fe);
  };
  async function call(path, opts) {
    let res;
    try { res = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign(auth(), (opts || {}).headers || {}) })); }
    catch (e) { throw new Error("Couldn't reach Auphonic (" + e.message + ")."); }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok || (j && j.status_code && j.status_code >= 400)) throw fail(res.status, j);
    return j ? j.data : null;
  }
  // an upload with progress (fetch can't report it): onProg(0..1)
  function upload(path, fd, onProg) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest(); x.open("POST", API + path); x.setRequestHeader("Authorization", "bearer " + key());
      x.upload.onprogress = e => { if (e.lengthComputable && onProg) onProg(e.loaded / e.total); };
      x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch (e) {} if (x.status >= 200 && x.status < 300 && !(j && j.status_code >= 400)) resolve(j && j.data); else reject(fail(x.status, j)); };
      x.onerror = () => reject(new Error("the connection broke off"));
      x.send(fd);
    });
  }
  async function presets() {
    const d = await call("/presets.json?minimal_data=1");
    const list = (d || []).map(p => ({ uuid: p.uuid, name: p.preset_name, multitrack: !!p.is_multitrack }));
    ls.set(LAST, JSON.stringify(list)); return list;
  }
  const cachedPresets = () => { try { return JSON.parse(ls.get(LAST) || "[]"); } catch (e) { return []; } };
  const preset = uuid => call("/preset/" + uuid + ".json");
  const user = () => call("/user.json");
  // the external services connected in Auphonic (Google Drive, Dropbox…): one of them can carry results home
  async function services() { const d = await call("/services.json"); const l = (d || []).map(s => ({ uuid: s.uuid, type: s.type, name: s.display_name || s.type })); ls.set("lr-auphonic-svcs", JSON.stringify(l)); return l; }
  const cachedServices = () => { try { return JSON.parse(ls.get("lr-auphonic-svcs") || "[]"); } catch (e) { return []; } };
  const service = () => ls.get(SVC), setService = u => ls.set(SVC, u);

  const TRACK_KEYS = /^(denoise|denoisemethod|denoiseamount|deverbamount|debreathamount|dehum|dehumamount|filtering|filtermethod|hipfilter|backforeground|gate|crossgate|music_denoise|mouthnoise|deess)/;
  const trackAlgos = a => { const o = {}; for (const k in (a || {})) if (TRACK_KEYS.test(k)) o[k] = a[k]; return o; };
  const masterAlgos = a => { const o = {}; for (const k in (a || {})) if (!TRACK_KEYS.test(k)) o[k] = a[k]; return o; };

  // ---- jobs on this computer ----
  const jobs = () => { try { return JSON.parse(ls.get(JOBS) || "[]"); } catch (e) { return []; } };
  const saveJobs = l => { ls.set(JOBS, JSON.stringify(l)); document.dispatchEvent(new CustomEvent("lr-auphonic")); };
  const update = (uuid, patch) => saveJobs(jobs().map(j => j.uuid === uuid ? Object.assign({}, j, patch) : j));
  const remove = uuid => saveJobs(jobs().filter(j => j.uuid !== uuid));
  const dismiss = (bookId, chapId) => saveJobs(jobs().filter(j => !(j.bookId === bookId && j.chapId === chapId)));
  const jobFor = (bookId, chapId) => jobs().find(x => x.bookId === bookId && x.chapId === chapId) || null;
  const uploading = new Set();

  // send: create the production, list the job, upload in the background, start it. Returns once the job is listed.
  // files: [{ id, file, presetUuid }] (one entry = a plain production with the main preset)
  async function send({ files, mainUuid, title, name, bookId, chapId }) {
    const multi = files.length > 1;
    let body;
    if (multi) {
      const main = await preset(mainUuid), cache = {};
      const algosOf = async u => (cache[u] = cache[u] || (await preset(u)).algorithms || {});
      body = { metadata: { title }, output_basename: name, is_multitrack: true, algorithms: masterAlgos(main.algorithms), output_files: main.output_files || [{ format: "wav" }], multi_input_files: [] };
      for (const t of files) body.multi_input_files.push({ type: "multitrack", id: t.id, algorithms: trackAlgos(await algosOf(t.presetUuid)) });
    } else body = { preset: mainUuid, metadata: { title }, output_basename: name };
    if (service()) body.outgoing_services = [{ uuid: service() }];
    const d = await call("/productions.json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    dismiss(bookId, chapId);
    const l = jobs(); l.push({ uuid: d.uuid, bookId, chapId, name, title, started: new Date().toISOString(), state: "Uploading 0%", up: true, viaDrive: !!service() }); saveJobs(l);
    uploading.add(d.uuid);
    const fd = new FormData(); for (const t of files) fd.append(multi ? t.id : "input_file", t.file, t.file.name);
    send.running = (async () => {
      try {
        let last = -1; await upload("/production/" + d.uuid + "/upload.json", fd, p => { const n = Math.round(p * 100); if (n !== last && (n - last >= 2 || n === 100)) { last = n; update(d.uuid, { state: "Uploading " + n + "%" }); } });
        await call("/production/" + d.uuid + "/start.json", { method: "POST" });
        update(d.uuid, { state: "Waiting at Auphonic", up: false }); poll(true);
      } catch (e) { update(d.uuid, { state: "Upload failed (" + e.message + "). Send it again.", up: false, error: true }); }
      finally { uploading.delete(d.uuid); if (send.after) send.after(d.uuid); }
    })();
    return d.uuid;
  }
  const status = uuid => call("/production/" + uuid + ".json");

  async function masteredDir(book, ask) {
    let st = await Store.studioStatus();
    if (st === "needs-permission" && ask) { try { await Store.reopenStudio(); st = "ready"; } catch (e) {} }
    if (st !== "ready") return null;
    const m = await Store.studio.getDirectoryHandle("Mastered", { create: true });
    return m.getDirectoryHandle(book.folder, { create: true });
  }
  const extOf = o => String(o.ending || (o.filename || "").split(".").pop() || o.format || "wav").replace(/^\./, "");
  async function copyInto(dir, name, src) { const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable(); if (src.pipeTo) await src.pipeTo(w); else { await w.write(src); await w.close(); } }
  // the results, from Auphonic's Drive folder (if they're here yet) or straight from Auphonic
  async function bringHome(job, d, ask) {
    const book = Store.byId(job.bookId); if (!book) return { gone: true };
    const dir = await masteredDir(book, ask); if (!dir) return { wait: "studio" };
    const saved = [];
    // 1. Drive: files named <name>.<ext> in the folder Auphonic writes to (or a folder or two inside it)
    const drive = await Store.keptFolder("auphonic-drive", ask);
    if (drive) {
      const found = [];
      const look = async (h, depth) => { for await (const [n, x] of h.entries()) { if (x.kind === "file" && n.startsWith(job.name + ".") && !/\.(tmp|partial|crdownload|gdoc)$/i.test(n)) found.push([h, n, x]); else if (x.kind === "directory" && depth < 2) await look(x, depth + 1); } };
      try { await look(drive, 0); } catch (e) {}
      if (found.length) {
        for (const [h, n, x] of found) { await copyInto(dir, n, await x.getFile()); saved.push(n); try { await h.removeEntry(n); } catch (e) {} }
        return { saved, book };
      }
    }
    // 2. straight from Auphonic
    try {
      for (const o of (d.output_files || []).filter(o => o.download_url)) {
        const res = await fetch(o.download_url, { headers: auth() });
        if (!res.ok) throw new Error("download " + res.status);
        const n = job.name + "." + extOf(o); await copyInto(dir, n, res.body); saved.push(n);
      }
    } catch (e) { if (job.viaDrive) return { wait: "drive" }; throw e; }
    if (!saved.length && job.viaDrive) return { wait: "drive" };
    return { saved, book };
  }
  function markMastered(book, chapId) {
    const ch = book.chapters.find(c => c.id === chapId); if (!ch) return;
    const order = ["todo", "recorded", "edited", "mastered", "proofed", "delivered"]; if (order.indexOf(ch.status) < 3) ch.status = "mastered";
    ch.masteredAt = new Date().toISOString(); Store.saveBook(book, true);
  }
  let timer = null, busy = false;
  // ask: true when a click started it, so the Studio and Drive folders can be asked for again
  async function poll(soon, ask) {
    clearTimeout(timer);
    if (!key() || !jobs().length) return;
    if (soon) { timer = setTimeout(() => poll(), 4000); return; }
    if (busy) return; busy = true;
    try {
      for (const j of jobs()) {
        if (!j.uuid || uploading.has(j.uuid) || j.error) continue;
        let d; try { d = await status(j.uuid); } catch (e) { update(j.uuid, { state: "Can't check: " + e.message }); continue; }
        if (j.up && [0, 9, 10, 98].includes(d.status)) { update(j.uuid, { state: "The upload didn't finish (was the tab closed?). Send it again.", error: true, up: false }); continue; }
        if (d.status === 3) {
          try {
            const r = await bringHome(j, d, ask);
            if (r.gone) { remove(j.uuid); continue; }
            if (r.wait === "studio") { update(j.uuid, { state: "Mastered. Click to let the Lamp Room use your Studio folder", need: "click" }); continue; }
            if (r.wait === "drive") { const needs = (await Store.hasKeptFolder("auphonic-drive")) && !(await Store.keptFolder("auphonic-drive")); update(j.uuid, { state: needs ? "Mastered. Click to let the Lamp Room see the Auphonic folder" : "Mastered. Waiting for Google Drive to bring it down", need: needs ? "click" : "" }); continue; }
            remove(j.uuid); markMastered(r.book, j.chapId);
            if (r.saved.length && window.note) window.note("🎚 Mastered: " + r.saved.join(", ") + (r.saved.length === 1 ? " is" : " are") + " in Studio ▸ Mastered ▸ " + r.book.folder + ".");
          } catch (e) { update(j.uuid, { state: "Mastered, but it couldn't come home (" + e.message + "). Set up the Drive return in Settings ▸ This computer ▸ Auphonic, or download it from your Auphonic account." }); }
        } else if (d.status === 2) update(j.uuid, { state: "Error at Auphonic: " + (d.error_message || d.status_string), error: true });
        else update(j.uuid, { state: d.status_string || "Working", up: false });
      }
    } finally { busy = false; }
    if (jobs().some(j => !j.error)) timer = setTimeout(() => poll(), 30000);
  }
  // a click on a job waiting for a folder: ask for it, then try again
  const retry = () => poll(false, true);

  window.LRAuphonic = { key, setKey, presets, cachedPresets, preset, user, services, cachedServices, service, setService, send, status, jobs, update, remove, dismiss, jobFor, poll, retry, trackAlgos, masterAlgos, API };
  setTimeout(() => poll(), 3000);
})();
