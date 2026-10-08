const VXFaculty = (() => {
  const { clean, esc, waitFor } = VXDom;
  const MENU = 'a[data-url="hrms/employeeSearchForStudent"]';
  const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  const AUTO_LOAD_LIMIT = 24;

  let enabled = true;
  let results = null;

  const sameName = (s) =>
    clean(s)
      .toUpperCase()
      .replace(/\b(DR|PROF|MR|MRS|MS)\b\.?/g, "")
      .replace(/[^A-Z ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  function searchTerm(name) {
    const words = sameName(name).split(" ");
    const full = words.filter((w) => w.length >= 3).slice(0, 2);
    const term = (full.length ? full : words.slice(0, 2)).join(" ").toLowerCase();
    return term.length >= 3 ? term : "";
  }

  const isProfile = (t) =>
    /name of the faculty/i.test(t.textContent) && /designation/i.test(t.rows[1]?.textContent ?? "");

  const profileTable = (root = document) =>
    [...root.querySelectorAll("table")].find((t) => !t.closest(".vx-root") && isProfile(t));

  function resultsTable() {
    return [...document.querySelectorAll("#main-section table")].find((t) => {
      if (t.closest(".vx-root") || isProfile(t)) return false;
      const head = clean(t.rows[0]?.textContent).toLowerCase();
      return (
        head.includes("name of the faculty") && head.includes("designation") && t.rows.length > 1
      );
    });
  }

  function resultRows(table = resultsTable()) {
    const rows = [];
    for (const tr of table?.rows ?? []) {
      const button = tr.querySelector("button, a[onclick], input[type='button']");
      if (!button || tr.cells.length < 3) continue;
      rows.push({
        name: clean(tr.cells[0].textContent),
        designation: clean(tr.cells[1].textContent),
        school: clean(tr.cells[2].textContent),
        empId: (button.getAttribute("onclick") ?? "").match(/\(\s*['"]?([\w-]+)/)?.[1] ?? "",
        button,
      });
    }
    return rows;
  }

  async function open(name) {
    const term = searchTerm(name);
    const link = document.querySelector(MENU);
    if (!term || !link) return "VTOP's Faculty Info page could not be opened.";

    link.click();
    const box = await waitFor(() => document.querySelector("#searchEmployee"));
    if (!box) return "VTOP's Faculty Info page did not load.";
    box.value = term;
    box.form.requestSubmit();

    const found = await waitFor(() =>
      profileTable() ? "profile" : resultsTable() ? "list" : null,
    );
    if (found === "profile") return "";
    if (!found) return `VTOP found nobody for "${term}".`;

    const rows = resultRows();
    if (rows.length !== 1) return "";
    rows[0].button.click();
    await waitFor(() => profileTable());
    return "";
  }

  function readProfile(table) {
    const facts = {};
    for (const tr of table.rows) {
      const label = clean(tr.cells[0]?.textContent).toLowerCase();
      const value = clean(tr.cells[1]?.textContent);
      if (/name of the faculty/.test(label)) facts.name = value;
      else if (/designation/.test(label)) facts.designation = value;
      else if (/department/.test(label)) facts.department = value;
      else if (/school/.test(label)) facts.school = value;
      else if (/mail/.test(label)) facts.email = value;
      else if (/cabin/.test(label)) facts.cabin = value;
    }
    const src = table.querySelector("img")?.getAttribute("src") ?? "";
    const holder = table.closest(".table-responsive") ?? table.parentElement;
    const hours = [];
    for (const tr of holder.querySelectorAll("table tr")) {
      const day = clean(tr.cells[0]?.textContent).toUpperCase();
      if (DAYS.includes(day) && tr.cells[1]) hours.push([day, clean(tr.cells[1].textContent)]);
    }
    hours.sort((a, b) => DAYS.indexOf(a[0]) - DAYS.indexOf(b[0]));
    return { facts, photo: /^data:image|^https?:/.test(src) ? src : "", hours, holder };
  }

  function scan() {
    if (results && !results.table.isConnected) {
      results.root.remove();
      results = null;
    }
    if (!enabled) return;
    const profile = profileTable(document.querySelector("#main-section") ?? document);
    if (profile && !profile.dataset.vx) {
      profile.dataset.vx = "1";
      guard(() => drawProfile(profile), profile);
    }
    const list = resultsTable();
    if (list && !list.dataset.vx) {
      list.dataset.vx = "1";
      guard(() => drawResults(list), list);
    }
  }

  function guard(task, table) {
    try {
      task();
    } catch (err) {
      console.error("[Better VTOP] could not redraw the faculty page", err);
      document.querySelectorAll(".vx-faculty").forEach((el) => el.remove());
      (table.closest(".table-responsive") ?? table).classList.remove("vx-hidden");
    }
  }

  function drawProfile(table) {
    const { facts, photo, hours, holder } = readProfile(table);
    if (!facts.name) return;
    const today = DAYS[(new Date().getDay() + 6) % 7];
    const fact = (label, value) =>
      value ? `<li><span>${label}</span><strong>${esc(value)}</strong></li>` : "";

    const root = document.createElement("div");
    root.className = "vx-root vx-faculty";
    root.innerHTML = `
      <section class="vx-card vx-person">
        ${photo ? `<img src="${esc(photo)}" alt="">` : ""}
        <div class="vx-person-main">
          <h3>${esc(facts.name)}</h3>
          <div class="vx-muted">${esc([facts.designation, facts.department].filter(Boolean).join(" · "))}</div>
          <ul class="vx-facts">
            ${fact("School / centre", facts.school)}
            ${fact("Cabin", facts.cabin)}
            ${fact("E-mail", facts.email)}
          </ul>
          ${
            facts.email
              ? `<div class="vx-person-actions">
                  <a class="vx-btn vx-primary" href="mailto:${esc(facts.email)}">Write an e-mail</a>
                  <button type="button" class="vx-btn" data-copy="${esc(facts.email)}">Copy address</button>
                </div>`
              : ""
          }
        </div>
        <div class="vx-hours">
          <h4>Open hours</h4>
          ${
            hours.length
              ? `<table class="vx-mini"><tbody>${hours
                  .map(
                    ([day, time]) =>
                      `<tr class="${day === today ? "vx-today" : ""}"><td>${day[0]}${day.slice(1).toLowerCase()}${day === today ? " · today" : ""}</td><td>${esc(time)}</td></tr>`,
                  )
                  .join("")}</tbody></table>`
              : `<p class="vx-muted">None listed.</p>`
          }
        </div>
      </section>
      <div class="vx-footer"><span></span><button type="button" class="vx-link" data-original>Show VTOP's original view</button></div>`;

    root.addEventListener("click", (e) => {
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        navigator.clipboard?.writeText(copy.dataset.copy);
        copy.textContent = "Copied";
      } else if (e.target.closest("[data-original]")) {
        const hidden = holder.classList.toggle("vx-hidden");
        e.target.textContent = `${hidden ? "Show" : "Hide"} VTOP's original view`;
      }
    });
    holder.classList.add("vx-hidden");
    holder.before(root);
  }

  function drawResults(table) {
    const people = resultRows(table);
    if (!people.length) return;
    const holder = table.closest(".table-responsive") ?? table;
    const root = document.createElement("div");
    root.className = "vx-root vx-faculty";
    root.innerHTML = `
      <div class="vx-toolbar">
        <div class="vx-title"><span class="vx-badge">Better VTOP</span> ${people.length} ${people.length === 1 ? "teacher" : "teachers"} found
          <span class="vx-muted" data-status></span>
        </div>
        <div class="vx-controls">
          <button type="button" class="vx-link" data-original>Show VTOP's original list</button>
        </div>
      </div>
      <div class="vx-people"></div>`;
    const grid = root.querySelector(".vx-people");
    people.forEach((p, i) => {
      p.state = p.empId ? (i < AUTO_LOAD_LIMIT ? "waiting" : "idle") : "none";
      p.el = document.createElement("article");
      p.el.className = "vx-card vx-result";
      grid.append(p.el);
      paint(p);
    });

    const view = { table, root, people };
    results = view;
    root.addEventListener("click", (e) => {
      const card = e.target.closest(".vx-result");
      const person = people.find((p) => p.el === card);
      if (e.target.closest("[data-original]")) {
        const hidden = holder.classList.toggle("vx-hidden");
        e.target.textContent = `${hidden ? "Show" : "Hide"} VTOP's original list`;
      } else if (e.target.closest("[data-copy]")) {
        navigator.clipboard?.writeText(e.target.closest("[data-copy]").dataset.copy);
        e.target.closest("[data-copy]").textContent = "Copied";
      } else if (e.target.closest("[data-load]") && person) {
        load(view, [person]);
      } else if (e.target.closest("[data-open]") && person) {
        VXDom.whenSettled(() => person.button.click());
      }
    });
    holder.classList.add("vx-hidden");
    holder.before(root);
    load(
      view,
      people.filter((p) => p.state === "waiting"),
    );
  }

  async function load(view, people) {
    const regNo = VXApi.pageRegNo();
    const status = view.root.querySelector("[data-status]");
    let left = people.length;
    const report = () => {
      status.textContent = left ? `Getting photos and details, ${left} to go…` : "";
    };
    report();
    let next = 0;
    const worker = async () => {
      while (next < people.length && results === view) {
        const p = people[next++];
        p.state = "loading";
        paint(p);
        try {
          const doc = VXParse.toDoc(await VXApi.employee(regNo, p.empId));
          const table = profileTable(doc);
          p.profile = table ? readProfile(table) : null;
          p.state = p.profile ? "done" : "failed";
        } catch {
          p.state = "failed";
        }
        left -= 1;
        if (results !== view) return;
        paint(p);
        report();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function paint(p) {
    const f = p.profile?.facts ?? {};
    const initials = sameName(p.name)
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
    const waiting = p.state === "waiting" || p.state === "loading";
    const photo = p.profile?.photo
      ? `<img src="${esc(p.profile.photo)}" alt="">`
      : `<div class="vx-avatar ${waiting ? "vx-pulse" : ""}">${esc(initials)}</div>`;
    const note =
      p.state === "waiting"
        ? "Waiting…"
        : p.state === "loading"
          ? "Getting photo and details…"
          : p.state === "failed"
            ? "Details could not be loaded."
            : "";
    const line = (label, value) =>
      value ? `<li><span>${label}</span><strong>${esc(value)}</strong></li>` : "";

    p.el.innerHTML = `
      ${photo}
      <div class="vx-result-main">
        <h3>${esc(p.name)}</h3>
        <div class="vx-muted">${esc(p.designation)}</div>
        <ul class="vx-facts">
          ${line("School", f.school || p.school)}
          ${line("Department", f.department)}
          ${line("Cabin", f.cabin)}
          ${line("E-mail", f.email)}
        </ul>
        ${note ? `<div class="vx-sub">${note}</div>` : ""}
        <div class="vx-person-actions">
          <button type="button" class="vx-btn vx-primary" data-open>Open profile</button>
          ${f.email ? `<a class="vx-btn" href="mailto:${esc(f.email)}">E-mail</a><button type="button" class="vx-btn" data-copy="${esc(f.email)}">Copy address</button>` : ""}
          ${p.state === "idle" || p.state === "failed" ? `<button type="button" class="vx-btn" data-load>Get photo and details</button>` : ""}
        </div>
      </div>`;
  }

  VXDom.onPageChange(scan);
  VXDom.onSetting("timetable", (on) => {
    enabled = on;
    scan();
  });

  return { open, searchTerm };
})();
