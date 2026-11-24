/* booth/02-panels.js — Side panels (Chapters & Tools), the manuscript, character-script cues, the dock and the stats bar.
   Part of the Booth. The parts are joined in order into js/booth.js by dev/tools/build_booth.py:
   they share one scope, so a function here can call any function in another part. */
  // ---------------- side panels: Chapters & Tools ----------------
  const TOOL_TABS = [["shared", "📦 Shared"], ["orig", "📼 Finished audio"], ["duet", "🤝 Collaborate"], ["pickups", "🚩 Pickups"], ["fx", "🎛 Effects"], ["chain", "🎚 Track sound"], ["takes", "🎞 Takes"], ["levels", "📏 Levels, fades & spacing"], ["mic", "🎙 Mic & reading"]];
  // The drawer lists the tabs this book uses; the rest wait under ＋ More. Pickups, effects, track sound, takes,
  // levels and mic are always there. The last tab used is remembered per book, for each person on this computer.
  function tabsThatApply() {
    const me = Store.me() || B.readingAs, out = new Set(["pickups", "fx", "chain", "takes", "levels", "mic"]);
    if (B.book.shared) out.add("shared").add("duet");
    if (B.assembling || B.book.chapters.some(c => c.orig) || ((r => r && !Store.samePerson(r, me))(Prep.readerOf("n", B.chap, B.book)))) out.add("orig");
    if (!out.has("duet") && B.book.chapters.some(c => c.included && Object.keys(Prep.wordsByReader(c, B.book)).some(r => r !== "?" && !Store.samePerson(r, me)))) out.add("duet");
    return out;
  }
  function tabMemory() { try { return JSON.parse(localStorage.getItem("lr-tooltab@" + (Store.me() || "")) || "{}"); } catch (e) { return {}; } }
  function lastTab() { const t = tabMemory()[B.book.id]; return TOOL_TABS.some(([k]) => k === t) ? t : null; }
  function rememberTab(t) { const m = tabMemory(); if (m[B.book.id] === t) return; m[B.book.id] = t; try { localStorage.setItem("lr-tooltab@" + (Store.me() || ""), JSON.stringify(m)); } catch (e) {} }
  // the armed settings match the panel's (so "Update armed" has nothing left to do)
  // just the Arm button of one effect, while a slider moves (the panel isn't redrawn mid-drag)
  function armBtn(k) {
    const b = $('[data-p="arm:' + k + '"]'), on = ((trackSet()[fxTi()] || {}).armed || []).find(e => e.k === k); if (!b || !on) return;
    const same = sameFx(on.p, B.fxp[k]); b.textContent = same ? "✓ Updated" : "↻ Update armed"; b.classList.toggle("fx-uptodate", same);
  }
  function sameFx(a, b) { a = a || {}; b = b || {}; return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => String(a[k]) === String(b[k])); }
  function renderSide() { if (B && !B.rec) setTimeout(() => B && applyProofMarks(), 0);
    const el = $("#bd-side"); if (!el) return;
    const which = B.side || null;
    document.body.classList.toggle("booth-side-open", !!which);
    if (!which) el.innerHTML = `<button class="bd-tools-tab" data-s="tools">${ICON.sliders} Tools ${ICON.chevR}</button><button class="bd-tools-tab bd-ch-tab" data-s="chapters">${ICON.rows} Chapters ${ICON.chevR}</button>`;
    else {
      const keep = $(".bd-tools", el), top = keep ? keep.scrollTop : 0;
      const head = `<div class="bd-tools-head"><div class="bd-lt"><button class="${which === "tools" ? "on" : ""}" data-s="tools">Tools</button><button class="${which === "chapters" ? "on" : ""}" data-s="chapters">Chapters</button></div><button class="stu-btn" data-s="close" title="Close (${esc(kl("tools"))})">‹</button></div>`;
      let body;
      if (which === "chapters") body = `<div class="bch">${B.book.chapters.map((x, i) => { if (!x.included) return ""; const k = B.counts[i], fin = k.mine && k.done >= k.mine, bs = progOf(x, B.readingAs).boothSec || 0;
            return `<button class="bd-ch ${i === B.ci ? "on" : ""} ${k.mine ? "" : "none"}" data-ci="${i}"><span>${fin ? "✓ " : ""}${esc(x.title)}${x.pov ? `<i class="pov">${esc(x.pov)}'s POV</i>` : ""}</span><em>${k.mine ? num(k.mine - k.done) : "—"}${bs ? " · " + hm(bs) : ""}</em></button>`; }).join("")}</div>`;
      else {
        const tab = B.tab = B.tab || lastTab() || "fx"; rememberTab(tab);
        const fits = tabsThatApply(), shown = TOOL_TABS.filter(([k]) => B.allTabs || fits.has(k) || k === tab), hidden = TOOL_TABS.length - shown.length;
        body = `<select class="stu-sel bd-tabsel" data-tab>${shown.map(([k, l]) => `<option value="${k}" ${tab === k ? "selected" : ""}>${l}${k === "takes" && (B.audio.alts || []).length ? " (" + B.audio.alts.length + " kept)" : ""}${k === "pickups" ? (n => n ? " (" + n + ")" : "")(B.audio.markers.filter(m => !m.done && !m.slot).length + pkForMe().filter(q => !Store.pickupReply(B.book, q)).length) : ""}</option>`).join("")}${hidden ? `<option value="__more">＋ More… (${hidden})</option>` : B.allTabs ? `<option value="__fewer">− Show only what this book uses</option>` : ""}</select>
          <div class="bd-toolbody">${({ shared: sharedTabHtml, orig: origTabHtml, duet: duetTabHtml, pickups: pickupsTabHtml, fx: fxTabHtml, chain: chainTabHtml, takes: takesTabHtml, levels: levelsTabHtml, mic: micTabHtml }[tab] || fxTabHtml)()}</div>`;
      }
      el.innerHTML = `<div class="bd-tools">${head}${body}</div>`;
      const nt = $(".bd-tools", el); if (nt && keep && which === "tools") nt.scrollTop = top;
      if (which === "chapters") { const on = $(".bd-ch.on", el); if (on) on.scrollIntoView({ block: "center" }); }
    }
    el.onclick = sideClick; el.onchange = sideChange; el.oninput = sideInput;
  }
  async function sideClick(e) {
    const b = e.target.closest("[data-s],[data-ci],[data-p]"); if (!b || b.disabled) return;
    if (b.blur && b.tagName === "BUTTON") b.blur();
    if (b.dataset.ci != null) { if (!B.rec) openChapter(+b.dataset.ci); return; }
    if (b.dataset.s) { if (b.dataset.s === "close") B.side = null; else B.side = b.dataset.s; renderSide(); layout(); return; }
    const [cmd, x, y] = b.dataset.p.split(":");
    const P = B.fxp, kind = x;
    switch (cmd) {
      case "open": B.fxOpen[x] = !B.fxOpen[x]; return renderSide();
      case "preset": Object.assign(P[kind], LRFx.KINDS[kind].presets[y]); saveFxp(); return renderSide();
      case "preview": return previewFx(kind);
      case "apply": return applyFx([{ k: kind, p: Object.assign({}, P[kind]) }]);
      case "arm": return armFx(kind, true);
      case "disarm": return armFx(kind, false);
      case "fxtrack": B.fxTrack = +x; return renderSide();
      case "chainpreset": { const st = trackSet()[B.fxTrack]; st.chain = x === "voice" ? LRFx.CHAIN_VOICE() : LRFx.CHAIN_DEFAULT(); Store.saveBook(B.book); chainChanged(); return renderSide(); }
      case "savepreset": return savePreset();
      case "loadpreset": return loadPreset(x);
      case "delpreset": { const ps = Store.settings.fxPresets || {}; if (!confirm("Delete the preset “" + x + "”?")) return; delete ps[x]; Store.saveSettings(); return renderSide(); }
      case "altswap": return swapAlt(x);
      case "altdel": { pushUndo(); B.audio.alts = B.audio.alts.filter(a => a.id !== x); Store.saveBook(B.book); toast("That kept take is gone (Undo brings it back)."); return renderSide(); }
      case "takego": { const tr = B.audio.tracks[+x], c = tr && tr.clips[+y]; if (!c) return; selectTake(+x, +y); return seek(c.at); }
      case "takeplay": { const c = B.audio.tracks[+x].clips[+y]; B.sel = { a: c.at, b: c.at + c.dur }; B.track = +x; return togglePlay(true); }
      case "takedel": return deleteTake(+x, +y);
      case "gain": return gainSel(+x);
      case "gainReset": return gainSel(null);
      case "acx": return acxCheck();
      case "mic": return chooseMic();
      case "send": return (async () => { await sendLines(); if (B.book.shared && await sharedH(false) && !assembled()) await sendToShared(true); })();
      case "sendcopy": return pickCopyFolder();
      case "bring": return bringLines();
      case "bringfrom": return pickLinesFolder();
      case "spliceall": return spliceAll();
      case "oall": return bringOriginals(false);
      case "oone": return bringOriginals(true);
      case "omap": return mapBook(false);
      case "omap1": return mapBook(true);
      case "ostop": B.mapStop = true; toast("Stopping after this chapter."); return;
      case "ofind": { B.findQ = (($("#ofind") || {}).value || "").trim(); B.findHits = findInBook(B.findQ); return renderSide(); }
      case "ohit": return goHit(+x, +y);
      case "orepl": return replaceSel();
      case "asmon": return assemble(true);
      case "shsend": return (async () => { if (!amLead() && myRuns().length && T().hasAudio(B.audio)) await sendLines(); return sendToShared(); })();
      case "shconn": return connectShared();
      case "shin": return bringInSends(false);
      case "shre": return bringInSends(true);
      case "shfin": B.exp = null; B.expShared = true; return exportDialog(true);
      case "asmoff": return assemble(false);
      case "recut": return swapRecut(x);
      case "recutkeep": return keepRecut(x);
      case "lplay": { const l = lineFor(theirRuns()[+x]); if (l) toggleAud("l:" + x, () => playLine(l, null, "l:" + x)); return; }
      case "lgo": { const p = placedClip(theirRuns()[+x]); if (p) seek(B.audio.tracks[p.ti].clips[p.ci].at); return; }
      case "lout": return unplace(theirRuns()[+x]);
      case "lin": { const xr = theirRuns()[+x], l = lineFor(xr); if (!l || B.rec) return; pushUndo(); const t = await spliceAt(xr, l, B.playhead != null ? B.playhead : len(), true); B.playhead = t + l.dur + 0.3; edited(); renderSide(); return; }
      case "castdrop": return castDropPick(x);
      case "fzset": return setFades(+($("#fz-in") || {}).value || 0, +($("#fz-out") || {}).value || 0);
      case "fzreset": return resetGainFades();
      case "addspace": return addSpace();
      case "tonelearn": return learnTone();
      case "toneplay": return playTone();
      case "pzprev": await evenPauses(true); return renderSide();
      case "pzapply": return evenPauses(false);
      case "pkrec": { const q = pkForMe().find(z => z.id === x); if (q) pickupRecorder(q); return; }
      case "pkcopy": return copyCastList(x);
      case "pkdrop": { const f = await pickAudioFile(); if (f) return castPickupDrop(x, f); return; }
      case "impmine": { const f = await pickAudioFile(); if (f) return importMine(f); return; }
      case "pkplay": { const q = pkAll().find(z => z.id === x); if (q) toggleAud("pk:" + x, () => playPickupReply(q, "pk:" + x)); return; }
      case "pkin": return applyPickups();
      case "pkcancel": return cancelPickup(x);
      case "lask": return askPickupPrompt(theirRuns()[+x]);
      case "miss": return markMissing(x);
      case "pgo": return pickupPlay(x);
      case "pfix": return pickupFix(x);
      case "pign": return proofIgnoreWord(x);
      case "pdone": return removeMarker(x);
      case "pask": return pickupAsk(x);
    }
  }
  function sideChange(e) {
    const t = e.target;
    if (t.dataset.tab != null) { if (t.value === "__more") B.allTabs = true; else if (t.value === "__fewer") B.allTabs = false; else B.tab = t.value; renderSide(); t.blur(); return; }
    if (t.dataset.duet) { setDuetOpt(t.dataset.duet, t.checked); renderSide(); return; }
    if (t.dataset.p2 === "ocorr") { B.book.corrections = t.checked; Store.saveBook(B.book, true); renderSide(); return; }
    if (t.dataset.p2 === "castwords") { Store.lsSet("lr-castwords", t.checked ? "1" : "0"); return; }
    if (t.dataset.p2 === "omatch") { Store.lsSet("lr-matchlvl", t.checked ? "1" : "0"); return; }
    if (t.dataset.dv) { const k = t.dataset.dv, d = Store.settings.duet = Object.assign({}, Store.settings.duet || {}); d[k] = k === "clean" ? t.checked : k === "vol" ? (+t.value || 0) / 100 : Math.max(0.3, +t.value || 0.8); Store.saveSettings(); if (k !== "vol" || e.type === "change") renderSide(); return; }
    if (t.dataset.pz) { const v = Math.max(0, parseFloat(t.value) || 0); setPause(t.dataset.pz, v); B.pausePreview = null; renderSide(); return; }
    if (t.dataset.pzc === "fill") { B.book.toneFill = t.checked; Store.saveBook(B.book); return; }
    if (t.dataset.pzc === "onComplete") { setPause("onComplete", t.checked); return; }
    if (t.id === "b-as") { if (Store.settings.narrators.some(n => n.name === t.value)) return Store.setMe(t.value); return switchReader(t.value); }
    if (t.dataset.pk) { const [k, f] = t.dataset.pk.split("."); B.fxp[k][f] = t.value; saveFxp(); renderSide(); return; }
    if (t.dataset.ch) { const st = trackSet()[B.fxTrack]; st.chain = LRFx.chainOf(st); const [g, f] = t.dataset.ch.split("."); if (f) st.chain[g][f] = t.type === "checkbox" ? t.checked : +t.value; else st.chain[g] = t.checked; Store.saveBook(B.book); chainChanged(); renderSide(); return; }
    if (t.dataset.pref) { Store.settings[t.dataset.pref] = t.value; Store.saveSettings(); applyReadFont(); if (t.dataset.pref === "pacer") { B.f.setManual(t.value === "manual"); markPos(false); } if (t.dataset.pref === "theme") { document.documentElement.dataset.theme = t.value; B.col = null; drawWave(); } return; }
  }
  function sideInput(e) {
    const t = e.target;
    if (t.dataset.pv) { const [k, f] = t.dataset.pv.split("."); B.fxp[k][f] = +t.value; const o = t.parentNode.querySelector(".fxv"); if (o) o.textContent = fmtV(+t.value, +t.step) + (t.dataset.u || ""); saveFxp(); armBtn(k); return; }
    if (t.dataset.ch && t.type === "range") { const o = t.parentNode.querySelector(".fxv"); if (o) o.textContent = fmtV(+t.value, +t.step) + (t.dataset.u || ""); }
  }
  const fmtV = (v, step) => (+v).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0);
  const rng = (attr, label, min, max, step, val, unit) => `<label class="fxr"><span>${label}</span><input type="range" ${attr} min="${min}" max="${max}" step="${step}" value="${val}" data-u="${esc(unit || "")}"><b class="fxv">${fmtV(val, step)}${esc(unit || "")}</b></label>`;
  function saveFxp() { try { Store.lsSet("lr-fxp", JSON.stringify(B.fxp)); } catch (e) {} }
  function trackPicker() {
    const ts = trackSet(); B.fxTrack = Math.min(B.fxTrack != null ? B.fxTrack : B.track, B.audio.tracks.length - 1);
    return `<div class="fx-tracks">${B.audio.tracks.map((_, i) => `<button class="stu-btn ${i === B.fxTrack ? "on" : ""}" data-p="fxtrack:${i}" title="${esc((ts[i] || {}).name || "")}">${i + 1}${(ts[i] || {}).armed && ts[i].armed.length ? " ●" : ""}</button>`).join("")}<span class="stu-note">${esc((ts[B.fxTrack] || {}).name || "Track " + (B.fxTrack + 1))}</span></div>`;
  }
  function fxTabHtml() {
    const st = trackSet()[B.fxTrack != null ? Math.min(B.fxTrack, B.audio.tracks.length - 1) : B.track] || {}, busy = B.rec || B.busy ? "disabled" : "";
    const armed = st.armed || [], target = B.sel ? "your selection (" + clock(B.sel.b - B.sel.a) + ")" : B.selTake ? "the selected take" : "the whole track";
    let h = `<div class="bd-sec"><b>Effects on a track</b>${trackPicker()}
      <div class="stu-note"><b>Apply</b> changes audio already here (Undo brings the original back). <b>Arm</b> keeps an effect on the track so every new take recorded there gets it when you press Stop, in every chapter.</div>
      ${armed.length ? `<div class="fx-armed"><b>Armed:</b> ${armed.map(e => esc(LRFx.KINDS[e.k].name) + " <i>" + esc(LRFx.KINDS[e.k].sum(e.p)) + "</i>").join(" → ")}</div>` : ""}
      <div class="stu-note">Preview and Apply act on <b>${target}</b>.${B.lastFx ? ` <b>${esc(kl("fxLast"))}</b> repeats ${esc(LRFx.KINDS[B.lastFx[0].k].name.toLowerCase())}.` : ""}</div></div>`;
    h += Object.keys(LRFx.KINDS).map(k => {
      const K = LRFx.KINDS[k], p = B.fxp[k], o = B.fxOpen[k], on = armed.find(e => e.k === k);
      const ctl = K.ctl.map(c => typeof c[2] === "object"
        ? `<label class="fxr"><span>${c[1]}</span><select class="stu-sel" data-pk="${k}.${c[0]}">${Object.keys(c[2]).map(v => `<option value="${v}" ${p[c[0]] === v ? "selected" : ""}>${esc(c[2][v][0])}</option>`).join("")}</select></label>`
        : rng(`data-pv="${k}.${c[0]}"`, c[1], c[2], c[3], c[4], p[c[0]], c[5])).join("");
      return `<div class="fx-card ${on ? "armed" : ""}"><button class="fx-name" data-p="open:${k}"><span>${o ? "▾" : "▸"}</span><b>${K.name}</b><small>${on ? "● armed · " + esc(K.sum(on.p)) : esc(K.note)}</small></button>
        ${o ? `<div class="fx-body">${Object.keys(K.presets).length ? `<div class="fx-chips">${Object.keys(K.presets).map(n => `<button class="stu-btn" data-p="preset:${k}:${esc(n)}">${esc(n)}</button>`).join("")}</div>` : ""}${ctl}
          <div class="fx-chips"><button class="stu-btn" data-p="preview:${k}" ${busy}>${B.preview && B.preview.k === k ? "■ Stop preview" : "▶ Preview"}</button><button class="stu-btn stu-rec" data-p="apply:${k}" ${busy}>Apply</button>
          <button class="stu-btn ${on && sameFx(on.p, p) ? "fx-uptodate" : ""}" data-p="arm:${k}" ${B.rec ? "disabled" : ""} title="${on && sameFx(on.p, p) ? "What's armed matches these settings" : on ? "These settings differ from what's armed: press to arm them" : "Every new take on this track gets this when you press Stop"}">${on ? (sameFx(on.p, p) ? "✓ Updated" : "↻ Update armed") : "⏻ Arm for new takes"}</button>${on ? `<button class="stu-btn" data-p="disarm:${k}">Disarm</button>` : ""}</div></div>` : ""}</div>`;
    }).join("");
    const ps = Store.settings.fxPresets || {};
    h += `<div class="bd-sec"><b>Voice presets</b><div class="stu-note">Save this track's armed effects and track sound as a named voice, then put it on any track or book.</div>
      <div class="fx-chips">${Object.keys(ps).map(n => `<span class="fx-pre"><button class="stu-btn" data-p="loadpreset:${esc(n)}" title="Put this voice on the track">${esc(n)}</button><button class="stu-btn" data-p="delpreset:${esc(n)}" title="Delete">✕</button></span>`).join("")}<button class="stu-btn" data-p="savepreset">＋ Save as preset</button></div></div>`;
    return h;
  }
  function chainTabHtml() {
    const ti = B.fxTrack != null ? Math.min(B.fxTrack, B.audio.tracks.length - 1) : B.track, st = trackSet()[ti] || {}, c = LRFx.chainOf(st);
    const chk = (path, on) => `<label class="check"><input type="checkbox" data-ch="${path}" ${on ? "checked" : ""}> On</label>`;
    const r = (path, l, a, b, s, v, u) => rng(`data-ch="${path}"`, l, a, b, s, v, u);
    return `<div class="bd-sec"><b>Track sound</b>${trackPicker()}
        <div class="stu-note">Plays live and goes into your exports. Your recordings are never altered. Since Auphonic masters for you, leave this off unless you want a voice shaped differently, like a character track.</div>
        <div class="fx-chips"><label class="check"><input type="checkbox" data-ch="on" ${c.on ? "checked" : ""}> <b>Chain on</b></label><button class="stu-btn" data-p="chainpreset:voice">Voice preset</button><button class="stu-btn" data-p="chainpreset:reset">Reset</button></div></div>
      <div class="fx-card"><div class="fx-body"><b>High-pass</b> <small class="muted">rumble below the voice</small>${chk("hpf.on", c.hpf.on)}${r("hpf.f", "Cutoff", 40, 160, 5, c.hpf.f, " Hz")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>Tone EQ</b>${chk("eq.on", c.eq.on)}${r("eq.lo", "Warmth", -6, 6, 0.5, c.eq.lo, " dB")}${r("eq.mud", "Body (300 Hz)", -6, 6, 0.5, c.eq.mud, " dB")}${r("eq.mid", "Presence", -6, 6, 0.5, c.eq.mid, " dB")}${r("eq.hi", "Air", -6, 6, 0.5, c.eq.hi, " dB")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>De-esser</b> <small class="muted">tames harsh “s” sounds</small>${chk("ds.on", c.ds.on)}${r("ds.amt", "Strength", 0, 1, 0.05, c.ds.amt, "")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>Compressor</b>${chk("comp.on", c.comp.on)}${r("comp.thr", "Threshold", -40, -6, 1, c.comp.thr, " dB")}${r("comp.ratio", "Ratio", 1.5, 8, 0.5, c.comp.ratio, ":1")}${r("comp.att", "Attack", 1, 50, 1, c.comp.att, " ms")}${r("comp.rel", "Release", 40, 500, 10, c.comp.rel, " ms")}${r("comp.mk", "Make-up", 0, 12, 0.5, c.comp.mk, " dB")}</div></div>
      <div class="fx-card"><div class="fx-body"><b>Peak limiter</b>${chk("lim.on", c.lim.on)}${r("lim.ceil", "Ceiling", -6, -1, 0.1, c.lim.ceil, " dB")}<div class="stu-note">ACX wants peaks at or under −3 dB.</div></div></div>`;
  }
  function takesTabHtml() {
    const dis = B.rec ? "disabled" : "", ts = trackSet();
    let h = `<div class="bd-sec"><b>Takes in this chapter</b><div class="stu-note">Every take on the timeline. Delete removes just that take: if nothing else is playing under it, the gap closes; otherwise it leaves silence so the other tracks stay in sync. Undo brings it back.</div>`;
    let any = false;
    B.audio.tracks.forEach((tr, ti) => tr.clips.forEach((c, ci) => { any = true; const w = T().wordAt(B.audio, c.at + 0.2), txt = w != null ? B.toks.slice(w, w + 6).map(x => x.w).join(" ") : "";
      h += `<div class="alt-row ${B.selTake && B.selTake.ti === ti && B.selTake.ci === ci ? "on" : ""}"><span><b data-p="takego:${ti}:${ci}" class="lnk">${clock(c.at)}</b> · T${ti + 1} ${esc((ts[ti] || {}).name || "")} · ${clock(c.dur)}${c.fx ? " · 🎛" : ""}${c.g ? " · " + (c.g > 0 ? "+" : "") + c.g + " dB" : ""}<br><i class="muted">${esc(txt)}</i></span>
        <span class="fx-chips"><button class="stu-btn" data-p="takeplay:${ti}:${ci}" ${dis} title="Play this take">▶</button><button class="stu-btn" data-p="takedel:${ti}:${ci}" ${dis} title="Delete this take">🗑</button></span></div>`; }));
    if (!any) h += `<div class="stu-note">No takes yet. Press ${esc(kl("rec"))} to record.</div>`;
    h += `</div><div class="bd-sec"><b>Kept takes</b>`;
    const alts = (B.audio.alts || []).slice().reverse();
    if (!alts.length) h += `<div class="stu-note">When a punch replaces audio, the old take is kept here so you can swap back. The last 14 are kept.</div>`;
    else h += alts.map(a => { const w = T().wordAt(B.audio, a.a + 0.2), txt = w != null ? B.toks.slice(w, w + 6).map(x => x.w).join(" ") : "";
      return `<div class="alt-row"><span><b>${clock(a.a)}</b> · T${a.track + 1} · ${clock(a.len)}<br><i class="muted">${esc(txt)}</i></span><span class="fx-chips"><button class="stu-btn" data-p="altswap:${a.id}" ${dis}>🔁 Swap</button><button class="stu-btn" data-p="altdel:${a.id}" ${dis} title="Forget this kept take">✕</button></span></div>`; }).join("");
    return h + `</div>`;
  }
  function levelsTabHtml() {
    const dis = B.rec || B.busy ? "disabled" : "", a = B.acx && B.acx.ci === B.ci ? B.acx : null;
    const chip = (ok, label, val) => `<span class="acx ${ok ? "ok" : "bad"}">${ok ? "✓" : "✕"} ${label} <b>${val}</b></span>`;
    return spacingHtml() + `<div class="bd-sec"><b>Gain</b><div class="stu-note">Raises or lowers ${B.sel ? "the selection" : B.selTake ? "the selected take" : "a selection or take (select one first)"} on track ${B.track + 1}. Nothing is re-recorded or rewritten.</div>
        <div class="fx-chips">${[-6, -3, -1, 1, 3, 6].map(v => `<button class="stu-btn" data-p="gain:${v}" ${dis} ${B.sel || B.selTake ? "" : "disabled"}>${v > 0 ? "+" : ""}${v} dB</button>`).join("")}<button class="stu-btn" data-p="gainReset" ${dis} ${B.sel || B.selTake ? "" : "disabled"}>Reset</button></div></div>
      <div class="bd-sec"><b>ACX check</b><div class="stu-note">Measures this chapter as it will export (all tracks, track sound included): loudness between −23 and −18 dB RMS, peaks at or under −3 dB, room tone at or under −60 dB.</div>
        ${a ? `<div class="fx-chips">${chip(a.rms >= -23 && a.rms <= -18, "RMS", a.rms.toFixed(1) + " dB")}${chip(a.peak <= -3, "Peak", a.peak.toFixed(1) + " dB")}${chip(a.floor <= -60, "Noise floor", a.floor.toFixed(1) + " dB")}</div>
          <div class="stu-note">${a.rms < -23 ? "Too quiet overall — Auphonic will level it, or raise the gain. " : a.rms > -18 ? "Louder than ACX allows on average. " : ""}${a.peak > -3 ? "Some peaks are too hot. " : ""}${a.floor > -60 ? "The room tone is noisy; check the room and gain. " : ""}${a.rms >= -23 && a.rms <= -18 && a.peak <= -3 && a.floor <= -60 ? "Passes." : ""}</div>` : ""}
        <div class="fx-chips"><button class="stu-btn" data-p="acx" ${dis} ${len() ? "" : "disabled"}>${B.busy === "acx" ? "Checking…" : "Check this chapter"}</button></div></div>`;
  }
  function micTabHtml() {
    const S = Store.settings, readers = [...new Set([B.readingAs, ...S.narrators.map(n => n.name)])];
    return `<div class="bd-sec"><b>Reading as</b><select class="stu-sel" id="b-as" ${B.rec ? "disabled" : ""}>${readers.map(nm => `<option ${nm === B.readingAs ? "selected" : ""}>${esc(nm)}</option>`).join("")}</select>
        <div class="stu-note">Your lines are lit; other readers' lines are dimmed, with the line before yours as a grey cue. Select words in the text to change who reads them.</div></div>
      <div class="bd-sec"><b>Reading</b>
        <label class="fxr"><span>Moving on</span><select class="stu-sel" data-pref="pacer"><option value="auto" ${S.pacer !== "manual" ? "selected" : ""}>Automatic: follows my voice into the next sentence</option><option value="manual" ${S.pacer === "manual" ? "selected" : ""}>Manual: I press Next (good for re-reading)</option></select></label>
        <label class="fxr"><span>Proofing</span><select class="stu-sel" data-pref="proofMode">${[["off", "Off"], ["stop", "When I stop"], ["live", "Live, as I read"]].map(([v, l]) => `<option value="${v}" ${(S.proofMode || "off") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="stu-note">Manual: the highlight stops at the end of each sentence, however often you re-read it. Next sentence (bottom right, or ${esc(kl("nextLine").replace("ArrowDown", "↓"))}) moves on.</div></div>
      <div class="bd-sec"><b>Microphone</b><button class="stu-btn" data-p="mic">🎙 ${esc(B.mic.label ? B.mic.label.slice(0, 34) : "Choose microphone")}</button>
        ${B.mic.isOpen ? (inf => `<div class="stu-note">Capture: <b>${inf.mode === "direct" ? "direct" : inf.mode === "worklet" ? "audio worklet" : "fallback"}</b>${inf.rate ? " · mic at " + (inf.rate / 1000) + " kHz" : ""}${inf.rate && inf.rate !== LRAudio.RATE ? ' · <b class="warn-t">set it to 48 kHz in Audio MIDI Setup</b>' : ""} · ${inf.drops ? '<b class="warn-t">' + inf.drops + " dropout" + (inf.drops === 1 ? "" : "s") + " this session</b>" : "no dropouts"}</div>`)(B.mic.info) : ""}</div>
      <div class="bd-sec"><b>Look</b><label class="fxr"><span>Theme</span><select class="stu-sel" data-pref="theme">${[["ledger", "Ledger"], ["archive", "Archive"], ["lamp", "Lamp"], ["nocturne", "Nocturne"], ["foundry", "Foundry"], ["afterglow", "Afterglow"], ["velvet", "Velvet"], ["signal", "Signal"], ["phosphor", "Phosphor"], ["sanguine", "Sanguine"]].map(([k, l]) => `<option value="${k}" ${(S.theme || "ledger") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="fxr"><span>Reading font</span><select class="stu-sel" data-pref="readFont"><option value="sans" ${S.readFont !== "serif" ? "selected" : ""}>Sans (clean)</option><option value="serif" ${S.readFont === "serif" ? "selected" : ""}>Serif (book)</option></select></label>
        <div class="stu-note">Text size: A− / A+ in the bar above, ${esc(kl("textSmaller"))} / ${esc(kl("textBigger"))}, or ⌘ + scroll over the text.</div></div>
      <a class="stu-btn" href="#/book/${esc(B.book.id)}">Book page →</a>`;
  }
  // after a take with co-narrator lines in it: honour skips, and (if asked) clear your own track under their lines,
  // where you were silent and the mic only heard their line in your headphones
  function afterDuetTake(r) {
    if (!r || !r.drops || !r.drops.length) return;
    const tr = r.track;
    for (const sk of (r.skips || []).slice().sort((a, b) => b.at - a.at)) {
      T().insertGapExcept(B.audio, sk.at, sk.need, sk.ti);
      for (const d of r.drops) { if (d.t >= sk.at - 1e-3) d.t += sk.need; if (d.speak != null && d.speak >= sk.at - 1e-3) d.speak += sk.need; }
    }
    if ((Store.settings.duet || {}).clean === false) return;
    for (const d of r.drops) {
      const a = d.t + 0.05, b = Math.min(d.t + d.dur, d.speak != null ? d.speak - 0.12 : d.t + d.dur) - 0.05;
      if (b - a > 0.2) T().clear(B.audio, [tr], a, b);
    }
  }
  // pickups changed in the shared folder: new asks for me, or replies for my asks
  document.addEventListener("lr-external", e => {
    if (!B || !/^#\/booth\//.test(location.hash) || !(e.detail || []).includes("pickups")) return;
    const n = pkForMe().filter(q => !Store.pickupReply(B.book, q)).length;
    if (n && n !== B.pkSeen) toast("🔁 " + n + " pickup" + (n === 1 ? "" : "s") + " waiting for you in this book: Tools ▸ Pickups.");
    B.pkSeen = n; applyPickups(true).catch(() => {}); renderSide();
  });
  // someone else sat down at this computer: their hotkeys, sizes and look come with them
  document.addEventListener("lr-me", async e => {
    if (B) B.assembling = false;
    KEYS = null;
    if (!B || !/^#\/booth\//.test(location.hash)) return;
    B.laneH = num0(Store.lsGet("lr-laneh"), 72); B.prerollSec = num0(Store.lsGet("lr-preroll"), 3); B.follow = Store.lsGet("lr-follow") !== "0";
    let fp = {}; try { fp = JSON.parse(Store.lsGet("lr-fxp") || "{}") || {}; } catch (er) {}
    for (const k in LRFx.KINDS) B.fxp[k] = Object.assign({}, LRFx.KINDS[k].def, fp[k] || {});
    if (B.view) B.view.pps = num0(Store.lsGet("lr-pps"), 40);
    B.col = null; applyReadFont(); await switchReader(e.detail.to);
  });
  async function switchReader(name) { if (!B) return; await flushSession(); if (!B) return; B.session = null; B.readingAs = name; B.pkTold = false; let ss = []; try { ss = await Store.sessions(name, 2); } catch (er) {} if (!B) return; B.sessions = ss; openChapter(B.ci); }

  function altsHtml() { return ""; }
  function swapAlt(id) {
    const al = (B.audio.alts || []).find(x => x.id === id); if (!al || B.rec) return;
    pushUndo();
    const cur = T().extract(B.audio, al.track, al.a, al.a + al.len);
    T().clear(B.audio, [al.track], al.a, al.a + al.len);
    al.clips.forEach(k => B.audio.tracks[al.track].clips.push(Object.assign({}, k, { at: al.a + k.at })));
    B.audio.tracks[al.track].clips.sort((a, b) => a.at - b.at); al.clips = cur;
    B.sel = { a: al.a, b: al.a + al.len }; B.playhead = al.a; B.track = al.track;
    Store.saveBook(B.book); loadPeaks(); renderEditBar(); renderTransport(); renderSide();
    notice("🔁 Swapped the take at " + clock(al.a) + ". Swap again to go back.");
  }

  // ---------------- manuscript ----------------
  function renderManuscript() {
    const ms = $("#ms"); if (!ms) return;
    const c = B.chap;
    if (B.edit) {
      ms.innerHTML = c.paras.map((p, pi) => p === Prep.SCENE_MARK ? `<div class="brk">⁂</div>` :
        `<p data-p="${pi}">${Prep.paraRuns(p).map(([t, part], ri) => `<span class="run pt-${part.replace(/[^a-z]/g, "")} ${Prep.readerOf(part, c, B.book) && Prep.readerOf(part, c, B.book) !== B.readingAs ? "other" : ""}" contenteditable="true" data-ri="${ri}">${esc(t)}</span>`).join("")}</p>`).join("");
      $$(".run", ms).forEach(el => el.onblur = () => {
        const pi = +el.parentNode.dataset.p, ri = +el.dataset.ri, p = c.paras[pi], txt = el.textContent;
        if (typeof p === "string") c.paras[pi] = txt; else p.r[ri][0] = txt;
        c.words = Prep.countWords(c.paras.map(Prep.paraText).join(" "));
        B.toks = Prep.tokens(c); B.mine = B.toks.map(t => isMine(t, c)); const pos = B.f.pos; B.f = Prep.makeFollower(B.toks, B.mine, pos); B.f.setManual(pacerManual());
        Store.saveBook(B.book); bookCounts(); renderStats();
      });
      return;
    }
    let html = "";
    cuesNow();
    const tagAt = {}; if (cueTags()) for (const q of B.cues) if (!tagAt[q.a]) tagAt[q.a] = q;
    const tagHtml = q => `<span class="cue-tag" data-cuewho="${esc(q.who)}" title="${esc(q.who)}${q.tone ? " · " + esc(q.tone) : ""}${q.fx ? " · FX: " + esc(q.fx) : ""} — open the Character guide"><b>${esc(q.who)}</b>${q.tone ? " · " + esc(q.tone) : ""}${q.fx ? ` · <i>FX</i>` : ""}</span>`;
    const cueFrom = new Set();
    for (let i = 1; i < B.toks.length; i++) if (B.mine[i] && !B.mine[i - 1]) { let j = i - 1; while (j >= 0 && !B.mine[j] && B.toks[j].p === B.toks[i - 1].p) { cueFrom.add(j); j--; } }
    const tokenByPara = {}; B.toks.forEach((t, i) => (tokenByPara[t.p] = tokenByPara[t.p] || []).push(i));
    c.paras.forEach((p, pi) => {
      if (p === Prep.SCENE_MARK) { html += `<div class="brk">⁂</div>`; return; }
      const ids = tokenByPara[pi] || [];
      html += `<p>` + ids.map(i => (tagAt[i] ? tagHtml(tagAt[i]) : "") + `<span class="${B.mine[i] ? "w mine" : cueFrom.has(i) ? "w cue" : "w other"}${i < B.f.pos && B.mine[i] ? " read" : ""}" data-i="${i}">${esc(B.toks[i].w)}</span>`).join(" ") + `</p>`;
    });
    ms.innerHTML = html;
    ms.onclick = e => { const tg = e.target.closest(".cue-tag"); if (tg) { charAddOrOpen(tg.dataset.cuewho); return; } const w = e.target.closest(".w"), sel = window.getSelection(); if (!w || (sel && !sel.isCollapsed)) return; clickWord(+w.dataset.i); };
    markPos(true); applyProofMarks();
  }
  // ---------------- character-script cues ----------------
  const cueTags = () => Store.settings.cueTags !== false, cueWinOn = () => Store.settings.cueWin !== false, cueMini = () => Store.settings.cueMini === true;
  function cuesNow() {
    if (!LRCues.has(B.book)) { B.cues = []; B.cuesFor = null; return B.cues; }
    if (B.cuesFor !== B.toks) { B.cues = LRCues.forChapter(B.book, B.chap, B.toks); B.cuesFor = B.toks; }
    return B.cues;
  }
  function renderCueWin() {
    const el = $("#cue-win"); if (!el) return;
    const list = cuesNow();
    if (!LRCues.has(B.book) || B.edit) { el.className = "hidden"; el.innerHTML = ""; return; }
    const toggles = `<span class="cue-tg">${cueWinOn() ? `<button class="stu-btn" data-cuet="mini" title="${cueMini() ? "Open the cue window" : "Shrink the cue window to one line"}">${cueMini() ? "▾" : "▴"}</button>` : ""}<button class="stu-btn ${cueTags() ? "on" : ""}" data-cuet="tags" title="Show who speaks above each line">🏷 Tags</button><button class="stu-btn ${cueWinOn() ? "on" : ""}" data-cuet="win" title="The cue window">🎭 Cues</button></span>`;
    if (!cueWinOn() || !list.length) { el.className = "cue-win slim"; el.innerHTML = toggles + (list.length ? "" : `<span class="small muted">No cued lines in this chapter.</span>`); bindCueWin(el); return; }
    // the next cued line I read (or any, if none are mine): the one under the reading position, else the next one
    const pos = B.f.pos, pool = list.filter(q => B.mine[q.a]);
    if (!pool.length) { el.className = "cue-win slim"; el.innerHTML = toggles + `<span class="small muted">None of your lines here are cued (the tags still show who's who).</span>`; bindCueWin(el); return; }
    const q = pool.find(x => x.b >= pos) || null;
    const lineText = x => B.toks.slice(x.a, Math.min(x.b + 1, x.a + 14)).map(t => t.w).join(" ") + (x.b - x.a >= 14 ? " …" : "");
    const after = q ? pool[pool.indexOf(q) + 1] : null;
    if (cueMini()) {
      el.className = "cue-win slim";
      el.innerHTML = toggles + (q ? `<span class="cue-mini"><button class="cue-who" data-cuewho="${esc(q.who)}" title="Open ${esc(q.who)}'s Character guide">${esc(q.who)}</button>${q.tone ? ` <span class="cue-tone">(${esc(q.tone)})</span>` : ""}${q.fx ? ` <span class="cue-fx">FX</span>` : ""}</span>` : `<span class="small muted">No more cued lines in this chapter.</span>`);
      bindCueWin(el); return;
    }
    el.className = "cue-win";
    el.innerHTML = toggles + (q ? `
      ${q.prev ? `<div class="cue-prev">${q.prev.who ? `<b>${esc(q.prev.who)}:</b> ` : "<b>Answering:</b> "}${esc(q.prev.text.length > 140 ? q.prev.text.slice(0, 140) + "…" : q.prev.text)}</div>` : ""}
      <div class="cue-now"><button class="cue-who" data-cuewho="${esc(q.who)}" title="Open ${esc(q.who)}'s Character guide">${esc(q.who)}</button>${q.tone ? `<span class="cue-tone">(${esc(q.tone)})</span>` : ""}${q.fx ? `<span class="cue-fx">FX: ${esc(q.fx)}</span>` : ""}<span class="cue-line">${esc(lineText(q))}</span></div>
      ${q.beat ? `<div class="cue-beat small muted">beat: ${esc(q.beat.length > 160 ? q.beat.slice(0, 160) + "…" : q.beat)}</div>` : ""}
      ${after ? `<div class="cue-next small muted">then <b>${esc(after.who)}</b>${after.tone ? " (" + esc(after.tone) + ")" : ""}</div>` : ""}` : `<span class="small muted">No more cued lines in this chapter.</span>`);
    bindCueWin(el);
  }
  function bindCueWin(el) {
    el.onclick = e => {
      const w = e.target.closest("[data-cuewho]"); if (w) { charAddOrOpen(w.dataset.cuewho); return; }
      const t = e.target.closest("[data-cuet]"); if (!t) return;
      if (t.dataset.cuet === "mini") { Store.settings.cueMini = !cueMini(); Store.saveSettings(); renderCueWin(); return; }
      const k = t.dataset.cuet === "tags" ? "cueTags" : "cueWin"; Store.settings[k] = !(Store.settings[k] !== false); Store.saveSettings();
      if (k === "cueTags") renderManuscript(); else renderCueWin();
    };
  }
  function markPos(scroll) {
    if (B && B.holdScroll) scroll = false;
    renderPacer(); renderCueWin(); if (!B.rec) applyProofMarks();
    const ms = $("#ms"); if (!ms || B.edit) return;
    $$(".w.cur", ms).forEach(e => e.classList.remove("cur"));
    $$(".w.mine", ms).forEach(e => e.classList.toggle("read", +e.dataset.i < B.f.pos));
    const cur = ms.querySelector(`.w[data-i="${B.f.pos}"]`);
    if (cur) { cur.classList.add("cur"); if (scroll) { const wrap = $("#ms-wrap"), r = cur.getBoundingClientRect(), wr = wrap.getBoundingClientRect(); if (r.top < wr.top + wr.height * 0.15 || r.top > wr.top + wr.height * 0.6) wrap.scrollTo({ top: wrap.scrollTop + r.top - wr.top - wr.height * 0.33, behavior: "smooth" }); } }
  }

  // ---------------- dock: transport, clocks, level, flags; track heads & lanes ----------------
  function renderTransport() {
    const tp = $("#bd-main"); if (!tp) return;
    const rec = B.rec, playing = B.player.playing, L = len(), has = L > 0;
    const head = B.playhead != null ? B.playhead : L, flags = B.audio.markers.length;
    const bt = (a, label, o) => { o = o || {}; return `<button class="stu-btn ${o.cls || ""}" data-b="${a}" title="${esc(o.tip || "")}" ${o.dis ? "disabled" : ""}>${label}</button>`; };
    const G = (cls, inner) => `<div class="bd-grp ${cls || ""}">${inner}</div>`;
    const cs = clockState();
    tp.innerHTML = `<div class="bd-row bd-r1">` +
      G("bd-transport", bt("rec", rec ? (rec.paused ? ICON.play + " Resume" : ICON.pause + " Pause") : ICON.rec + " Record" + (B.track > 0 ? " T" + (B.track + 1) : ""), { cls: "bd-rec" + (rec && !rec.paused ? " live" : ""), tip: "Record · pause / resume (" + kl("rec") + ")", dis: playing }) +
        bt("stop", ICON.stop + " Stop", { tip: "Stop (" + kl("stop") + ")", dis: !rec && !playing }) +
        bt("play", playing ? ICON.stop + " Playing" : ICON.play + " Play", { tip: "Play / stop (" + kl("play") + ")", dis: rec || !has }) +
        bt("punch", ICON.punch + " Punch " + clock(head), { cls: "bd-punch", tip: "Punch in at the playhead (" + kl("punch") + ")", dis: rec || !has }) +
        bt("flub", "↺ Flub", { tip: "Back to the sentence start, pre-roll, record (" + kl("flub") + ")", dis: !has && !rec })) +
      G("", bt("marker", ICON.flag + " Marker", { tip: "Flub marker (" + kl("marker") + ")" }) + bt("custom", ICON.pin + " Custom", { tip: "Named marker (" + kl("custom") + ") — goes into your WAV export" }) + bt("click", ICON.users + " Click", { tip: "Collaborate: drop their next line in now (" + kl("click") + "). Auto-place usually does it for you." })) +
      `<div class="bd-lcd bd-booth ${cs.on ? "" : "paused"}" data-b="clock" role="button" tabindex="0" title="Booth time on this chapter: starts the first time you press Record on it and stops when you mark the chapter complete. It keeps running when you press Stop (playing back, punching in) and pauses after ${IDLE_MIN} idle minutes. Click to ${cs.label === "booth" ? "pause" : "start"} the clock."><span class="bd-time" id="bd-booth">${clock(prog().boothSec)}</span><span class="bd-bl" id="bd-bl">${cs.label}</span></div>` +
      `<div class="bd-lcd" title="Finished time of this chapter (what you've recorded; the take in progress while recording)"><i class="bd-recdot ${rec && !rec.paused ? "on" : ""}"></i><span class="bd-bl">FH</span><span class="bd-time" id="bd-time">${clock(L)}</span><span class="stu-bar"><i id="bd-lvl"></i></span></div>` +
      `<div class="bd-lcd bd-lm" title="Raw-audio level check. Speak at narration volume: aim for the green band (peaks between −12 and −6 dB)."><button class="stu-btn ${B.lmOn ? "stu-rec" : ""}" data-b="level" ${rec ? "disabled" : ""}>🎚 ${B.lmOn ? "Level on" : "Level"}</button><span class="lm-track"><i class="lm-fill" id="lm-fill"></i><b class="lm-band"></b></span><span class="stu-chip" id="lm-msg">${B.lmOn || rec ? "Say a line…" : "Meter off"}</span></div>` +
      (B.sel ? `<span class="bd-selchip">Selected ${clock(B.sel.b - B.sel.a)}</span>` : "") +
      `<label class="bd-link" title="Start and stop follow-along together with recording"><input type="checkbox" data-b="link" ${B.follow ? "checked" : ""}> with listening</label>` +
      `<div class="bd-right">` + G("", bt("home", ICON.home, { tip: "Playhead to start (Home)", dis: rec }) + bt("end", ICON.end, { tip: "Playhead to end (End)", dis: rec })) +
        G("", bt("undo", ICON.undo, { tip: "Undo (⌘Z)", dis: rec || !B.undo.length }) + bt("redo", ICON.redo, { tip: "Redo (⌘⇧Z)", dis: rec || !B.redo.length }) + bt("split", ICON.split + " Split", { tip: "Split the take at the playhead (B)", dis: rec || !has })) +
        G("", bt("zoomOut", "−", { tip: "Zoom out (−, or ⌘-scroll)" }) + bt("zoomIn", "+", { tip: "Zoom in (=, or ⌘-scroll)" }) + bt("fit", "⤢ Fit", { tip: "See the whole chapter" })) +
        G("", bt("prevFlag", ICON.chevL, { tip: "Previous flag (,)", dis: rec || !flags }) + `<button class="stu-btn" data-b="flags" title="See every flag in this chapter">${ICON.flag} ${flags} flag${flags === 1 ? "" : "s"}</button>` + bt("nextFlag", ICON.chevR, { tip: "Next flag (.)", dis: rec || !flags })) +
      `</div></div>`;
    tp.onclick = dockClick;
    tp.onchange = e => { if (e.target.dataset.b === "link") { B.follow = e.target.checked; Store.lsSet("lr-follow", B.follow ? "1" : "0"); if (!B.follow) stopListening(); else if (B.rec) startListening(); } e.target.blur(); };
    renderHeads();
    const cv = $("#wave"); if (cv) { cv.style.height = (RULER + lanesH()) + "px"; bindWave(cv); }
    document.body.classList.toggle("booth-recording", !!rec);
    if ($("#booth-editbar")) requestAnimationFrame(layout);
    drawWave();
  }
  function renderHeads() {
    const hd = $("#booth-heads"); if (!hd) return;
    const ts = trackSet(), rec = B.rec;
    hd.style.paddingTop = (B.audio.tracks.length > 3 ? 0 : RULER) + "px";
    const many = B.audio.tracks.length > 3;
    hd.innerHTML = (many ? `<div class="th-all" style="height:${RULER}px"><button data-tca="1" title="Collapse every track to a thin strip">⊟ All</button><button data-tca="0" title="Open every track">⊞ All</button></div>` : "") + B.audio.tracks.map((tr, i) => {
      const s = ts[i] || {}, on = i === B.track, grpStart = s.group && (i === 0 || (ts[i - 1] || {}).group !== s.group);
      if (s.collapsed) return `<div class="trk-head thin ${on ? "sel" : ""} ${s.mute ? "dim" : ""}" data-t="${i}" style="height:${COLLAPSED_H - 2}px"><button class="th-tog" data-tc="${i}" title="Open">▸</button><span>${esc(s.name || "Track " + (i + 1))}</span>${(s.armed || []).length ? "<i>FX</i>" : ""}</div>`;
      return `<div class="trk-head ${on ? "sel" : ""} ${s.mute ? "dim" : ""} ${grpStart ? "grp" : ""}" data-t="${i}" style="height:${B.laneH - 2}px">${grpStart ? `<button class="th-grp" data-tg="${esc(s.group)}" title="Collapse all of ${esc(s.group)}'s tracks">▾ ${esc(s.group)}</button>` : ""}
        <div class="th-r1"><button class="th-tog" data-tc="${i}" title="Collapse to a thin strip">▾</button><b>${i + 1}</b><input class="th-name" data-tn="${i}" value="${esc(s.name ? nm(s.name) : "Track " + (i + 1))}" ${rec ? "disabled" : ""}><button class="th-fx ${(s.armed || []).length || LRFx.chainActive(LRFx.chainOf(s)) ? "on" : ""}" data-tf="${i}" title="Effects on this track${(s.armed || []).length ? ": " + esc(s.armed.map(e => LRFx.KINDS[e.k].name).join(", ")) + " armed" : ""}">FX</button>${B.audio.tracks.length > 1 ? `<button data-tx="${i}" title="Remove this track from every chapter" ${rec ? "disabled" : ""}>✕</button>` : ""}</div>
        ${B.laneH >= 46 ? `<div class="th-r2"><button class="${s.mute ? "m-on" : ""}" data-tm="${i}" title="Mute">M</button><button class="${s.solo ? "s-on" : ""}" data-ts="${i}" title="Solo">S</button><input type="range" class="th-vol" min="-24" max="12" step="0.5" value="${s.vol || 0}" data-tv="${i}" title="Volume ${(s.vol || 0) > 0 ? "+" : ""}${s.vol || 0} dB"></div>` : ""}
        ${B.laneH >= 60 ? `<div class="th-sub">${rec && rec.track === i ? (rec.paused ? "paused" : "● recording") : clock(T().trackLen(tr))}</div>` : ""}</div>`;
    }).join("");
    hd.onclick = e => {
      const t = e.target, ts2 = trackSet();
      if (t.dataset.tc != null) { const s = ts2[+t.dataset.tc] = ts2[+t.dataset.tc] || {}; s.collapsed = !s.collapsed; saveTracks(); return; }
      if (t.dataset.tg != null) { ts2.forEach(s => { if (s && s.group === t.dataset.tg) s.collapsed = true; }); saveTracks(); return; }
      if (t.dataset.tca != null) { B.audio.tracks.forEach((_, i) => { const s = ts2[i] = ts2[i] || {}; s.collapsed = t.dataset.tca === "1"; }); saveTracks(); return; }
      if (t.dataset.tm != null) { const s = ts2[+t.dataset.tm]; s.mute = !s.mute; saveTracks(); return; }
      if (t.dataset.ts != null) { const s = ts2[+t.dataset.ts]; s.solo = !s.solo; saveTracks(); return; }
      if (t.dataset.tx != null) { removeTrack(+t.dataset.tx); return; }
      if (t.dataset.tf != null) { B.side = "tools"; B.tab = "fx"; B.fxTrack = +t.dataset.tf; renderSide(); return; }
      const h = t.closest("[data-t]"); if (h && !B.rec && t.tagName !== "INPUT") { B.track = +h.dataset.t; renderEditBar(); renderTransport(); }
    };
    hd.oninput = e => { const t = e.target; if (t.dataset.tv != null) { trackSet()[+t.dataset.tv].vol = +t.value; t.title = "Volume " + t.value + " dB"; Store.saveBook(B.book); } };
    hd.onchange = e => { const t = e.target; if (t.dataset.tn != null) { trackSet()[+t.dataset.tn].name = t.value.trim() || "Track " + (+t.dataset.tn + 1); Store.saveBook(B.book); t.blur(); } };
  }
  function saveTracks() { Store.saveBook(B.book); renderTransport(); }
  function dockClick(e) {
    const b = e.target.closest("[data-b]"); if (!b || b.disabled || b.tagName === "INPUT" || b.tagName === "LABEL") return;
    if (b.blur) b.blur();
    const a = b.dataset.b;
    ({ rec: () => recordToggle(), stop: () => B.rec ? stopRecording() : (B.player.stop(), renderTransport()), play: () => togglePlay(), flub,
      punch: () => punchAt(B.playhead != null ? B.playhead : len()), marker: () => addMarker(), custom: customMarker,
      clock: clockClick, level: levelToggle, split: splitHere, click: () => act("click"), zoomOut: () => setZoom(1 / 1.5), zoomIn: () => setZoom(1.5), fit: fitZoom,
      home: () => seek(0), end: () => seek(len()), undo, redo, prevFlag: () => jumpFlag(-1), nextFlag: () => jumpFlag(1), flags: flagList }[a] || (() => {}))();
  }
  async function levelToggle() {
    if (B.lmOn) { B.lmOn = false; renderTransport(); return; }
    if (!(await ensureMic())) return; B.lmOn = true; B.mic.peakHold = -90; B.lmT = Date.now(); renderTransport();
    const loop = () => { if (!B || !B.lmOn) return; meters(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }
  function customMarker() { const note = prompt("Name this marker (it goes into your WAV export):", ""); if (note == null) return; addMarker(note.trim() || "Marker"); }
  function jumpFlag(dir) {
    const ms = B.audio.markers; if (!ms.length) return;
    const now = B.playhead != null ? B.playhead : len();
    const m = dir > 0 ? ms.find(x => x.t > now + 1.05) || ms[0] : [...ms].reverse().find(x => x.t < now + 0.95) || ms[ms.length - 1];
    seek(Math.max(0, m.t - 1));
  }
  function flagList() {
    const ov = document.createElement("div"); ov.className = "overlay";
    const draw = () => ov.innerHTML = `<div class="card reader" style="max-width:620px"><h2>${ICON.flag} Flags in ${esc(B.chap.title)}</h2>
      ${B.audio.markers.length ? `<table class="ch">${B.audio.markers.map((m, i) => `<tr><td style="width:70px"><b>${clock(m.t)}</b></td><td>${m.note ? "<b>" + esc(m.note) + "</b> · " : ""}<span class="muted">“…${esc(m.ctx || "")}…”</span></td>
        <td style="white-space:nowrap"><button class="btn small" data-go="${i}">Go</button><button class="btn small quiet" data-del="${i}">✕</button></td></tr>`).join("")}</table>` : `<p class="muted">No flags yet. Press M while recording to drop one.</p>`}
      <div class="row"><div class="spacer"></div><button class="btn primary" data-x>Close</button></div></div>`;
    draw(); document.body.appendChild(ov);
    ov.onclick = e => {
      const g = e.target.closest("[data-go]"), d = e.target.closest("[data-del]");
      if (e.target.closest("[data-x]") || e.target === ov) { ov.remove(); renderTransport(); return; }
      if (g) { const t = B.audio.markers[+g.dataset.go].t; ov.remove(); seek(Math.max(0, t - 1)); }
      if (d) { pushUndo(); B.audio.markers.splice(+d.dataset.del, 1); Store.saveBook(B.book); draw(); }
    };
  }

  // ---------------- stats bar ----------------
  function renderStats() {
    const el = $("#stats-bar"); if (!el) return;
    const st = statsNow(), c = B.counts[B.ci] || { mine: 0, done: 0 };
    const bkLeft = Math.max(0, B.bookMine - B.bookDone), chLeft = Math.max(0, c.mine - c.done), pace = st.pace;
    const item = (l, v, t) => `<div class="sb-item" title="${esc(t || "")}"><span>${l}</span><b>${v}</b></div>`;
    el.innerHTML = `<div class="sb-grp">${item("Remaining", num(bkLeft), "Your words left in this book · " + num(chLeft) + " in this chapter")}${item("Pace", pace ? num(pace) : "—", st.paceSrc)}${item("Time Left", pace ? hm(bkLeft / pace * 3600) : "—", "Booth time to finish your part at this pace")}</div>
      <div class="sb-grp">${item("Earned", money(st.earnedToday), "Earned today")}${item("Est. Value", money(st.bookValue), "Your share of this book")}${item("Next Goal", st.milestone ? num(st.milestone.left) : "—", st.milestone ? "Words to " + st.milestone.pct + "% of your part" : "")}</div>
      <div class="sb-grp sb-small">${item("This Chapter Time", hm(prog().boothSec))}${item("This Book Time", hm(st.bookSec))}${item("Booth Today", hm(st.boothToday))}${item("Words Today", num(st.wordsToday))}${item("FH Today", (st.wordsToday / (Store.settings.wpfh || 9300)).toFixed(2))}</div>
      <span style="flex:1"></span><span class="sb-as">${assembled() ? `🧩 Built from everyone's shared takes` : B.assembling ? `🧩 Assembling on <b>${esc(B.readingAs)}</b>'s narration` : `Reading as <b>${esc(B.readingAs)}</b>`}</span>`;
  }
  function statsNow() {
    const today = Prep.ymd(new Date()), S = Store.settings;
    const past = B.sessions.filter(s => !B.session || s.id !== B.session.id);
    const todays = past.filter(s => s.date === today), cur = B.session || { words: 0, boothSec: 0, value: 0 };
    const wordsToday = todays.reduce((a, s) => a + (s.words || 0), 0) + cur.words;
    const boothToday = todays.reduce((a, s) => a + (s.boothSec || 0), 0) + cur.boothSec;
    const earnedToday = todays.reduce((a, s) => a + (s.value || 0), 0) + (cur.value || 0);
    // pace, like Finished Hour: real words over real booth time of the chapters you've completed; else recent sessions; else your setting
    let cw = 0, cs = 0, bookSec = 0;
    B.book.chapters.forEach((c, i) => { const p = progOf(c, B.readingAs); bookSec += p.boothSec || 0; if (c.included && p.done && p.boothSec > 60) { cw += (B.counts[i] || {}).mine || 0; cs += p.boothSec; } });
    const since = Prep.ymd(new Date(Date.now() - 30 * 864e5));
    let w30 = cur.words, b30 = cur.boothSec; past.filter(s => s.date >= since).forEach(s => { w30 += s.words || 0; b30 += s.boothSec || 0; });
    const set = (S.narrators.find(n => n.name === B.readingAs) || {}).pace;
    let pace = null, paceSrc = "Words per booth hour";
    if (cs >= 600) { pace = cw / (cs / 3600); paceSrc += " · from your completed chapters in this book"; }
    else if (window.LRPace) { const r = LRPace.of(B.readingAs, B.book); pace = r.pace; paceSrc += r.from === "series" ? " · your pace on " + r.name : r.from === "overall" ? " · your last 60 days" : r.from === "typed" ? " · from People until there's booth time" : ""; }
    else if (b30 >= 3 * 3600) { pace = w30 / (b30 / 3600); paceSrc += " · last 30 days"; }
    else if (set) { pace = set; paceSrc += " · from Settings until you've completed a chapter"; }
    let milestone = null;
    if (B.bookMine) { const pct = Math.min(100, (Math.floor(100 * B.bookDone / B.bookMine / 10) + 1) * 10); milestone = { pct, left: Math.ceil(B.bookMine * pct / 100) - B.bookDone }; }
    return { wordsToday, boothToday, earnedToday, pace, paceSrc, bookValue: valueOfMyPart(), milestone, bookSec };
  }
  function valueOfMyPart() {
    // on the schedule: the title's net, shared by the words each of you reads
    const T = B.book.titleId && window.LL && LL.tById(B.book.titleId);
    if (T && T.kind !== "author") { const net = LL.moneyOf(T).net, tw = LL.partWords(T), me = (T.stages || []).find(s => s.type === "record" && s.owner === LL.keyOf(B.readingAs)); return net > 0 && tw ? net * ((me && me.words) || B.bookMine) / tw : 0; }
    const words = B.book.chapters.filter(c => c.included).reduce((a, c) => a + c.words, 0);
    const e = Prep.estimate(words, B.book, Store.settings);
    const readers = {}; B.book.chapters.filter(c => c.included).forEach(c => { const w = Prep.wordsByReader(c, B.book); for (const k in w) readers[k] = (readers[k] || 0) + w[k]; });
    const multi = Object.keys(readers).filter(k => k !== "?").length > 1;
    return multi ? e.gross * (B.bookMine / Math.max(1, words)) : e.mine;
  }

