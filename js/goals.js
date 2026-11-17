/* The Lamp Room — Goals: am I on track today, this week, this month, this year? What do I need to catch up?
   Earned = the value of the work recorded (each booth session's words × what that title pays per word).
   Received = checks and deposits in the ledger (shown for "Both of us", since checks are the business's). */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = v => v == null || !isFinite(v) ? "—" : "$" + Math.round(v).toLocaleString();
  const money2 = v => v == null || !isFinite(v) ? "—" : "$" + v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 });
  const hrs = v => v == null || !isFinite(v) ? "—" : v.toFixed(1) + " h";
  const num = v => v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString();
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dow = s => parse(s).getDay();

  const st = { who: null, span: 30, heat: "value", catchDays: 30 };
  try { Object.assign(st, JSON.parse(localStorage.getItem("lr-goals-ui") || "{}")); } catch (e) {}
  const saveUi = () => { try { localStorage.setItem("lr-goals-ui", JSON.stringify({ who: st.who, span: st.span, heat: st.heat, catchDays: st.catchDays })); } catch (e) {} };

  const people = () => Store.settings.narrators.map(n => n.name);
  function goalOf(name) {
    const combined = (window.LL && LL.S && LL.S.cfg && LL.S.cfg.goals && +LL.S.cfg.goals.revenue) || 0, g = Store.settings.incomeGoals || {};
    if (name === "__both") return combined || people().reduce((a, p) => a + (+g[p] || 0), 0);
    return g[name] != null ? +g[name] : Math.round(combined / Math.max(1, people().length));
  }
  function workday(P, s) {
    return P.some(p => { const k = window.LL && LL.keyOf(p); try { if (k && LL.S.cfg.people[k]) return LL.isWorkday(k, s); } catch (e) {} const w = dow(s); return w > 0 && w < 6; });
  }

  async function load(P) {
    const now = new Date(), months = now.getMonth() + 13;        // this year, and the twelve months before today for the charts
    const day = {};
    for (const p of P) for (const s of await Store.sessions(p, months)) {
      const d = day[s.date] = day[s.date] || { value: 0, words: 0, booth: 0, rec: 0 };
      d.value += +s.value || 0; d.words += +s.words || 0; d.booth += (+s.boothSec || 0) / 3600; d.rec += (+s.recSec || 0) / 3600;
    }
    return day;
  }
  function received(year) {
    const out = {}; if (!window.LL || !LL.S) return out;
    for (const t of LL.S.titles || []) { if (t.kind === "author" || !t.checkDate || +t.checkDate.slice(0, 4) !== year) continue; const m = LL.moneyOf(t); out[t.checkDate] = (out[t.checkDate] || 0) + LL.ourCheck(t) - (m.software || 0) - (m.editor || 0); }
    for (const dp of LL.S.deposits || []) if (dp.date && +dp.date.slice(0, 4) === year) out[dp.date] = (out[dp.date] || 0) + (+dp.amount || 0);
    return out;
  }

  function compute(P, day, goal) {
    const today = ymd(new Date()), y = +today.slice(0, 4), y0 = y + "-01-01", y1 = y + "-12-31";
    const days = []; for (let s = y0; s <= y1; s = addD(s, 1)) days.push(s);
    const work = new Set(days.filter(s => workday(P, s)));
    const totalWD = work.size || 260, flat = goal / totalWD;
    const sum = (a, b, k) => { let v = 0; for (let s = a; s <= b; s = addD(s, 1)) v += (day[s] || {})[k] || 0; return v; };
    const wdBetween = (a, b) => { let n = 0; for (let s = a; s <= b; s = addD(s, 1)) if (work.has(s)) n++; return n; };
    const earnedYear = sum(y0, today, "value"), beforeToday = sum(y0, addD(today, -1), "value");
    const remainingWD = Math.max(1, wdBetween(today, y1)), elapsedWD = wdBetween(y0, addD(today, -1));
    const dailyRemaining = Math.max(0, (goal - beforeToday) / remainingWD);
    const mon = addD(today, -((dow(today) + 6) % 7)), sun = addD(mon, 6), m0 = today.slice(0, 8) + "01", m1 = (() => { const d = parse(m0); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); })();
    // per unit, from what you've actually done this year
    const tot = k => sum(y0, today, k), perBooth = tot("booth") ? earnedYear / tot("booth") : null, perFH = tot("rec") ? earnedYear / tot("rec") : null, perWord = tot("words") ? earnedYear / tot("words") : null;
    return { today, y, y0, y1, days, work, totalWD, flat, goal, earnedYear, beforeToday, remainingWD, elapsedWD, dailyRemaining, mon, sun, m0, m1, perBooth, perFH, perWord, sum, wdBetween };
  }
  // where you stand in a period: what you've earned against what the goal expected by the end of yesterday
  function standing(soFar, expect, target) {
    if (!target) return { cls: "", label: "No workdays" };
    const diff = soFar - expect;
    if (expect <= 0) return soFar > 0 ? { cls: "ok", label: "Under way" } : { cls: "", label: "Not started" };
    if (diff >= expect * 0.05) return { cls: "ok", label: "Ahead by " + money(diff) };
    if (diff >= -expect * 0.03) return { cls: "ok", label: "On track" };
    return { cls: "bad", label: "Behind by " + money(-diff) };
  }

  // ---------------- charts (plain SVG, theme colours) ----------------
  const tipEl = () => { let t = $("#gl-tip"); if (!t) { t = document.createElement("div"); t.id = "gl-tip"; document.body.appendChild(t); } return t; };
  function bindTips(root) {
    root.addEventListener("pointermove", e => { const h = e.target.closest("[data-tip]"), t = tipEl(); if (!h) { t.style.display = "none"; return; } t.innerHTML = h.dataset.tip; t.style.display = "block"; const r = t.getBoundingClientRect(); t.style.left = Math.min(innerWidth - r.width - 8, e.clientX + 14) + "px"; t.style.top = Math.max(8, e.clientY - r.height - 10) + "px"; });
    root.addEventListener("pointerleave", () => { tipEl().style.display = "none"; });
  }
  // the year: earned so far (accent), the goal's pace (dashed), received (muted, for both of us)
  function yearChart(C, day, recv) {
    const W = 760, H = 230, L = 52, R = 12, T = 14, B = 26, iw = W - L - R, ih = H - T - B, n = C.days.length;
    let cum = 0, pace = 0, rc = 0; const e = [], p = [], r = [];
    C.days.forEach((s, i) => { if (C.work.has(s)) pace += C.flat; p.push(pace); if (s <= C.today) { cum += (day[s] || {}).value || 0; e.push(cum); rc += recv[s] || 0; r.push(rc); } });
    const max = Math.max(C.goal, cum, rc, 1) * 1.05, X = i => L + iw * i / (n - 1), Y = v => T + ih - ih * v / max;
    const path = arr => arr.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("");
    const ticks = [0, .25, .5, .75, 1].map(f => max / 1.05 * f), mo = [...Array(12)].map((_, m) => C.days.findIndex(s => +s.slice(5, 7) === m + 1));
    const ti = C.days.indexOf(C.today), hits = C.days.map((s, i) => i <= ti || i % 3 === 0 ? `<rect x="${(X(i) - iw / n / 2).toFixed(1)}" y="${T}" width="${(iw / n + 0.5).toFixed(1)}" height="${ih}" fill="transparent" data-tip="<b>${parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</b><br>Goal pace ${money(p[i])}${i <= ti ? "<br>Earned " + money(e[i]) + (recv && Object.keys(recv).length ? "<br>Received " + money(r[i]) : "") + "<br>" + (e[i] >= p[i] ? "Ahead " + money(e[i] - p[i]) : "Behind " + money(p[i] - e[i])) : ""}"/>` : "").join("");
    return `<svg class="gl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Earned this year against the goal's pace">
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl-grid"/><text x="${L - 6}" y="${Y(v) + 4}" class="gl-ax" text-anchor="end">${v >= 1000 ? "$" + Math.round(v / 1000) + "k" : "$" + Math.round(v)}</text>`).join("")}
      ${mo.map((i, m) => i >= 0 ? `<text x="${X(i)}" y="${H - 8}" class="gl-ax">${parse(C.days[i]).toLocaleDateString(undefined, { month: "short" })}</text>` : "").join("")}
      <path d="${path(p)}" class="gl-pace"/>${Object.keys(recv).length ? `<path d="${path(r)}" class="gl-recv"/>` : ""}<path d="${path(e)}" class="gl-earn"/>
      ${ti >= 0 ? `<circle cx="${X(ti)}" cy="${Y(cum)}" r="4.5" class="gl-dot"/>` : ""}${hits}</svg>
      <div class="gl-legend"><span><i class="gl-k earn"></i>Earned</span><span><i class="gl-k pace"></i>Goal pace</span>${Object.keys(recv).length ? `<span><i class="gl-k recv"></i>Received</span>` : ""}</div>`;
  }
  function barChart(vals, labels, fmt, target, aria, partialLast) {
    const W = 360, H = 150, L = 40, R = 8, T = 10, B = 22, iw = W - L - R, ih = H - T - B, n = vals.length, max = Math.max(1e-9, ...vals, target || 0) * 1.1, bw = iw / n;
    const Y = v => T + ih - ih * v / max;
    return `<svg class="gl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
      <line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="gl-grid"/><text x="${L - 5}" y="${T + 9}" class="gl-ax" text-anchor="end">${fmt(max / 1.1, true)}</text>
      ${vals.map((v, i) => { const h = Math.max(0, ih * v / max), x = L + i * bw + Math.max(0.5, bw * 0.12), w = Math.max(1, bw * 0.76); return `<rect x="${x.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, w / 2)}" class="gl-bar ${partialLast && i === n - 1 ? "part" : ""}"/><rect x="${(L + i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent" data-tip="<b>${esc(labels[i])}</b><br>${fmt(v)}"/>`; }).join("")}
      ${target ? `<line x1="${L}" x2="${W - R}" y1="${Y(target)}" y2="${Y(target)}" class="gl-target"/><text x="${W - R}" y="${Y(target) - 4}" class="gl-ax" text-anchor="end">target ${fmt(target, true)}</text>` : ""}
      ${[0, Math.floor(n / 2), n - 1].map(i => `<text x="${L + i * bw + bw / 2}" y="${H - 6}" class="gl-ax" text-anchor="middle">${esc(labels[i])}</text>`).join("")}</svg>`;
  }
  function heatmap(day, key, fmt) {
    const end = ymd(new Date()), start = addD(end, -7 * 52 - dow(end)), cells = [], vals = [];
    for (let s = start; s <= end; s = addD(s, 1)) vals.push((day[s] || {})[key] || 0);
    const nz = vals.filter(v => v > 0).sort((a, b) => a - b), q = f => nz[Math.floor(nz.length * f)] || 0, cut = [q(.25), q(.5), q(.75)];
    let i = 0, months = "";
    for (let s = start; s <= end; s = addD(s, 1), i++) {
      const v = vals[i], w = Math.floor(i / 7), d = i % 7, lvl = !v ? 0 : v <= cut[0] ? 1 : v <= cut[1] ? 2 : v <= cut[2] ? 3 : 4;
      cells.push(`<rect x="${30 + w * 13}" y="${16 + d * 13}" width="11" height="11" rx="2" class="gl-cell l${lvl}" data-tip="<b>${parse(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b><br>${v ? fmt(v) : "No booth time"}"/>`);
      if (d === 0 && s.slice(8) <= "07") months += `<text x="${30 + w * 13}" y="10" class="gl-ax">${parse(s).toLocaleDateString(undefined, { month: "short" })}</text>`;
    }
    return `<svg class="gl-svg" viewBox="0 0 ${30 + 53 * 13 + 4} ${16 + 7 * 13 + 4}" role="img" aria-label="Activity, last 12 months">${months}${["M", "W", "F"].map((t, k) => `<text x="0" y="${16 + (k * 2 + 1) * 13 + 9}" class="gl-ax">${t}</text>`).join("")}${cells.join("")}</svg>
      <div class="gl-legend">Less <i class="gl-cell-k l1"></i><i class="gl-cell-k l2"></i><i class="gl-cell-k l3"></i><i class="gl-cell-k l4"></i> More</div>`;
  }

  // ---------------- the page ----------------
  async function view(main) {
    const P0 = people(); if (!st.who || (st.who !== "__both" && !P0.includes(st.who))) st.who = "__both";
    const P = st.who === "__both" ? P0 : [st.who], goal = goalOf(st.who), day = await load(P), C = compute(P, day, goal), recv = st.who === "__both" ? received(C.y) : {};
    const today = (day[C.today] || {}), dTarget = C.dailyRemaining, flatD = C.flat;
    const wk = { target: C.flat * C.wdBetween(C.mon, C.sun), soFar: C.sum(C.mon, C.today, "value"), expect: C.flat * C.wdBetween(C.mon, addD(C.today, -1)) };
    const mo = { target: C.flat * C.wdBetween(C.m0, C.m1), soFar: C.sum(C.m0, C.today, "value"), expect: C.flat * C.wdBetween(C.m0, addD(C.today, -1)) };
    const yr = { target: goal, soFar: C.earnedYear, expect: C.flat * C.elapsedWD };
    const td = { target: work(C, C.today) ? dTarget : 0, soFar: today.value || 0 };
    const row = (label, o, sx) => { const pct = o.target ? Math.min(100, o.soFar / o.target * 100) : 0, ex = o.expect != null && o.target ? Math.min(100, o.expect / o.target * 100) : null;
      return `<div class="gl-row"><div class="gl-rl"><b>${label}</b><span class="num">${money(o.soFar)} <span class="muted">/ ${money(o.target)}</span></span></div>
        <div class="gl-track"><i style="width:${pct}%"></i>${ex != null ? `<u style="left:${ex}%" title="Where the goal expects you by now"></u>` : ""}</div>
        <span class="badge ${sx.cls}">${esc(sx.label)}</span></div>`; };
    const tdSx = !td.target ? { cls: "", label: "Not a workday" } : td.soFar >= td.target ? { cls: "ok", label: "Done for today" } : { cls: "", label: money(td.target - td.soFar) + " to go" };
    // catch-up: what you'd need to average over the next N workdays to bring the year's average back to the goal's
    const N = Math.max(1, +st.catchDays || 30), needAvg = goal / C.totalWD, avgSoFar = C.elapsedWD ? C.beforeToday / C.elapsedWD : 0;
    const catchD = Math.max(0, (needAvg * (C.elapsedWD + N) - C.beforeToday) / N);
    const per = (dollars, k) => k == null || !dollars ? null : dollars / k;
    const avgWords = C.elapsedWD ? C.sum(C.y0, addD(C.today, -1), "words") / C.elapsedWD : 0, avgBooth = C.elapsedWD ? C.sum(C.y0, addD(C.today, -1), "booth") / C.elapsedWD : 0, avgRec = C.elapsedWD ? C.sum(C.y0, addD(C.today, -1), "rec") / C.elapsedWD : 0;
    // trends
    const span = st.span === 90 ? 90 : 30, tdays = [...Array(span)].map((_, i) => addD(C.today, i - span + 1)), lab = s => parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const tWords = tdays.map(s => (day[s] || {}).words || 0), tBooth = tdays.map(s => (day[s] || {}).booth || 0), tPace = tdays.map(s => { const d = day[s]; return d && d.booth > 0.1 ? d.words / d.booth : 0; });
    const months = [...Array(12)].map((_, i) => { const d = parse(C.today); d.setDate(1); d.setMonth(d.getMonth() - 11 + i); return d; });
    const mVals = months.map(d => { const a = ymd(d), e = (() => { const x = new Date(d); x.setMonth(x.getMonth() + 1); x.setDate(0); return ymd(x); })(); return C.sum(a, e, "value"); });
    const who = [["__both", "Both of us"]].concat(P0.map(p => [p, p]));
    const heatK = { value: ["value", v => money2(v)], words: ["words", v => num(v) + " words"], booth: ["booth", v => v.toFixed(1) + " booth hours"] }[st.heat] || ["value", v => money2(v)];
    main.innerHTML = `<div class="gl"><div class="gl-head"><h1>Goals</h1>
        <div class="gl-seg">${who.map(([k, l]) => `<button data-who="${esc(k)}" class="${st.who === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div></div>
      <div class="gl-tiles">
        <div class="gl-tile"><label>Yearly goal${st.who === "__both" ? " (both of us)" : ""}</label><input class="in" type="number" step="1000" min="0" id="gl-goal" value="${goal}"></div>
        <div class="gl-tile"><label>Per month</label><b>${money(goal / 12)}</b></div>
        <div class="gl-tile"><label>Per week</label><b>${money(goal / 52)}</b></div>
        <div class="gl-tile"><label>Workdays this year</label><b>${C.totalWD}</b><span class="muted">${C.remainingWD} left</span></div>
      </div>
      <div class="gl-grid2">
        <section class="card"><h3>Where you're at</h3>
          ${row("Today", td, tdSx)}${row("This week", wk, standing(wk.soFar, wk.expect, wk.target))}${row("This month", mo, standing(mo.soFar, mo.expect, mo.target))}${row("This year", yr, standing(yr.soFar, yr.expect, yr.target))}
          <p class="small muted">The tick on each bar is where the goal expects you by the end of yesterday. ${money(goal - C.earnedYear)} left to reach ${money(goal)}, over ${C.remainingWD} workdays.</p></section>
        <section class="card"><h3>Today's target</h3>
          <div class="gl-seg small">${[["remaining", "Remaining workdays"], ["flat", "Same every day"]].map(([k, l]) => `<button data-mode="${k}" class="${(Store.settings.goalMode || "remaining") === k ? "on" : ""}">${l}</button>`).join("")}</div>
          ${(() => { const D = (Store.settings.goalMode || "remaining") === "flat" ? flatD : dTarget; return `<div class="gl-four">
            <div><label>$ / workday</label><b>${money(D)}</b></div><div><label>Booth hours</label><b>${hrs(per(D, C.perBooth))}</b></div><div><label>Finished hours</label><b>${hrs(per(D, C.perFH))}</b></div><div><label>Words</label><b>${num(per(D, C.perWord))}</b></div></div>
            <p class="small muted">${(Store.settings.goalMode || "remaining") === "flat" ? "Your goal spread evenly over every workday of the year." : "What's left of your goal spread over the workdays left: it rises if you fall behind and eases off when you're ahead."} Hours and words come from what a booth hour, a finished hour and a word have actually earned you this year.</p>`; })()}</section>
      </div>
      <section class="card"><h3>The year</h3>${yearChart(C, day, recv)}</section>
      <section class="card"><h3>Catch-up plan</h3>
        <div class="row">Bring my average up within <input class="in" type="number" min="1" max="250" id="gl-catch" value="${N}" style="width:70px"> workdays</div>
        ${C.elapsedWD ? `<div class="gl-four">
          <div><label>$ / day needed</label><b>${money(catchD)}</b><span class="muted">averaging ${money(avgSoFar)}</span></div>
          <div><label>Booth hours / day</label><b>${hrs(per(catchD, C.perBooth))}</b><span class="muted">averaging ${hrs(avgBooth)}</span></div>
          <div><label>Finished hours / day</label><b>${hrs(per(catchD, C.perFH))}</b><span class="muted">averaging ${hrs(avgRec)}</span></div>
          <div><label>Words / day</label><b>${num(per(catchD, C.perWord))}</b><span class="muted">averaging ${num(avgWords)}</span></div></div>
          <p class="small muted">${catchD <= needAvg ? "You're at or ahead of the average the goal needs. This is what keeps you there." : "What you'd need to average over the next " + N + " workdays for the year's average to reach the goal's."}</p>` : `<p class="muted">Nothing recorded yet this year. Once you've worked a few days, this shows whether your average is keeping pace.</p>`}</section>
      <section class="card"><h3>Trends <span class="gl-seg small">${[[30, "30 days"], [90, "90 days"]].map(([k, l]) => `<button data-span="${k}" class="${span === k ? "on" : ""}">${l}</button>`).join("")}</span></h3>
        <div class="gl-three">
          <div><div class="gl-cap">Words / day</div>${barChart(tWords, tdays.map(lab), (v, ax) => ax ? (v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v)) : num(v) + " words", per(flatD, C.perWord), "Words per day")}</div>
          <div><div class="gl-cap">Booth hours / day</div>${barChart(tBooth, tdays.map(lab), (v, ax) => ax ? v.toFixed(1) : v.toFixed(1) + " booth hours", per(flatD, C.perBooth), "Booth hours per day")}</div>
          <div><div class="gl-cap">Pace (words per booth hour)</div>${barChart(tPace, tdays.map(lab), (v, ax) => ax ? Math.round(v) : v ? num(v) + " words / booth hour" : "No booth time", null, "Pace per day")}</div>
        </div></section>
      <div class="gl-grid2">
        <section class="card"><h3>Earned by month</h3>${barChart(mVals, months.map(d => d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })), (v, ax) => ax ? (v >= 1000 ? "$" + Math.round(v / 1000) + "k" : "$" + Math.round(v)) : money(v), goal / 12, "Earned by month", true)}
          <p class="small muted">This month is lighter: it isn't over yet.</p></section>
        <section class="card"><h3>Activity <span class="gl-seg small">${[["value", "$"], ["words", "Words"], ["booth", "Booth hrs"]].map(([k, l]) => `<button data-heat="${k}" class="${st.heat === k ? "on" : ""}">${l}</button>`).join("")}</span></h3>${heatmap(day, heatK[0], heatK[1])}</section>
      </div>
      <section class="ll gl-reck">${window.LL && LL.goalsHTML ? LL.goalsHTML() : ""}</section>
      <p class="small muted">Earned is the value of what you've recorded in the Lamp Room (each session's words × what that title pays per word). Received is checks and deposits from the ledger. History from before the Lamp Room comes in with the Finished Hour import.</p>
    </div>`;
    bindTips(main);
    $$("[data-who]", main).forEach(b => b.onclick = () => { st.who = b.dataset.who; saveUi(); view(main); });
    $$("[data-span]", main).forEach(b => b.onclick = () => { st.span = +b.dataset.span; saveUi(); view(main); });
    $$("[data-heat]", main).forEach(b => b.onclick = () => { st.heat = b.dataset.heat; saveUi(); view(main); });
    $$("[data-mode]", main).forEach(b => b.onclick = () => { Store.settings.goalMode = b.dataset.mode; Store.saveSettings(); view(main); });
    $("#gl-catch", main).onchange = e => { st.catchDays = Math.max(1, +e.target.value || 30); saveUi(); view(main); };
    $("#gl-goal", main).onchange = async e => {
      const v = Math.max(0, +e.target.value || 0);
      if (st.who === "__both") { if (LL.saveCfg) await LL.saveCfg({ goals: Object.assign({}, (LL.S.cfgDoc || {}).goals || {}, { revenue: v }) }); }
      else { Store.settings.incomeGoals = Object.assign({}, Store.settings.incomeGoals || {}, { [st.who]: v }); await Store.saveSettings(); }
      view(main);
    };
  }
  const work = (C, s) => C.work.has(s);
  window.LRGoals = { view, _compute: compute, _goalOf: goalOf };
})();
