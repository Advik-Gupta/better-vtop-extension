(() => {
  const { clean, esc } = VXDom;
  const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const isTime = (s) => /^\d{1,2}:\d{2}$/.test(s ?? "");

  let enabled = true;

  let view = null;

  const parts = (cell) => {
    const list = [...cell.querySelectorAll("p, span, strong")]
      .map((e) => clean(e.textContent))
      .filter(Boolean);
    return list.length ? list : [clean(cell.textContent)];
  };
  const strip = (s) => clean((s ?? "").replace(/\s*-\s*$/, ""));

  function parseCourses(table) {
    const list = [];
    for (const tr of table.rows) {
      const c = [...tr.cells];
      if (c.length < 12 || !/^\d+$/.test(clean(c[0].textContent))) continue;
      const [title, type = ""] = parts(c[2]);
      const m = title.match(/^([A-Z]{3,5}\d{3}[A-Z]?)\s*-\s*(.*)$/);
      if (!m) continue;
      const [l, t, p, j, credits] = clean(c[3].textContent).split(" ").map(Number);
      const [slot, venue = ""] = parts(c[7]);
      const [faculty, school = ""] = parts(c[8]);
      list.push({
        code: m[1],
        name: m[2],
        type: type.replace(/^\(\s*|\s*\)$/g, ""),
        hours: { l, t, p, j },
        credits,
        category: clean(c[4].textContent),
        option: clean(c[5].textContent),
        classId: clean(c[6].textContent),
        slot: strip(slot),
        venue: strip(venue),
        faculty: strip(faculty),
        school: strip(school),
        status: clean(c[11].textContent),
      });
    }
    return list;
  }

  function scan() {
    if (view && !view.root.isConnected) view = null;
    if (!enabled) return unmount();
    const grid = document.querySelector("#timeTableStyle");

    const list = [...document.querySelectorAll("#studentDetailsList table")].find(
      (t) => !t.closest(".vx-root"),
    );
    if (view || !grid || !list || list.dataset.vx) return;
    list.dataset.vx = "1";
    try {
      mount(list, grid);
    } catch (err) {
      console.error("[Better VTOP] could not redraw the timetable", err);
      unmount();
      list.dataset.vx = "failed";
    }
  }

  function mount(list, grid) {
    const courses = parseCourses(list);
    const times = { theory: { start: [], end: [] }, lab: { start: [], end: [] } };
    const classes = VXParse.timetable(grid.parentElement, times);
    if (!courses.length) return;

    const listBox = list.closest(".table-responsive") ?? list;
    const gridBox = grid.closest("#ttview") ?? grid;
    const root = document.createElement("div");
    root.className = "vx-root vx-tt";
    view = {
      root,
      list,
      hidden: [listBox, gridBox],
      courses,
      classes,
      times,
      note: "",
      showOriginal: false,
    };
    listBox.before(root);
    root.addEventListener("click", onClick);
    render();
  }

  function unmount() {
    if (!view) return;
    for (const box of view.hidden) box.classList.remove("vx-hidden");
    delete view.list.dataset.vx;
    view.root.remove();
    view = null;
  }

  function render() {
    const v = view;
    for (const box of v.hidden) box.classList.toggle("vx-hidden", !v.showOriginal);
    const credits = v.courses.reduce((n, c) => n + (c.credits || 0), 0);
    v.root.innerHTML = `
      <div class="vx-toolbar">
        <div class="vx-title"><span class="vx-badge">Better VTOP</span> Timetable
          <span class="vx-muted">${v.courses.length} courses · ${credits} credits</span>
        </div>
        <div class="vx-controls">
          <button class="vx-link" data-action="original">${v.showOriginal ? "Hide" : "Show"} VTOP's original tables</button>
        </div>
      </div>
      ${v.classes.length ? week(v) : ""}
      ${coursesCard(v)}`;
  }

  function week(v) {
    const byCode = new Map(v.courses.map((c) => [c.code, c]));
    const columns = v.classes.map((c) => c.column);
    const first = Math.min(...columns);
    const last = Math.max(...columns);
    const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5 || v.classes.some((c) => c.day === d));
    const today = new Date().getDay() || 7;

    let head = "<th></th>";
    for (let i = first; i <= last; i++) {
      const start = isTime(v.times.theory.start[i])
        ? v.times.theory.start[i]
        : v.times.lab.start[i];
      head += `<th>${isTime(start) ? esc(start) : esc(clean(v.times.theory.start[i]) || "")}</th>`;
    }

    const body = days
      .map((day) => {
        let cells = "";
        for (let i = first; i <= last; i++) {
          const here = v.classes.find((c) => c.day === day && c.column === i);
          if (!here) {
            cells += "<td></td>";
            continue;
          }

          let end = i;
          let slots = [here.slot];
          let until = here.end;
          for (
            let next;
            (next = v.classes.find(
              (c) =>
                c.day === day &&
                c.column === end + 1 &&
                c.code === here.code &&
                c.kind === here.kind,
            ));
          ) {
            end += 1;
            slots.push(next.slot);
            until = next.end;
          }
          const course = byCode.get(here.code);
          cells += `<td colspan="${end - i + 1}">
            <div class="vx-class vx-class-${here.kind}" title="${esc(course?.faculty ?? "")}">
              <strong>${esc(here.code)}</strong>
              <span class="vx-class-name">${esc(course?.name ?? "")}</span>
              <span class="vx-sub">${esc(here.start)}-${esc(until)} · ${esc(here.venue)} · ${esc(slots.join("+"))}</span>
            </div>
          </td>`;
          i = end;
        }
        return `<tr class="${day === today ? "vx-today" : ""}"><th>${DAY_NAMES[day]}</th>${cells}</tr>`;
      })
      .join("");

    return `
      <section class="vx-card">
        <h3>Your week <span class="vx-key"><i class="vx-class-theory"></i> Theory <i class="vx-class-lab"></i> Lab</span></h3>
        <div class="vx-scroll"><table class="vx-week"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      </section>`;
  }

  function hoursText({ l, t, p, j }) {
    const bits = [
      l ? `${l} lecture` : "",
      t ? `${t} tutorial` : "",
      p ? `${p} practical` : "",
      j ? `${j} project` : "",
    ].filter(Boolean);
    return bits.length ? `${bits.join(" + ")} hrs a week` : "No class hours";
  }

  function coursesCard(v) {
    const rows = v.courses
      .map((c, i) => {
        const canContact = Boolean(c.faculty && VXFaculty.searchTerm(c.faculty));
        const ok = /approved/i.test(c.status);
        return `<tr>
          <td class="vx-num vx-muted">${i + 1}</td>
          <td>
            <div><strong>${esc(c.code)}</strong> ${esc(c.name)}</div>
            <div class="vx-sub">${esc([c.type, c.category, c.option !== "Regular" ? c.option : ""].filter(Boolean).join(" · "))}</div>
          </td>
          <td class="vx-num">
            <strong>${c.credits}</strong> <span class="vx-muted">credit${c.credits === 1 ? "" : "s"}</span>
            <div class="vx-sub">${hoursText(c.hours)}</div>
          </td>
          <td>
            <div><strong>${esc(c.slot)}</strong></div>
            <div class="vx-sub">${esc(c.venue)}</div>
          </td>
          <td>
            <div class="vx-teacher">
              <div>
                <div>${esc(c.faculty)}</div>
                <div class="vx-sub">${esc(c.school)}</div>
              </div>
              ${canContact ? `<button class="vx-btn" data-action="contact" data-index="${i}" title="Open ${esc(c.faculty)} in Faculty Info">Contact</button>` : ""}
            </div>
          </td>
          <td><span class="vx-pill ${ok ? "vx-good" : "vx-warn"}">${esc(ok ? "Approved" : c.status)}</span></td>
        </tr>`;
      })
      .join("");
    return `
      <section class="vx-card">
        <h3>Registered courses</h3>
        <div class="vx-scroll">
          <table class="vx-table">
            <thead><tr><th>#</th><th>Course</th><th>Credits</th><th>Slot / venue</th><th>Faculty</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${view.note ? `<p class="vx-sub vx-bad">${esc(view.note)}</p>` : ""}
      </section>`;
  }

  async function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || !view) return;
    if (el.dataset.action === "original") {
      view.showOriginal = !view.showOriginal;
      render();
    } else if (el.dataset.action === "contact") {
      const v = view;
      el.disabled = true;
      el.textContent = "Opening…";
      const problem = await VXFaculty.open(v.courses[el.dataset.index].faculty);

      if (problem && view === v) {
        v.note = problem;
        render();
      }
    }
  }

  VXDom.onPageChange(scan);
  VXDom.onSetting("timetable", (on) => {
    enabled = on;
    scan();
  });
})();
