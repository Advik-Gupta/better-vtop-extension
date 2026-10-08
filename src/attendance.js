(() => {
  const E = VXEngine;
  const TABLE = "#AttendanceDetailDataTable";
  const RISK_ORDER = { debarred: 0, danger: 1, warning: 2, safe: 3 };
  const STATUS_LABEL = { present: "Present", absent: "Absent", od: "On duty" };

  let enabled = true;

  let view = null;

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : word.endsWith("s") ? "es" : "s"}`;
  const longDate = (iso) => E.formatDate(iso, { weekday: "short", day: "numeric", month: "short" });

  const store = {
    async get(key, fallback) {
      return (await chrome.storage.local.get(key))[key] ?? fallback;
    },
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
  };
  const marksKey = (v) => VXPlan.marksKey(v.regNo, v.semesterId);

  function unmount() {
    if (!view) return;
    view.root.remove();
    view.original.classList.remove("vx-hidden");
    delete view.table.dataset.vx;
    view = null;
  }

  function scan() {
    if (view && !view.table.isConnected) {
      view.root.remove();
      view = null;
    }
    if (!enabled) return;
    const table = document.querySelector(TABLE);
    if (!table || table.dataset.vx) return;
    try {
      mount(table);
    } catch (err) {
      console.error("[Better VTOP] could not enhance the attendance page", err);
      unmount();
      table.dataset.vx = "failed";
    }
  }

  function mount(table) {
    const parsed = VXParse.attendanceSummary(table);
    if (!parsed.courses.length) return;
    unmount();
    table.dataset.vx = "1";

    const original =
      table.closest(".dataTables_wrapper") ?? table.closest(".table-responsive") ?? table;
    const root = document.createElement("div");
    root.className = "vx-root";
    original.after(root);

    view = {
      table,
      original,
      root,
      courses: parsed.courses,
      semesterId: parsed.semesterId || document.querySelector("#semesterSubId")?.value || "",
      regNo: parsed.regNo || VXApi.pageRegNo(),
      classGroup: parsed.courses[0].classGroup,
      records: null,
      timetable: [],
      calendar: [],
      marks: {},
      open: new Set(),
      horizon: null,
      sort: "vtop",
      showOriginal: false,
      loading: true,
      problem: null,
    };
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    render();
    load(view, false);
  }

  async function load(v, force) {
    v.loading = true;
    v.problem = null;
    render();
    v.marks = await store.get(marksKey(v), {});
    try {
      v.records = await VXApi.details(v);
    } catch (err) {
      v.problem = err.message;
    }
    if (view !== v) return;
    render();
    try {
      const s = await VXApi.schedule(v, force);
      v.timetable = s.timetable ?? [];
      v.calendar = s.calendar ?? [];
    } catch (err) {
      v.problem = err.message;
    }
    if (view !== v) return;
    if (v.records) {
      v.marks = VXPlan.prune(v.marks, v.records, v.courses);
      store.set(marksKey(v), v.marks);
    }
    v.loading = false;
    render();
  }

  const dataOf = (v) => ({
    courses: v.courses,
    records: v.records ?? {},
    timetable: v.timetable,
    calendar: v.calendar,
  });

  const isFull = (v) => Boolean(v.records && v.timetable.length && v.calendar.length);

  function horizonFor(v, data, course, today) {
    const own = E.horizonsFor(data, course);
    const picked = v.horizon && v.horizon > today ? own.find((h) => h.date >= v.horizon) : null;
    return picked ?? E.defaultHorizon(data, today, course);
  }

  function basicStats(course) {
    const { attended, total } = course;
    let canMiss = 0;
    while (canMiss < 400 && E.isSafe(attended, total + canMiss + 1)) canMiss++;
    let mustAttend = 0;
    while (mustAttend < 400 && !E.isSafe(attended + mustAttend, total + mustAttend)) mustAttend++;
    const safe = E.isSafe(attended, total);
    return {
      course,
      attended,
      total,
      pct: E.shownPct(attended, total),
      safe,
      canMiss,
      mustAttend,
      risk: course.debar ? "debarred" : !safe ? "danger" : canMiss <= 1 ? "warning" : "safe",
    };
  }

  function render() {
    const v = view;
    if (!v) return;
    const today = E.todayISO();
    const full = isFull(v);
    const data = dataOf(v);
    const look = full ? E.buildLookup(data) : null;

    let rows = v.courses.map((course) => {
      if (!full) return { course, basic: basicStats(course) };
      const horizon = horizonFor(v, data, course, today);
      const stats = E.courseStats(look, v.marks, course, today, horizon);
      return { course, stats, horizon, risk: E.riskOf(stats) };
    });
    for (const r of rows) r.risk ??= r.basic.risk;
    if (v.sort === "risk") {
      const pct = (r) => (r.stats ?? r.basic).pct;
      rows = [...rows].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || pct(a) - pct(b));
    }

    if (full && !v.loading) saveSnapshot(v, rows);

    v.original.classList.toggle("vx-hidden", !v.showOriginal);
    v.root.innerHTML = [
      toolbar(v, data, today, full),
      summary(v, rows, data, today, full),
      notice(v, full),
      table(v, rows, look, today, full),
      footer(v),
    ].join("");
  }

  function saveSnapshot(v, rows) {
    const stats = rows.map((r) => r.stats);
    const fingerprint = JSON.stringify(
      stats.map((s) => [s.course.code, s.canMiss, s.upcoming, s.safe, s.horizonLabel]),
    );
    if (fingerprint === v.snapshot || !v.regNo || v.horizon) return;
    v.snapshot = fingerprint;
    VXPlan.saveSnapshot(v.regNo, v.semesterId, stats);
  }

  function toolbar(v, data, today, full) {
    const exams = full ? E.horizonsFor(data).filter((h) => h.date > today) : [];
    const marked = Object.values(v.marks).reduce((n, d) => n + Object.keys(d).length, 0);
    return `
      <div class="vx-toolbar">
        <div class="vx-title">
          <span class="vx-badge">Better VTOP</span> Attendance planner
          <span class="vx-muted">${v.loading ? "Loading timetable, calendar and class records…" : ""}</span>
        </div>
        <div class="vx-controls">
          ${
            exams.length
              ? `<label>Plan up to
                  <select data-change="horizon">
                    <option value="">Next exam</option>
                    ${exams
                      .map(
                        (h) =>
                          `<option value="${h.date}" ${v.horizon === h.date ? "selected" : ""}>${esc(h.label)} (${esc(E.whenLabel(h))})</option>`,
                      )
                      .join("")}
                  </select>
                </label>`
              : ""
          }
          <label>Sort
            <select data-change="sort">
              <option value="vtop" ${v.sort === "vtop" ? "selected" : ""}>VTOP order</option>
              <option value="risk" ${v.sort === "risk" ? "selected" : ""}>Most at risk first</option>
            </select>
          </label>
          ${marked ? `<button class="vx-btn" data-action="clear-marks" title="Remove every plan and on-duty mark you added">Clear my ${plural(marked, "mark")}</button>` : ""}
          <button class="vx-btn" data-action="refresh" ${v.loading ? "disabled" : ""}>Refresh</button>
        </div>
      </div>`;
  }

  function summary(v, rows, data, today, full) {
    const attended = rows.reduce((n, r) => n + (r.stats ?? r.basic).attended, 0);
    const total = rows.reduce((n, r) => n + (r.stats ?? r.basic).total, 0);
    const count = (risk) => rows.filter((r) => r.risk === risk).length;
    const safe = count("safe") + count("warning");
    const debarred = count("debarred");
    const exam = full ? E.defaultHorizon(data, today) : null;
    const tightest = full
      ? rows
          .filter((r) => r.risk !== "debarred" && r.stats.safe && r.stats.upcoming > 0)
          .sort((a, b) => a.stats.canMiss - b.stats.canMiss)[0]
      : null;

    const tile = (value, label, tone = "") =>
      `<div class="vx-tile ${tone}"><div class="vx-tile-value">${value}</div><div class="vx-tile-label">${label}</div></div>`;
    return `
      <div class="vx-tiles">
        ${tile(`${total ? E.rawPct(attended, total).toFixed(1) : "-"}%`, `Overall · ${attended} of ${total} classes attended`)}
        ${tile(`${safe}<small> / ${rows.length}</small>`, "Courses on track for 75%", safe === rows.length ? "vx-good" : "")}
        ${tile(
          String(count("danger") + debarred),
          debarred ? `Need attention · ${debarred} debarred` : "Courses below what 75% needs",
          count("danger") + debarred ? "vx-bad" : "vx-good",
        )}
        ${
          exam
            ? tile(
                esc(exam.label),
                `${exam.inferred ? "Expected" : "Starts"} ${esc(E.whenLabel(exam))} · ${esc(E.relativeDay(exam.date, today))}${
                  tightest
                    ? ` · tightest: ${esc(tightest.course.code)} (can miss ${tightest.stats.canMiss})`
                    : ""
                }`,
              )
            : tile("-", v.loading ? "Next exam · loading" : "Next exam · calendar unavailable")
        }
      </div>`;
  }

  function notice(v, full) {
    if (v.loading || full) return "";
    return `<div class="vx-notice">
      ${esc(v.problem ?? "VTOP did not return the timetable or the academic calendar.")}
      Showing what the totals alone can tell. Planning exam by exam needs both.
      <button class="vx-link" data-action="refresh">Try again</button>
    </div>`;
  }

  function pctCell(s, course) {
    const raw = E.rawPct(s.attended, s.total);
    const tone = !s.safe ? "vx-bad" : !E.isSafe(s.attended, s.total) ? "vx-warn" : "vx-good";
    const changed = s.attended !== course.attended || s.total !== course.total;
    return `
      <td class="vx-num">
        ${s.attended} / ${s.total}
        ${changed ? `<div class="vx-sub">VTOP: ${course.attended} / ${course.total}</div>` : ""}
      </td>
      <td>
        <div class="vx-pct ${tone}">${s.pct}%<span class="vx-sub">${raw.toFixed(1)}% exact</span></div>
        <div class="vx-bar ${tone}"><span style="width:${Math.min(100, raw)}%"></span><i></i></div>
      </td>`;
  }

  function courseCell(c) {
    return `
      <td>
        <div class="vx-course"><strong>${esc(c.code)}</strong> ${esc(c.name)}</div>
        <div class="vx-sub">${[c.typeLabel, c.slot, c.venue, c.faculty].filter(Boolean).map(esc).join(" · ")}</div>
      </td>`;
  }

  function table(v, rows, look, today, full) {
    const head = full
      ? `<th>Course</th><th>Attended</th><th>Attendance</th><th>Classes left</th><th>Can miss</th><th>Outlook</th><th></th>`
      : `<th>Course</th><th>Attended</th><th>Attendance</th><th>Can miss</th><th>Outlook</th><th></th>`;
    const span = full ? 7 : 6;
    const body = rows
      .map((r) => {
        const c = r.course;
        const open = v.open.has(c.code);
        const toggle = `<td class="vx-toggle" aria-hidden="true">${open ? "▾" : "▸"}</td>`;
        const cellsHtml = full ? fullCells(r) : basicCells(r);
        return `
          <tr class="vx-row vx-${r.risk} ${open ? "vx-open" : ""}" data-action="toggle" data-code="${esc(c.code)}" tabindex="0" aria-expanded="${open}">
            ${courseCell(c)}${cellsHtml}${toggle}
          </tr>
          ${open ? `<tr class="vx-detail"><td colspan="${span}">${detail(v, r, look, today, full)}</td></tr>` : ""}`;
      })
      .join("");
    return `<div class="vx-scroll"><table class="vx-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const TONE = { debarred: "vx-bad", danger: "vx-bad", warning: "vx-warn", safe: "vx-good" };
  const RISK_LABEL = { debarred: "Debarred", danger: "At risk", warning: "Tight", safe: "Safe" };
  const pill = (risk) => `<span class="vx-pill ${TONE[risk]}">${RISK_LABEL[risk]}</span>`;

  function fullCells({ course, stats: s, risk }) {
    return `
      ${pctCell(s, course)}
      <td class="vx-num">${s.upcoming}<div class="vx-sub">before ${esc(s.horizonLabel)}</div></td>
      <td class="vx-num vx-big ${s.safe && s.canMiss > 0 ? "vx-good" : s.safe ? "vx-warn" : "vx-bad"}">
        ${s.safe ? s.canMiss : "-"}
        ${s.plannedAbsent ? `<div class="vx-sub">${s.plannedAbsent} already planned</div>` : ""}
      </td>
      <td>
        ${pill(risk)}
        <div class="vx-outlook">${course.debar ? `<span class="vx-bad">${esc(course.debar)}</span> · ` : ""}${esc(E.projection(s))}</div>
      </td>`;
  }

  function basicCells({ course, basic: b, risk }) {
    const text = b.safe
      ? b.canMiss
        ? `Can miss ${plural(b.canMiss, "more period")} and stay at 75%`
        : "Can't miss any and stay at 75%"
      : `Attend the next ${plural(b.mustAttend, "period")} to get back to 75%`;
    return `
      ${pctCell(b, course)}
      <td class="vx-num vx-big ${b.safe && b.canMiss ? "vx-good" : b.safe ? "vx-warn" : "vx-bad"}">${b.safe ? b.canMiss : "-"}</td>
      <td>
        ${pill(risk)}
        <div class="vx-outlook">${course.debar ? `<span class="vx-bad">${esc(course.debar)}</span> · ` : ""}${text}</div>
      </td>`;
  }

  function detail(v, r, look, today, full) {
    const c = r.course;
    const link = c.trigger
      ? `<button class="vx-link" data-action="vtop-detail" data-code="${esc(c.code)}">Open VTOP's own detail view</button>`
      : "";
    if (!full) {
      return `<div class="vx-panel">
        ${v.records ? recordedList(v, c, null) : `<p class="vx-muted">${v.loading ? "Loading class records…" : "Class records are unavailable."}</p>`}
        ${link}
      </div>`;
    }
    return `
      <div class="vx-panel">
        <p class="vx-sentence">${esc(E.outlookSentence(r.stats))}</p>
        <div class="vx-cols">
          <div>
            <h4>Exam by exam</h4>
            ${examTable(v, c, look, today)}
            <h4>Still to come before ${esc(r.horizon.label)}</h4>
            ${upcomingList(v, c, look, today, r.horizon)}
          </div>
          <div>
            ${awaitingList(v, c, look, today)}
            <h4>Recorded by VTOP</h4>
            ${recordedList(v, c, look)}
          </div>
        </div>
        ${link}
      </div>`;
  }

  function examTable(v, course, look, today) {
    const rows = E.examOutlook(look, v.marks, course, today)
      .map((x) => {
        let result;
        if (x.debarred) result = `<span class="vx-bad">Debarred</span>`;
        else if (x.past)
          result = x.total
            ? x.safe
              ? `<span class="vx-good">Was eligible</span>`
              : `<span class="vx-bad">Was below 75%</span>`
            : "-";
        else if (!x.safe) result = `<span class="vx-bad">Out of reach</span>`;
        else if (x.upcoming === 0) result = `<span class="vx-good">Safe, no classes left</span>`;
        else if (x.canMiss === 0)
          result = `<span class="vx-warn">Attend all ${x.upcoming} left</span>`;
        else result = `<span class="vx-good">Can miss ${x.canMiss} of ${x.upcoming} left</span>`;
        return `<tr>
          <td>${esc(x.label)}</td>
          <td>${esc(E.whenLabel(x))}</td>
          <td class="vx-num">${x.total ? `${x.pct}% <span class="vx-sub">(${x.attended}/${x.total})</span>` : "-"}</td>
          <td>${result}</td>
        </tr>`;
      })
      .join("");
    return `<table class="vx-mini"><thead><tr><th>Exam</th><th>Date</th><th>Attendance then</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function choices(course, date, current, options) {
    return `<span class="vx-seg">${options
      .map(
        ([status, label]) =>
          `<button class="${current === status ? "vx-on vx-on-" + status : ""}" data-action="mark" data-code="${esc(course.code)}" data-date="${date}" data-status="${status}" aria-pressed="${current === status}">${label}</button>`,
      )
      .join("")}</span>`;
  }

  const blockOf = (look, date, code) => E.blocksOn(look, date).find((b) => b.code === code);
  const isRecorded = (look, date, code) => Boolean(look.recorded.get(date)?.has(code));

  function upcomingList(v, course, look, today, horizon) {
    const items = [];
    for (const day of v.calendar) {
      if (day.date < today) continue;
      if (day.date >= horizon.date) break;
      const block = blockOf(look, day.date, course.code);
      if (!block || isRecorded(look, day.date, course.code)) continue;
      const mark = v.marks[day.date]?.[course.code] ?? null;
      items.push(`<li>
        <span class="vx-when">${esc(longDate(day.date))}${day.date === today ? " · today" : ""}</span>
        <span class="vx-sub">${esc(block.start)}-${esc(block.end)}${block.count > 1 ? ` · ${block.count} periods` : ""}</span>
        ${choices(course, day.date, mark, [
          ["absent", "Will miss"],
          ["od", "On duty"],
        ])}
      </li>`);
    }
    return items.length
      ? `<ul class="vx-list">${items.join("")}</ul>`
      : `<p class="vx-muted">No classes left before ${esc(horizon.label)}.</p>`;
  }

  function awaitingList(v, course, look, today) {
    const last = (v.records[course.code] ?? []).at(-1)?.date;
    if (!last) return "";
    const items = [];
    for (const day of v.calendar) {
      if (day.date <= last) continue;
      if (day.date >= today) break;
      const block = blockOf(look, day.date, course.code);
      if (!block || isRecorded(look, day.date, course.code)) continue;
      const mark = v.marks[day.date]?.[course.code] ?? null;
      items.push(`<li>
        <span class="vx-when">${esc(longDate(day.date))}</span>
        <span class="vx-sub">${esc(block.start)}-${esc(block.end)}</span>
        ${choices(course, day.date, mark, [
          ["present", "Present"],
          ["absent", "Absent"],
          ["od", "On duty"],
        ])}
      </li>`);
    }
    return items.length
      ? `<h4>Not on VTOP yet</h4>
         <ul class="vx-list">${items.join("")}</ul>
         <p class="vx-sub">Mark these to count them now; VTOP's record takes over once it is posted.</p>`
      : "";
  }

  function recordedList(v, course, look) {
    const byDate = new Map();
    for (const r of v.records[course.code] ?? []) {
      byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
    }
    if (!byDate.size) return `<p class="vx-muted">VTOP has not recorded any class yet.</p>`;
    const items = [...byDate.entries()].reverse().map(([date, recs]) => {
      const absent = recs.filter((r) => r.status === "absent").length;
      const status = absent ? "absent" : recs[0].status;
      const mark = v.marks[date]?.[course.code] ?? null;
      const label =
        absent && absent < recs.length
          ? `Absent ${absent} of ${recs.length}`
          : STATUS_LABEL[status];
      return `<li>
        <span class="vx-when">${esc(longDate(date))}</span>
        <span class="vx-sub">${esc(recs.map((r) => r.slot).join("+"))} · ${esc(recs[0].time)}</span>
        <span class="vx-status vx-is-${status}">${label}</span>
        ${look && absent ? choices(course, date, mark, [["od", "Count as on duty"]]) : ""}
      </li>`;
    });
    return `<ul class="vx-list vx-recorded">${items.join("")}</ul>`;
  }

  function footer(v) {
    return `<div class="vx-footer">
      <span>75% is checked when each exam starts. VTOP rounds up, so 74.1% counts as 75%. Your own marks stay on this device.</span>
      <button class="vx-link" data-action="original">${v.showOriginal ? "Hide" : "Show"} VTOP's original table</button>
    </div>`;
  }

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || !view) return;
    const v = view;
    const { action, code, date, status } = el.dataset;
    if (action === "toggle") {
      if (e.target.closest("select, button, a")) return;
      v.open.has(code) ? v.open.delete(code) : v.open.add(code);
    } else if (action === "mark") {
      const day = { ...v.marks[date] };
      if (day[code] === status) delete day[code];
      else day[code] = status;
      v.marks = { ...v.marks, [date]: day };
      if (!Object.keys(day).length) delete v.marks[date];
      store.set(marksKey(v), v.marks);
    } else if (action === "clear-marks") {
      v.marks = {};
      store.set(marksKey(v), v.marks);
    } else if (action === "refresh") {
      load(v, true);
      return;
    } else if (action === "original") {
      v.showOriginal = !v.showOriginal;
    } else if (action === "vtop-detail") {
      v.courses.find((c) => c.code === code)?.trigger?.click();
      return;
    }
    render();
  }

  function onChange(e) {
    const kind = e.target.dataset.change;
    if (!kind || !view) return;
    if (kind === "horizon") view.horizon = e.target.value || null;
    if (kind === "sort") view.sort = e.target.value;
    render();
  }

  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".vx-row")) {
      e.preventDefault();
      e.target.click();
    }
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    enabled = changes.settings.newValue?.attendance !== false;
    enabled ? scan() : unmount();
  });

  store.get("settings", {}).then((s) => {
    enabled = s.attendance !== false;
    scan();
  });
})();
