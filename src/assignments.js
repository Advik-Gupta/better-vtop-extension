(() => {
  const E = VXEngine;
  const { clean, esc } = VXDom;

  const SOON_DAYS = 3;
  const EDGES = ["vx-edge-bad", "vx-edge-warn", "vx-edge-good"];

  let enabled = true;

  let view = null;

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function findTable() {
    for (const table of document.querySelectorAll("#b5-pagewrapper table, #page-wrapper table")) {
      if (table.closest(".vx-root")) continue;
      const head = clean(table.rows[0]?.textContent).toLowerCase();
      if (head.includes("class nbr") && head.includes("dashboard")) return table;
    }
    return null;
  }

  function parseCourses(table) {
    const list = [];
    for (const tr of table.rows) {
      const classId = clean(tr.cells[1]?.textContent);
      if (tr.cells.length < 6 || !/^[A-Z]{2}\d{10,}$/.test(classId)) continue;
      list.push({ classId, tr, order: list.length, items: null, open: false });
    }
    return list;
  }

  function urgency(due, today) {
    const days = E.daysBetween(today, due);
    return { days, tone: days <= 0 ? "vx-bad" : days <= SOON_DAYS ? "vx-warn" : "vx-good" };
  }

  function standing(course, today) {
    const items = course.items ?? [];
    const open = items.filter((a) => !a.submitted);
    const upcoming = open
      .filter((a) => a.due && a.due >= today)
      .sort((a, b) => a.due.localeCompare(b.due));
    return {
      total: items.length,
      submitted: items.length - open.length,
      next: upcoming[0] ?? null,
      upcoming: upcoming.length,
      missed: open.filter((a) => a.due && a.due < today).length,
      undated: open.filter((a) => !a.due).length,
    };
  }

  function scan() {
    if (view && !view.table.isConnected) {
      view.bar.remove();
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
      console.error("[Better VTOP] could not add due dates to the assignment page", err);
      unmount();
      table.dataset.vx = "failed";
    }
  }

  function mount(table) {
    const courses = parseCourses(table);
    if (!courses.length) return;
    const bar = document.createElement("div");
    bar.className = "vx-root vx-da-bar";
    (table.closest("#fixedTableContainer") ?? table).before(bar);
    view = { table, bar, courses, sort: "due", loading: true, problem: "" };

    table.classList.add("vx-da-table");

    const header = table.rows[0];
    for (const label of ["Next due", "Handed in"]) {
      const cell = document.createElement(header.cells[0].tagName);
      cell.className = "vx-added";
      cell.textContent = label;
      header.lastElementChild.before(cell);
    }
    for (const c of courses) {
      c.due = c.tr.insertCell(c.tr.cells.length - 1);
      c.done = c.tr.insertCell(c.tr.cells.length - 1);
      c.due.className = "vx-added vx-due-cell";
      c.done.className = "vx-added vx-done-cell";
      c.due.addEventListener("click", () => {
        if (!c.items?.length) return;
        c.open = !c.open;
        render();
      });
    }
    bar.addEventListener("click", onClick);
    bar.addEventListener("change", onChange);
    render();
    load(view);
  }

  function unmount() {
    if (!view) return;
    const { table, bar, courses } = view;
    table.querySelectorAll(".vx-added").forEach((el) => el.remove());
    table.classList.remove("vx-da-table");
    for (const c of [...courses].sort((a, b) => a.order - b.order)) {
      c.tr.classList.remove(...EDGES);
      c.tr.parentElement?.append(c.tr);
    }
    delete table.dataset.vx;
    bar.remove();
    view = null;
  }

  async function load(v) {
    v.loading = true;
    v.problem = "";
    render();
    try {
      const lists = await VXApi.assignments(
        VXApi.pageRegNo(),
        v.courses.map((c) => c.classId),
      );
      v.courses.forEach((c, i) => (c.items = lists[i]));
    } catch (err) {
      v.problem = err.message;
    }
    v.loading = false;
    if (view === v) render();
  }

  function render() {
    const v = view;
    if (!v) return;
    const today = E.todayISO();
    const rows = v.courses.map((course) => ({ course, s: standing(course, today) }));
    const pending = rows.reduce((n, r) => n + r.s.upcoming, 0);
    const soonest = rows
      .map((r) => r.s.next)
      .filter(Boolean)
      .sort((a, b) => a.due.localeCompare(b.due))[0];

    v.bar.innerHTML = `
      <div class="vx-toolbar">
        <div class="vx-title"><span class="vx-badge">Better VTOP</span> Due dates
          <span class="vx-muted">${
            v.loading
              ? "Reading every course's due dates…"
              : v.problem
                ? `<span class="vx-bad">Could not read them: ${esc(v.problem)}</span>`
                : pending
                  ? `${plural(pending, "assignment")} to hand in · next ${esc(E.relativeDay(soonest.due, today))}`
                  : "Nothing to hand in"
          }</span>
        </div>
        <div class="vx-controls">
          <span class="vx-legend"><b class="vx-bad">Red</b> today · <b class="vx-warn">amber</b> within ${SOON_DAYS} days · <b class="vx-good">green</b> later</span>
          <label>Sort
            <select data-change="sort">
              <option value="due" ${v.sort === "due" ? "selected" : ""}>Due soonest first</option>
              <option value="vtop" ${v.sort === "vtop" ? "selected" : ""}>VTOP order</option>
            </select>
          </label>
          <button type="button" class="vx-btn" data-action="refresh" ${v.loading ? "disabled" : ""}>Refresh</button>
        </div>
      </div>`;

    const ordered =
      v.sort === "due"
        ? [...rows].sort(
            (a, b) =>
              (a.s.next?.due ?? "9999").localeCompare(b.s.next?.due ?? "9999") ||
              a.course.order - b.course.order,
          )
        : rows;
    v.table.querySelectorAll("tr.vx-detail").forEach((tr) => tr.remove());
    for (const { course: c, s } of ordered) {
      const u = s.next ? urgency(s.next.due, today) : null;
      c.tr.classList.remove(...EDGES);
      if (u) c.tr.classList.add(u.tone.replace("vx-", "vx-edge-"));
      c.due.innerHTML = `<div class="vx-root vx-cell">${dueCell(v, c, s, u, today)}</div>`;
      c.done.innerHTML = `<div class="vx-root vx-cell">${doneCell(c, s)}</div>`;
      c.due.classList.toggle("vx-clickable", Boolean(c.items?.length));
      c.due.title = c.items?.length ? "Show every assignment of this course" : "";
      c.tr.parentElement.append(c.tr);
      if (c.open && c.items?.length) {
        const extra = c.tr.parentElement.insertRow();
        extra.className = "vx-detail vx-added";
        const cell = extra.insertCell();
        cell.colSpan = c.tr.cells.length;
        cell.innerHTML = `<div class="vx-root vx-cell">${detail(c, today)}</div>`;
      }
    }
  }

  function dueCell(v, c, s, u, today) {
    if (c.items === null) return `<span class="vx-muted">${v.loading ? "Loading…" : "-"}</span>`;
    if (s.next) {
      return `
        <div class="vx-due-chip ${u.tone}">
          <strong>${esc(E.formatDate(s.next.due, { weekday: "short", day: "numeric", month: "short" }))}</strong>
          <span>${esc(E.relativeDay(s.next.due, today))}</span>
        </div>
        <div class="vx-sub">${esc(s.next.title)}${s.upcoming > 1 ? ` · ${s.upcoming - 1} more after it` : ""} ${c.open ? "▾" : "▸"}</div>`;
    }
    if (!s.total) return `<span class="vx-muted">No assignments set</span>`;
    const text =
      s.submitted === s.total
        ? `<span class="vx-good">All handed in</span>`
        : `<span class="vx-muted">Nothing coming up</span>`;
    return `${text} <span class="vx-sub">${c.open ? "▾" : "▸"}</span>`;
  }

  function doneCell(c, s) {
    if (c.items === null || !s.total) return "-";
    const past = [
      s.missed ? `${s.missed} past its due date` : "",
      s.undated ? `${s.undated} without a date` : "",
    ].filter(Boolean);
    return `${s.submitted} / ${s.total}${past.length ? `<div class="vx-sub">${past.join(" · ")}</div>` : ""}`;
  }

  function detail(c, today) {
    const rows = [...c.items]
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
      .map((a) => {
        let status;
        if (a.submitted)
          status = `<span class="vx-good">Handed in</span> <span class="vx-sub">${esc(a.submittedOn)}</span>`;
        else if (!a.due) status = `<span class="vx-muted">No due date</span>`;
        else if (a.due < today)
          status = `<span class="vx-muted">Due date passed, not handed in</span>`;
        else {
          const u = urgency(a.due, today);
          status = `<span class="${u.tone}">Due ${esc(E.relativeDay(a.due, today))}</span>`;
        }
        return `<tr>
          <td>${esc(a.title)}</td>
          <td class="vx-num">${a.due ? esc(E.formatDate(a.due, { weekday: "short", day: "numeric", month: "short", year: "numeric" })) : esc(a.dueText || "-")}</td>
          <td class="vx-num">${esc(a.maxMark || "-")}</td>
          <td class="vx-num">${a.weightage ? `${esc(a.weightage)}%` : "-"}</td>
          <td>${status}</td>
        </tr>`;
      })
      .join("");
    return `<table class="vx-mini"><thead><tr><th>Assignment</th><th>Due</th><th>Max mark</th><th>Weightage</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function onClick(e) {
    if (e.target.closest("[data-action='refresh']") && view) load(view);
  }

  function onChange(e) {
    if (e.target.dataset.change !== "sort" || !view) return;
    view.sort = e.target.value;
    render();
  }

  VXDom.onPageChange(scan);
  VXDom.onSetting("assignments", (on) => {
    enabled = on;
    scan();
  });
})();
