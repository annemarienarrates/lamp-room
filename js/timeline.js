/* The Lamp Room — chapter timeline: tracks of clips, and every edit as a pure function.
   audio = { tracks: [{ clips: [{ file, off, dur, at }] }], anchors: [[t, word]], markers: [{ t, ... }] }
   A clip plays `dur` seconds of `file` starting `off` seconds in, placed at `at` on the timeline.
   Files are never changed: every edit only rearranges clips, so undo is just restoring the object. */
(function (root) {
  "use strict";
  const EPS = 1e-6;
  const clone = x => JSON.parse(JSON.stringify(x));

  function normalize(a) {
    a = a || {};
    if (!a.tracks) a.tracks = [{ clips: a.clips || [] }];
    delete a.clips;
    a.anchors = a.anchors || []; a.markers = a.markers || [];
    if (!a.tracks.length) a.tracks.push({ clips: [] });
    return a;
  }
  const trackLen = tr => tr.clips.reduce((m, c) => Math.max(m, c.at + c.dur), 0);
  const length = a => (a.tracks || []).reduce((m, tr) => Math.max(m, trackLen(tr)), 0);
  const hasAudio = a => (a.tracks || []).some(tr => tr.clips.length);
  const sortTrack = tr => tr.clips.sort((x, y) => x.at - y.at);

  // split the clip under time t on one track into two (no-op at an edge)
  function splitAt(a, ti, t) {
    const tr = a.tracks[ti]; if (!tr) return;
    const out = [];
    for (const c of tr.clips) {
      if (t > c.at + EPS && t < c.at + c.dur - EPS) {
        const d1 = t - c.at;
        const x = Object.assign({}, c, { dur: d1 }), y = Object.assign({}, c, { off: c.off + d1, dur: c.dur - d1, at: t });
        delete x.fo; delete y.fi;                       // a fade-out belongs to the last piece, a fade-in to the first
        out.push(x, y);
      } else out.push(c);
    }
    tr.clips = out;
  }
  // clips (relative to x) lying inside [x, y) on track ti
  function extract(a, ti, x, y) {
    const res = [];
    for (const c of a.tracks[ti].clips) {
      const s = Math.max(x, c.at), e = Math.min(y, c.at + c.dur);
      if (e - s > EPS) { const k = { file: c.file, off: c.off + (s - c.at), dur: e - s, at: s - x }; if (c.g) k.g = c.g; if (c.line) k.line = c.line; res.push(k); }
    }
    return res;
  }
  // remove audio in [x, y) from the given tracks (array of indexes); leaves silence
  function clear(a, tis, x, y) {
    for (const ti of tis) { splitAt(a, ti, x); splitAt(a, ti, y); const tr = a.tracks[ti]; tr.clips = tr.clips.filter(c => !(c.at >= x - EPS && c.at + c.dur <= y + EPS)); }
  }
  // shift everything at or after time t on every track by d seconds (anchors and markers too)
  function shiftAfter(a, t, d) {
    for (const tr of a.tracks) for (const c of tr.clips) if (c.at >= t - EPS) c.at = Math.max(0, c.at + d);
    for (const p of a.anchors) if (p[0] >= t - EPS) p[0] = Math.max(0, p[0] + d);
    for (const m of a.markers) if (m.t >= t - EPS) m.t = Math.max(0, m.t + d);
  }
  // delete [x, y) and close the gap. On every track, so the chapter stays in sync (e.g. duet lines on track 2).
  function deleteRange(a, x, y) {
    if (y - x < EPS) return;
    const all = a.tracks.map((_, i) => i);
    clear(a, all, x, y);
    a.anchors = a.anchors.filter(p => !(p[0] >= x && p[0] < y));
    a.markers = a.markers.filter(m => !(m.t >= x && m.t < y));
    shiftAfter(a, y, -(y - x));
    a.tracks.forEach(sortTrack);
  }
  // open a gap of L seconds at t on every track
  function insertGap(a, t, L) {
    a.tracks.forEach((_, ti) => splitAt(a, ti, t));
    shiftAfter(a, t, L);
  }
  // open d seconds at t on every track except one (whose clip spanning t stays whole): used when you skip the rest of a co-narrator line
  function insertGapExcept(a, t, d, keepTi) {
    a.tracks.forEach((_, ti) => { if (ti !== keepTi) splitAt(a, ti, t); });
    shiftAfter(a, t, d);
  }
  // put clips (relative) onto track ti starting at t, replacing whatever is under them (paste over)
  function overwrite(a, ti, clips, t) {
    const L = clips.reduce((m, c) => Math.max(m, c.at + c.dur), 0);
    clear(a, [ti], t, t + L);
    for (const c of clips) a.tracks[ti].clips.push(Object.assign({}, c, { at: c.at + t }));
    sortTrack(a.tracks[ti]);
  }
  // insert clips (relative) at t on track ti, pushing everything after t along (paste)
  function insert(a, ti, clips, t) {
    const L = clips.reduce((m, c) => Math.max(m, c.at + c.dur), 0);
    if (L < EPS) return;
    insertGap(a, t, L);
    for (const c of clips) a.tracks[ti].clips.push(Object.assign({}, c, { at: c.at + t }));
    sortTrack(a.tracks[ti]);
  }
  // cut everything from t onward (what a punch does before it records)
  function truncate(a, t) {
    for (const tr of a.tracks) tr.clips = tr.clips.filter(c => c.at < t - 1e-4).map(c => (c.at + c.dur > t ? Object.assign({}, c, { dur: t - c.at }) : c));
    a.anchors = a.anchors.filter(x => x[0] < t);
    a.markers = a.markers.filter(m => m.t < t);
  }
  // move one clip to a new time and/or track; anything it lands on there is replaced
  function moveClip(a, ti, ci, nti, nat) {
    const c = a.tracks[ti].clips.splice(ci, 1)[0]; if (!c) return;
    nat = Math.max(0, nat);
    clear(a, [nti], nat, nat + c.dur);
    a.tracks[nti].clips.push(Object.assign({}, c, { at: nat }));
    sortTrack(a.tracks[nti]);
  }
  // Drag one edge of a clip by d seconds. ripple: everything after moves too, on every track (so duet lines stay with
  // the narration); otherwise the clip trims in place, stopping at its neighbours. An edge can only go as far as the
  // recording goes (srcDur = the length of the clip's file). Returns the d actually applied.
  function trimEdge(a, ti, ci, edge, d, ripple, srcDur) {
    const tr = a.tracks[ti], c = tr && tr.clips[ci]; if (!c) return 0;
    const o = { at: c.at, off: c.off, dur: c.dur }, end = o.at + o.dur, others = tr.clips.filter(x => x !== c);
    const prevEnd = others.filter(x => x.at + x.dur <= o.at + EPS).reduce((m, x) => Math.max(m, x.at + x.dur), 0);
    const nextStart = others.filter(x => x.at >= end - EPS).reduce((m, x) => Math.min(m, x.at), Infinity);
    c._trim = 1;
    if (edge === "end") {
      const left = srcDur != null ? Math.max(0, srcDur - o.off - o.dur) : 0;
      d = Math.max(0.05 - o.dur, Math.min(left, d));
      if (!ripple && nextStart !== Infinity) d = Math.min(d, nextStart - end);
      if (ripple) { if (d > EPS) insertGap(a, end, d); else if (d < -EPS) deleteRange(a, end + d, end); }
      const k = tr.clips.find(x => x._trim); if (k) { k.dur = o.dur + d; delete k._trim; }
    } else {
      d = Math.max(-o.off, Math.min(o.dur - 0.05, d));
      if (!ripple) d = Math.max(prevEnd - o.at, d);
      if (ripple) { if (d > EPS) deleteRange(a, o.at, o.at + d); else if (d < -EPS) insertGap(a, o.at, -d); }
      const k = tr.clips.find(x => x._trim); if (k) { k.at = ripple ? o.at : o.at + d; k.off = o.off + d; k.dur = o.dur - d; delete k._trim; }
    }
    tr.clips.forEach(x => delete x._trim); a.tracks.forEach(sortTrack);
    return d;
  }
  const clipAt = (a, ti, t) => { const tr = a.tracks[ti]; if (!tr) return -1; return tr.clips.findIndex(c => t >= c.at && t <= c.at + c.dur); };
  function timeOfWord(a, w) { const x = (a.anchors || []).find(p => p[1] >= w); return x ? x[0] : null; }
  function wordAt(a, t) { let w = null; for (const p of a.anchors || []) { if (p[0] > t) break; w = p[1]; } return w; }

  const Timeline = { normalize, trackLen, length, hasAudio, splitAt, extract, clear, shiftAfter, deleteRange, insertGap, insertGapExcept, overwrite, insert, truncate, moveClip, trimEdge, clipAt, timeOfWord, wordAt, clone };
  if (typeof module !== "undefined" && module.exports) module.exports = Timeline; else root.LRTimeline = Timeline;
})(typeof window !== "undefined" ? window : globalThis);
