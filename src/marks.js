(() => {
  const { clean, esc } = VXDom;
  const THEORY_EXAMS = [
    { key: "cati", title: "CAT - I", weight: 15 },
    { key: "catii", title: "CAT - II", weight: 15 },
    { key: "fat", title: "FAT", weight: 30 },
  ];
  const TARGETS = [90, 80, 70, 60, 50];
  const ABSOLUTE_BANDS = [
    ["S", 90],
    ["A", 80],
    ["B", 70],
    ["C", 60],
    ["D", 55],
    ["E", 50],
  ];

  let enabled = true;
  let view = null;

  const num = (s) => {
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  };
  const fmt = (n) => (Math.round(n * 100) / 100).toString();
  const pct = (n) => `${Math.round(n * 100)}%`;

  const itemKey = (title) =>
    title
      .toLowerCase()
      .replace(/continuous assessment test/g, "cat")
      .replace(/final assessment test/g, "fat")
      .replace(/[^a-z0-9]/g, "");

  function findTable() {
    for (const table of document.querySelectorAll("#b5-pagewrapper table, #page-wrapper table")) {
      if (table.closest(".vx-root") || table.parentElement.closest("table")) continue;
      const head = clean(table.rows[0]?.textContent).toLowerCase();
      if (head.includes("classnbr") && head.includes("course mode")) return table;
    }
    return null;
  }

  function parseCourses(table) {
    const courses = [];
    for (const tr of table.rows) {
      if (tr.parentElement.parentElement !== table) continue;
      const c = [...tr.cells].map((cell) => clean(cell.textContent));
      if (c.length >= 8 && /^[A-Z]{2}\d{10,}$/.test(c[1])) {
        courses.push({
          classId: c[1],
          code: c[2],
          name: c[3],
          type: c[4],
          faculty: c[6],
          slot: c[7],
          items: [],
        });
        continue;
      }
      const current = courses[courses.length - 1];
      const nested = tr.querySelector("table");
      if (!current || !nested) continue;
      for (const row of nested.rows) {
        const m = [...row.cells].map((cell) => clean(cell.textContent));
        if (m.length < 7 || !/^\d+$/.test(m[0]) || !/^[\d.]+$/.test(m[2])) continue;
        current.items.push({
          title: m[1],
          max: num(m[2]),
          weight: num(m[3]),
          status: m[4],
          scored: num(m[5]),
          weighted: num(m[6]),
          remark: m[7] ?? "",
        });
      }
    }
    return courses;
  }

  function analyse(course) {
    const isTheory = /theory/i.test(course.type);
    const evaluated = course.items.reduce((n, i) => n + i.weight, 0);
    const earned = course.items.reduce((n, i) => n + i.weighted, 0);
    const have = new Set(course.items.map((i) => itemKey(i.title)));
    const pending = isTheory ? THEORY_EXAMS.filter((e) => !have.has(e.key)) : [];
    const pendingWeight = pending.reduce((n, e) => n + e.weight, 0);
    const open = Math.max(0, 100 - evaluated);
    const rate = evaluated > 0 ? earned / evaluated : null;
    return {
      isTheory,
      evaluated,
      earned,
      lost: evaluated - earned,
      rate,
      open,
      pending,
      other: Math.max(0, open - pendingWeight),
      best: earned + open,
      atRate: rate === null ? null : earned + open * rate,
    };
  }

  function needed(a, target) {
    const gap = target - a.earned;
    if (gap <= 0) return 0;
    if (a.open <= 0 || gap > a.open) return null;
    return gap / a.open;
  }

  function scan() {
    if (view && !view.table.isConnected) {
      view.root.remove();
      view = null;
    }
    if (!enabled) return unmount();
    if (view) return;
    const table = findTable();
    if (!table || table.dataset.vx) return;
    table.dataset.vx = "1";
    try {
      mount(table);
    } catch (err) {
      console.error("[Better VTOP] could not redraw the marks page", err);
      unmount();
      table.dataset.vx = "failed";
    }
  }

  function mount(table) {
    const courses = parseCourses(table);
    if (!courses.length) return;
    const original = table.closest("#fixedTableContainer") ?? table;
    const root = document.createElement("div");
    root.className = "vx-root vx-marks";
    original.before(root);
    view = { table, original, root, courses, open: new Set(), showOriginal: false };
    root.addEventListener("click", onClick);
    render();
  }

  function unmount() {
    if (!view) return;
    view.original.classList.remove("vx-hidden");
    delete view.table.dataset.vx;
    view.root.remove();
    view = null;
  }

  function render() {
    const v = view;
    const rows = v.courses.map((course) => ({ course, a: analyse(course) }));
    const lost = rows.reduce((n, r) => n + r.a.lost, 0);
    const evaluated = rows.reduce((n, r) => n + r.a.evaluated, 0);
    const earned = rows.reduce((n, r) => n + r.a.earned, 0);

    v.original.classList.toggle("vx-hidden", !v.showOriginal);
    v.root.innerHTML = `
      <div class="vx-toolbar">
        <div class="vx-title"><span class="vx-badge">Better VTOP</span> Marks
          <span class="vx-muted">${v.courses.length} courses · ${fmt(earned)} of ${fmt(evaluated)} marks earned so far · ${fmt(lost)} lost</span>
        </div>
        <div class="vx-controls">
          <button type="button" class="vx-link" data-action="original">${v.showOriginal ? "Hide" : "Show"} VTOP's original table</button>
        </div>
      </div>
      <div class="vx-scroll">
        <table class="vx-table">
          <thead><tr>
            <th>Course</th><th>Evaluated</th><th>Earned</th><th>Lost</th><th>Score so far</th><th>Best possible</th><th>At this rate</th><th></th>
          </tr></thead>
          <tbody>${rows.map((r) => row(v, r)).join("")}</tbody>
        </table>
      </div>
      <div class="vx-footer">
        <span>Marks are out of 100 for each course. "Best possible" assumes full marks in everything still to come; "At this rate" assumes you keep scoring as you have so far.</span>
      </div>`;
  }

  function tone(rate) {
    if (rate === null) return "";
    return rate >= 0.8 ? "vx-good" : rate >= 0.6 ? "vx-warn" : "vx-bad";
  }

  function row(v, { course: c, a }) {
    const open = v.open.has(c.classId);
    const t = tone(a.rate);
    return `
      <tr class="vx-row ${open ? "vx-open" : ""}" data-action="toggle" data-id="${esc(c.classId)}" tabindex="0" aria-expanded="${open}">
        <td>
          <div class="vx-course"><strong>${esc(c.code)}</strong> ${esc(c.name)}</div>
          <div class="vx-sub">${esc([c.type, c.slot, c.faculty].filter(Boolean).join(" · "))}</div>
        </td>
        <td class="vx-num">${fmt(a.evaluated)}<span class="vx-muted"> / 100</span></td>
        <td class="vx-num"><strong>${fmt(a.earned)}</strong></td>
        <td class="vx-num ${a.lost > 0 ? "vx-bad" : "vx-good"}"><strong>${a.lost > 0 ? `-${fmt(a.lost)}` : "0"}</strong></td>
        <td>
          ${
            a.rate === null
              ? `<span class="vx-muted">Nothing evaluated</span>`
              : `<div class="vx-att ${t}"><strong>${pct(a.rate)}</strong><div class="vx-bar"><span style="width:${Math.min(100, a.rate * 100)}%"></span></div></div>`
          }
        </td>
        <td class="vx-num">${fmt(a.best)}</td>
        <td class="vx-num">${a.atRate === null ? "-" : fmt(a.atRate)}</td>
        <td class="vx-toggle" aria-hidden="true">${open ? "▾" : "▸"}</td>
      </tr>
      ${open ? `<tr class="vx-detail"><td colspan="8">${detail(c, a)}</td></tr>` : ""}`;
  }

  function detail(c, a) {
    const items = c.items
      .map((i) => {
        const lost = i.weight - i.weighted;
        const absent = /absent/i.test(i.status);
        return `<tr>
          <td>${esc(i.title)}${absent ? ` <span class="vx-bad">(absent)</span>` : ""}</td>
          <td class="vx-num">${fmt(i.scored)} / ${fmt(i.max)}</td>
          <td class="vx-num">${fmt(i.weight)}</td>
          <td class="vx-num">${fmt(i.weighted)}</td>
          <td class="vx-num ${lost > 0 ? "vx-bad" : "vx-good"}">${lost > 0 ? `-${fmt(lost)}` : "0"}</td>
          <td class="vx-num">${i.max ? pct(i.scored / i.max) : "-"}</td>
          <td>${esc(i.remark)}</td>
        </tr>`;
      })
      .join("");

    const coming = [
      ...a.pending.map((e) => `${e.title} (${e.weight})`),
      a.other > 0
        ? `${a.isTheory ? "other internals" : "remaining components"} (${fmt(a.other)})`
        : "",
    ].filter(Boolean);

    const targets = TARGETS.map((target) => {
      const share = needed(a, target);
      const text =
        share === 0
          ? "secured"
          : share === null
            ? "out of reach"
            : `need ${pct(share)} of what is left`;
      const cls =
        share === 0 ? "vx-good" : share === null ? "vx-bad" : share > 0.9 ? "vx-warn" : "";
      return `<li class="${cls}"><strong>${target}</strong><span>${text}</span></li>`;
    }).join("");

    const grade = a.isTheory
      ? ""
      : (() => {
          const reachable = ABSOLUTE_BANDS.find(([, floor]) => a.best >= floor);
          const secured = ABSOLUTE_BANDS.find(([, floor]) => a.earned >= floor);
          return `<p class="vx-sub">Graded on fixed bands (S 90, A 80, B 70, C 60, D 55, E 50). Best grade still possible: <strong>${reachable ? reachable[0] : "F"}</strong>${secured ? `. Already secured: <strong>${secured[0]}</strong>` : ""}.</p>`;
        })();

    return `
      <div class="vx-panel">
        <div class="vx-cols">
          <div>
            <h4>Evaluated so far</h4>
            ${
              items
                ? `<table class="vx-mini"><thead><tr><th>Component</th><th>Scored</th><th>Weightage</th><th>Earned</th><th>Lost</th><th>Score</th><th>Remark</th></tr></thead><tbody>${items}</tbody></table>`
                : `<p class="vx-muted">Nothing has been evaluated yet.</p>`
            }
          </div>
          <div>
            <h4>Still to come: ${fmt(a.open)} marks</h4>
            <p class="vx-sub">${coming.length ? esc(coming.join(" · ")) : "Everything has been evaluated."}</p>
            <h4>To finish the course on</h4>
            <ul class="vx-targets">${targets}</ul>
            ${grade}
            ${a.isTheory ? `<p class="vx-sub">Theory courses are graded relative to the class, so the letter grade depends on everyone's totals.</p>` : ""}
          </div>
        </div>
      </div>`;
  }

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || !view) return;
    if (el.dataset.action === "toggle") {
      const id = el.dataset.id;
      view.open.has(id) ? view.open.delete(id) : view.open.add(id);
    } else if (el.dataset.action === "original") {
      view.showOriginal = !view.showOriginal;
    }
    render();
  }

  VXDom.onPageChange(scan);
  VXDom.onSetting("marks", (on) => {
    enabled = on;
    scan();
  });
})();
