(() => {
  const E = VXEngine;

  const HEADINGS = {
    action: /action plan/i,
    courses: /current semester course registration/i,
    clubs: /clubs\s*(&|and)\s*chapters/i,
    spotlight: /spot\s*-?\s*light/i,
    proctor: /proctor message/i,
    cgpa: /cgpa and credit status/i,
    assignments: /forthcoming digital assignments/i,
    feedback: /last five feedback/i,
  };
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  let settings = {};

  let view = null;

  let wantOriginal = false;

  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const cellsOf = (row) => [...row.children].map((c) => clean(c.textContent));
  const rowsIn = (nodes) =>
    nodes.flatMap((n) => (n.tagName === "TR" ? [n] : [...n.querySelectorAll("tr")]));

  function looksLikeHome() {
    try {
      const xpath = `//text()[contains(normalize-space(translate(., '${UPPER.toLowerCase()}', '${UPPER}')), 'SEMESTER COURSE REGISTRATION')]`;
      const hit = document.evaluate(xpath, document.body, null, 9, null).singleNodeValue;
      return Boolean(hit && !hit.parentElement?.closest(".vx-root"));
    } catch {
      return /semester\s+course\s+registration/i.test(document.body.textContent);
    }
  }

  const depthOf = (el) => {
    let n = 0;
    for (let e = el; e.parentElement; e = e.parentElement) n++;
    return n;
  };

  function commonAncestor(elements) {
    let node = elements[0];
    while (node && !elements.every((e) => node.contains(e))) node = node.parentElement;
    return node ?? document.body;
  }

  function findHeadings() {
    const candidates = {};
    for (const el of document.body.querySelectorAll("*:not(script):not(style)")) {
      if (
        el.closest(".vx-root, nav, header, aside, [role='navigation'], .dropdown-menu, .offcanvas")
      )
        continue;
      const text = clean(el.textContent);
      if (!text || text.length > 90) continue;
      for (const [key, re] of Object.entries(HEADINGS)) {
        if (!re.test(text)) continue;

        candidates[key] = (candidates[key] ?? []).filter((c) => !c.contains(el));
        candidates[key].push(el);
      }
    }
    const anchor = candidates.courses?.[0];
    if (!anchor) return {};

    const found = { courses: anchor };
    const closeness = {};
    for (const [key, list] of Object.entries(candidates)) {
      if (key === "courses") continue;
      const scored = list.map((el) => [depthOf(commonAncestor([anchor, el])), el]);
      [closeness[key], found[key]] = scored.sort((x, y) => y[0] - x[0])[0];
    }

    const depths = Object.values(closeness);
    const shared = depths.filter((d) => depths.filter((x) => x === d).length > 1);
    const floor = shared.length ? Math.min(...shared) : Math.max(0, ...depths);
    for (const key of Object.keys(closeness)) {
      if (closeness[key] < floor) delete found[key];
    }
    return found;
  }

  function sectionNodes(key, heads, frame) {
    const others = Object.entries(heads)
      .filter(([k]) => k !== key)
      .map(([, el]) => el);
    const holdsAnother = (el) => others.some((o) => el.contains(o));

    let box = heads[key];
    while (box.parentElement && box.parentElement !== frame && !holdsAnother(box.parentElement)) {
      box = box.parentElement;
    }
    const nodes = [box];
    if (clean(box.textContent).length < clean(heads[key].textContent).length + 30) {
      for (
        let next = box.nextElementSibling;
        next && !holdsAnother(next);
        next = next.nextElementSibling
      ) {
        nodes.push(next);
      }
    }
    return nodes;
  }

  function textOf(nodes) {
    const parts = [];
    for (const node of nodes) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) parts.push(walker.currentNode.textContent);
    }
    return clean(parts.join(" "));
  }

  const COURSE_CODE = /[A-Z]{3,5}\d{3}[A-Z]?/;

  function parseCourses(nodes) {
    const list = [];
    for (const row of rowsIn(nodes)) {
      const c = cellsOf(row);
      const at = c.findIndex((x) => COURSE_CODE.test(x));
      const pctAt = c.findIndex((x, i) => i > at && /^\d{1,3}(\.\d+)?%?$/.test(x));
      if (at < 0 || pctAt < 0) continue;
      const found = c[at].match(COURSE_CODE);
      const code = found[0];
      const typed = pctAt - 1 > at && /^[A-Z]{1,4}$/.test(c[pctAt - 1]);
      const name = [
        c[at].slice(found.index + code.length),
        ...c.slice(at + 1, typed ? pctAt - 1 : pctAt),
      ]
        .join(" ")
        .replace(/^[\s-]+/, "");
      list.push({
        code,
        name: clean(name),
        type: typed ? c[pctAt - 1] : "",
        pct: parseFloat(c[pctAt]),
        remark: c[pctAt + 1] ?? "",
      });
    }
    return list.length ? list : parseCoursesFromText(textOf(nodes));
  }

  function parseCoursesFromText(text) {
    const entry =
      /\b([A-Z]{3,5}\d{3}[A-Z]?)\s*-\s*(.+?)\s+([A-Z]{2,4})\s+(\d{1,3}(?:\.\d+)?)\s+(.*?)(?=\s+\d+\s+[A-Z]{3,5}\d{3}[A-Z]?\s*-|$)/g;
    return [...text.matchAll(entry)].map((m) => ({
      code: m[1],
      name: m[2],
      type: m[3],
      pct: parseFloat(m[4]),
      remark: m[5],
    }));
  }

  function parseCgpa(nodes) {
    const text = textOf(nodes);
    const pick = (re) => text.match(re)?.[1];
    return {
      required: pick(/total credits required\s*:?\s*([\d.]+)/i),
      earned: pick(/earned credits\s*:?\s*([\d.]+)/i),
      cgpa: pick(/current cgpa\s*:?\s*([\d.]+)/i),
      nonGraded: pick(/non-?graded core requirement\s*:?\s*([\d.]+)/i),
      placement: pick(/placement eligibility\s*:?\s*(.+)$/i),
    };
  }

  function toISO(raw) {
    const m = clean(raw).match(/(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})/);
    if (!m) return null;
    const month = /^\d+$/.test(m[2])
      ? Number(m[2])
      : "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1;
    if (!Number.isInteger(month) || month < 1) return null;
    return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }

  function parseAssignments(nodes) {
    const list = [];
    for (const row of rowsIn(nodes)) {
      const c = cellsOf(row);
      if (c.length < 4 || !/^\d+$/.test(c[0])) continue;
      list.push({
        course: c[1],
        title: c[2],
        due: toISO(c[3]),
        dueText: c[3],
        uploaded: c[4] ?? "",

        link: row.querySelector("a, [onclick]"),
      });
    }
    return list.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }

  function scan() {
    if (view && !view.root.isConnected) view = null;
    const on = settings.home !== false && !wantOriginal;
    if (!on) return unmount();
    if (view) return refresh();
    if (!looksLikeHome()) return;
    try {
      mount();
    } catch (err) {
      console.error("[Better VTOP] could not redesign the home page", err);
      unmount();
      wantOriginal = true;
    }
  }

  let lastReport = "";
  function report(message) {
    if (message === lastReport) return;
    lastReport = message;
    console.info(`[Better VTOP] home page left as it is: ${message}`);
  }

  function mount() {
    const heads = findHeadings();
    const names = Object.keys(heads).join(", ") || "none";
    if (!heads.courses) return report(`course list heading not found (headings found: ${names})`);
    const frame = commonAncestor(Object.values(heads));
    if (frame === document.body || frame === heads.courses) {
      return report(`the page's sections could not be told apart (headings found: ${names})`);
    }
    const sections = {};
    for (const key of Object.keys(heads)) sections[key] = sectionNodes(key, heads, frame);
    if (!parseCourses(sections.courses).length) {
      return report(
        `no courses could be read (headings found: ${names}; course section starts: "${textOf(sections.courses).slice(0, 160)}")`,
      );
    }

    const root = document.createElement("div");
    root.className = "vx-root vx-home";
    root.innerHTML = `<div class="vx-home-main"></div><div class="vx-home-spot"></div><div class="vx-footer"></div>`;

    view = {
      root,
      sections,
      regNo:
        VXApi.pageRegNo() || document.body.textContent.match(/\b\d{2}[A-Z]{3}\d{4}\b/)?.[0] || "",
      data: null,
      drawn: "",
      snapshot: null,

      calc: "",
      hidden: [],
      moved: [],
      blanked: [],
    };

    const spot = root.querySelector(".vx-home-spot");
    for (const node of sections.spotlight ?? []) {
      const mark = document.createComment("vtop-plus");
      node.before(mark);
      spot.append(node);
      view.moved.push([node, mark]);
    }
    spot.classList.toggle("vx-hidden", !view.moved.length);
    for (const [key, nodes] of Object.entries(sections)) {
      if (key !== "spotlight") nodes.forEach(hide);
    }

    for (const node of [...view.hidden, ...view.moved.map(([, mark]) => mark)]) {
      for (
        let box = node.parentElement;
        box && box !== frame && isEmptied(box);
        box = box.parentElement
      ) {
        hide(box);
      }
    }

    for (const node of frame.parentElement?.childNodes ?? []) {
      if (node.nodeType === 3 && node.textContent.trim() && node.textContent.trim().length <= 2) {
        view.blanked.push([node, node.textContent]);
        node.textContent = "";
      }
    }

    const table = /^(TABLE|THEAD|TBODY|TR)$/.test(frame.tagName) ? frame.closest("table") : null;
    if (table) table.before(root);
    else frame.prepend(root);
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.querySelector(".vx-footer").innerHTML = `
      <span>Better VTOP hides the action plan, club events and feedback list here.</span>
      <button class="vx-link" data-action="original">Show VTOP's original home page</button>`;
    refresh();
    store(VXPlan.snapshotKey(view.regNo)).then((snap) => {
      if (!view || !snap) return;
      view.snapshot = snap;
      render();
    });
  }

  function hide(node) {
    if (node.classList.contains("vx-hidden")) return;
    node.classList.add("vx-hidden");
    view.hidden.push(node);
  }

  const isEmptied = (box) =>
    [...box.childNodes].every(
      (n) =>
        n.nodeType === 8 ||
        (n.nodeType === 3 && !n.textContent.trim()) ||
        (n.nodeType === 1 &&
          (n.classList.contains("vx-hidden") || /^(SCRIPT|STYLE|BR|LINK)$/.test(n.tagName))),
    );

  function unmount() {
    if (!view) return;
    for (const [node, mark] of view.moved) {
      if (mark.isConnected) mark.replaceWith(node);
    }
    for (const node of view.hidden) node.classList.remove("vx-hidden");
    for (const [node, text] of view.blanked) node.textContent = text;
    view.root.remove();
    view = null;
  }

  const store = async (key) => (await chrome.storage.local.get(key))[key];

  function refresh() {
    const v = view;
    const s = v.sections;
    const courseText = textOf(s.courses);
    v.data = {
      courses: parseCourses(s.courses),
      cgpa: s.cgpa ? parseCgpa(s.cgpa) : null,
      assignments: parseAssignments(s.assignments ?? []),
      proctor: s.proctor ? textOf(s.proctor).replace(HEADINGS.proctor, "").trim() : "",
      semester: courseText.match(/\b[A-Z]+SEM\s?\d{4}-\d{2}\b/)?.[0] ?? "",
    };
    VXSemester.remember(v.data.semester);
    const drawn = JSON.stringify(v.data, (key, value) => (key === "link" ? undefined : value));
    if (drawn === v.drawn) return;
    v.drawn = drawn;
    render();
  }

  function render() {
    const v = view;
    if (!v?.data) return;
    const d = v.data;
    const showCgpa = settings.homeCgpa !== false;
    v.root.querySelector(".vx-home-main").innerHTML = `
      ${toolbar(d, showCgpa)}
      ${proctor(d)}
      <div class="vx-home-grid">
        ${coursesCard(v)}
        <div class="vx-home-side">${assignmentsCard(d)}${showCgpa && d.cgpa ? cgpaCard(d.cgpa) : ""}</div>
      </div>`;
  }

  function toolbar(d, showCgpa) {
    return `
      <div class="vx-toolbar">
        <div class="vx-title">
          <span class="vx-badge">Better VTOP</span> Home
          <span class="vx-muted">${esc(d.semester)}</span>
        </div>
        <div class="vx-controls">
          ${d.cgpa ? `<label class="vx-check"><input type="checkbox" data-change="cgpa" ${showCgpa ? "checked" : ""}> Show CGPA</label>` : ""}
        </div>
      </div>`;
  }

  const tone = (c) =>
    /debar/i.test(c.remark) || c.pct < 75
      ? "vx-bad"
      : /cautious/i.test(c.remark) || c.pct < 76
        ? "vx-warn"
        : "vx-good";

  function proctor(d) {
    return d.proctor && d.proctor.length < 600
      ? `<div class="vx-notice"><strong>Proctor message:</strong> ${esc(d.proctor)}</div>`
      : "";
  }

  function coursesCard(v) {
    const snap = v.snapshot?.courses ?? {};
    const courses = v.data.courses;
    const planned = courses.some((c) => snap[c.code]);
    const rows = courses
      .map((c, i) => {
        const t = tone(c);
        const s = snap[c.code];
        const missTone = !s ? "" : !s.safe ? "vx-bad" : s.canMiss > 0 ? "vx-good" : "vx-warn";
        return `<tr>
          <td class="vx-num vx-muted">${i + 1}</td>
          <td><strong>${esc(c.code)}</strong> ${esc(c.name)}</td>
          <td class="vx-muted">${esc(c.type)}</td>
          <td>
            <div class="vx-att ${t}"><strong>${c.pct}%</strong><div class="vx-bar"><span style="width:${Math.min(100, c.pct)}%"></span><i></i></div></div>
          </td>
          ${
            planned
              ? `<td class="vx-num">${
                  s
                    ? `<strong class="${missTone}">${s.safe ? s.canMiss : "-"}</strong><span class="vx-muted"> / ${s.upcoming ?? "?"}</span> <span class="vx-sub">${esc(s.horizonLabel)}</span>`
                    : "-"
                }</td>`
              : ""
          }
          <td><span class="vx-pill ${t}">${esc(c.remark || "-")}</span></td>
        </tr>`;
      })
      .join("");

    const working = v.calc === "working";
    const note = working
      ? "Reading your attendance, timetable and calendar from VTOP…"
      : v.calc
        ? `<span class="vx-bad">${esc(v.calc)}</span>`
        : planned
          ? `Classes you can miss out of those left before the exam named · worked out ${esc(ago(v.snapshot.at))}.`
          : "See how many classes you can still miss before the next exam.";
    return `
      <section class="vx-card">
        <h3>Courses and attendance</h3>
        <div class="vx-scroll">
          <table class="vx-table">
            <thead><tr><th>#</th><th>Course</th><th>Type</th><th>Attendance</th>${planned ? "<th>Can miss / left</th>" : ""}<th>VTOP's remark</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="vx-calc">
          <button class="vx-btn" data-action="calculate" ${working ? "disabled" : ""}>${working ? "Calculating…" : planned ? "Recalculate can miss" : "Calculate can miss"}</button>
          <span class="vx-sub">${note}</span>
        </div>
      </section>`;
  }

  function ago(at) {
    const mins = Math.round((Date.now() - at) / 60_000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    return hours < 24
      ? `${plural(hours, "hour")} ago`
      : `${plural(Math.round(hours / 24), "day")} ago`;
  }

  function assignmentsCard(d) {
    const today = E.todayISO();
    const items = d.assignments
      .map((a, i) => {
        const left = a.due ? E.daysBetween(today, a.due) : null;
        const cls = left === null ? "" : left < 0 ? "vx-bad" : left <= 2 ? "vx-warn" : "vx-good";
        return `<li ${a.link ? `data-action="assignment" data-index="${i}" class="vx-clickable"` : ""}>
          <div class="vx-due ${cls}">
            <strong>${a.due ? esc(E.formatDate(a.due)) : esc(a.dueText || "-")}</strong>
            <span>${a.due ? esc(E.relativeDay(a.due, today)) : ""}</span>
          </div>
          <div class="vx-da">
            <div><strong>${esc(a.title)}</strong></div>
            <div class="vx-sub">${esc(a.course)}${a.uploaded ? ` · uploaded ${esc(a.uploaded)}` : ""}</div>
          </div>
        </li>`;
      })
      .join("");
    return `
      <section class="vx-card">
        <h3>Forthcoming digital assignments</h3>
        ${items ? `<ul class="vx-list vx-da-list">${items}</ul>` : `<p class="vx-empty">Nothing due.</p>`}
      </section>`;
  }

  function cgpaCard(g) {
    const earned = parseFloat(g.earned);
    const required = parseFloat(g.required);
    const share = required ? Math.min(100, (earned / required) * 100) : 0;
    const line = (label, value) =>
      value ? `<li><span>${label}</span><strong>${esc(value)}</strong></li>` : "";
    return `
      <section class="vx-card">
        <h3>CGPA and credits</h3>
        <div class="vx-cgpa"><strong>${esc(g.cgpa ?? "-")}</strong><span class="vx-sub">Current CGPA</span></div>
        <div class="vx-bar vx-credit"><span style="width:${share}%"></span></div>
        <ul class="vx-facts">
          ${line("Credits earned", g.earned && g.required ? `${g.earned} of ${g.required}` : g.earned)}
          ${line("Non-graded core requirement", g.nonGraded)}
          ${line("Placement", g.placement)}
        </ul>
      </section>`;
  }

  async function calculate() {
    const v = view;
    v.calc = "working";
    render();
    try {
      v.snapshot = await VXPlan.calculate(v.regNo);
      v.calc = "";
    } catch (err) {
      v.calc = `Could not calculate: ${err.message}`;
    }
    if (view === v) render();
  }

  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || !view) return;
    const { action, index } = el.dataset;
    if (action === "calculate") {
      calculate();
    } else if (action === "assignment") {
      view.data.assignments[index]?.link?.click();
    } else if (action === "original") {
      wantOriginal = true;
      const bar = document.createElement("div");
      view.root.before(bar);
      unmount();
      bar.className = "vx-root vx-back";
      bar.innerHTML = `<button class="vx-link">Switch back to the Better VTOP home page</button>`;
      bar.firstChild.addEventListener("click", () => {
        bar.remove();
        wantOriginal = false;
        scan();
      });
    }
  }

  function onChange(e) {
    if (e.target.dataset.change !== "cgpa") return;
    settings = { ...settings, homeCgpa: e.target.checked };
    chrome.storage.local.set({ settings });
    render();
  }

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
    if (area !== "local") return;
    const snap = view && changes[VXPlan.snapshotKey(view.regNo)];
    if (snap?.newValue) view.snapshot = snap.newValue;
    if (changes.settings) settings = changes.settings.newValue ?? {};
    if (changes.settings) scan();
    if (snap || changes.settings) render();
  });

  store("settings").then((s) => {
    settings = s ?? {};
    scan();
  });
})();
