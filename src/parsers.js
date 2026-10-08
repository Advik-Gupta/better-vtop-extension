const VXParse = (() => {
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const pad = (n) => String(n).padStart(2, "0");

  const MONTHS = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const DAY_INDEX = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

  const toDoc = (html) => new DOMParser().parseFromString(html, "text/html");

  function toISODate(raw) {
    const m = clean(raw).match(/^(\d{1,2})-([A-Za-z]{3}|\d{1,2})-(\d{4})/);
    if (!m) return null;
    const month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`;
  }

  const cells = (row) =>
    [...row.children]
      .filter((c) => c.tagName === "TD" || c.tagName === "TH")
      .map((c) => clean(c.textContent));

  const isLoginPage = (html) => html.includes('id="vtopLoginForm"');

  function courseKind(typeLabel, courseType) {
    if (courseType === "LO" || /lab/i.test(typeLabel)) return "lab";
    if (courseType === "TH" || /theory/i.test(typeLabel)) return "theory";
    return "other";
  }

  function attendanceSummary(table) {
    const courses = [];
    let semesterId = "";
    let regNo = "";
    for (const row of table.querySelectorAll("tr")) {
      const c = cells(row);
      if (c.length < 8 || !/^\d+$/.test(c[0])) continue;

      const course = c[2].split(" - ");
      const code = course[0];
      const typeLabel = course.length > 2 ? course[course.length - 1] : "";
      const name = course.slice(1, course.length > 2 ? -1 : undefined).join(" - ");
      const [classId = "", slot = "", venue = ""] = c[3].split(" - ");

      const trigger = row.querySelector("[onclick]");
      const args = [...(trigger?.getAttribute("onclick") ?? "").matchAll(/'([^']*)'/g)].map(
        (m) => m[1],
      );
      semesterId ||= args[0] ?? "";
      regNo ||= args[1] ?? "";
      const courseType = args[3] ?? "";

      courses.push({
        code,
        name,
        kind: courseKind(typeLabel, courseType),
        typeLabel,
        classId,
        classGroup: c[1],
        slot,
        venue,
        faculty: c[4].replace(/\s*-\s*[A-Z]+$/, ""),
        attended: Number(c[5]) || 0,
        total: Number(c[6]) || 0,
        percentage: parseInt(c[7], 10) || 0,
        debar: c[8] && c[8] !== "-" ? c[8] : null,
        courseId: args[2] ?? "",
        courseType,

        trigger,
      });
    }
    return { courses, semesterId, regNo };
  }

  function toStatus(raw) {
    const s = raw.toLowerCase();
    if (s.startsWith("present")) return "present";
    if (s.startsWith("absent")) return "absent";
    if (s.includes("duty")) return "od";
    return null;
  }

  function attendanceDetail(html) {
    const records = [];
    for (const row of toDoc(html).querySelectorAll("#StudentAttendanceDetailDataTable tr")) {
      const c = cells(row);
      if (c.length < 5) continue;
      const date = toISODate(c[1]);
      const status = toStatus(c[4]);
      if (!date || !status) continue;
      records.push({ date, slot: c[2], time: c[3].split("/").pop()?.trim() ?? "", status });
    }
    return records.sort((a, b) => a.date.localeCompare(b.date));
  }

  function timetable(
    source,
    times = { theory: { start: [], end: [] }, lab: { start: [], end: [] } },
  ) {
    const root = typeof source === "string" ? toDoc(source) : source;
    const entries = [];
    let headerKind = "theory";
    let day = 0;

    for (const row of root.querySelectorAll("#timeTableStyle tr")) {
      const c = cells(row);
      if (c.length < 3) continue;

      if (c[1] === "Start") {
        headerKind = c[0].toUpperCase() === "LAB" ? "lab" : "theory";
        times[headerKind].start = c.slice(2);
        continue;
      }
      if (c[0] === "End") {
        times[headerKind].end = c.slice(1);
        continue;
      }

      let kindCell = c[0];
      let rest = c.slice(1);
      if (DAY_INDEX[c[0].toUpperCase()]) {
        day = DAY_INDEX[c[0].toUpperCase()];
        kindCell = c[1];
        rest = c.slice(2);
      }
      const kind = kindCell.toUpperCase() === "LAB" ? "lab" : "theory";
      if (!day) continue;

      rest.forEach((cell, i) => {
        const parts = cell.split("-");
        if (parts.length < 4 || !/^[A-Z]{3,5}\d{3}[A-Z]?$/.test(parts[1])) return;
        entries.push({
          day,
          slot: parts[0],
          code: parts[1],
          kind,
          venue: parts.slice(3, -1).join("-"),
          start: times[kind].start[i] ?? "",
          end: times[kind].end[i] ?? "",
          column: i,
        });
      });
    }
    return entries;
  }

  function classGroups(html) {
    return [...toDoc(html).querySelectorAll("#classGroupId option")]
      .map((o) => ({ id: o.getAttribute("value") ?? "", name: clean(o.textContent) }))
      .filter((g) => g.id);
  }

  function calendarMonths(html) {
    return [...html.matchAll(/processViewCalendar\((?:&#39;|')([^'&]+)(?:&#39;|')\)/g)].map(
      (m) => m[1],
    );
  }

  function dayType(label) {
    const l = label.toLowerCase();
    if (!l) return "no_instruction";
    if (/no\s+instruction|non[-\s]?instruction/.test(l)) return "no_instruction";
    if (l.includes("instructional")) return "instructional";
    if (l.includes("holiday")) return "holiday";
    if (/\b(cat|fat|exam|assessment)/.test(l)) return "exam";
    if (/vacation|break/.test(l)) return "no_instruction";
    return "other";
  }

  function calendarMonth(html, monthKey) {
    const first = toISODate(monthKey);
    if (!first) return [];
    const prefix = first.slice(0, 8);
    const days = [];

    for (const td of toDoc(html).querySelectorAll("table td")) {
      const spans = [...td.children]
        .filter((e) => e.tagName === "SPAN")
        .map((s) => clean(s.textContent));
      if (!spans.length || !/^\d{1,2}$/.test(spans[0])) continue;
      const date = prefix + pad(Number(spans[0]));
      if (days.some((d) => d.date === date)) continue;

      const label = spans[1] ?? "";
      const detail = (spans[2] ?? "").replace(/^\(|\)$/g, "");
      const type =
        detail.toLowerCase().includes("exam") && dayType(label) === "other"
          ? "exam"
          : dayType(label);
      const order = detail
        .match(/^(\w+)\s+Day Order/i)?.[1]
        .slice(0, 3)
        .toUpperCase();
      days.push({
        date,
        type,
        label,
        detail,
        ...(order && DAY_INDEX[order] ? { dayOrder: DAY_INDEX[order] } : {}),
      });
    }
    return days.sort((a, b) => a.date.localeCompare(b.date));
  }

  function assignments(html) {
    const list = [];
    for (const row of toDoc(html).querySelectorAll("table tr")) {
      const c = cells(row);
      if (c.length < 7 || !/^\d+$/.test(c[0])) continue;
      const due = toISODate(c[4]);
      if (!due && !c[1]) continue;
      const submittedOn = /\d{4}/.test(c[6]) ? c[6] : "";
      list.push({
        title: c[1],
        maxMark: c[2],
        weightage: c[3],
        due,
        dueText: c[4],
        submitted: Boolean(submittedOn),
        submittedOn,
      });
    }
    return list;
  }

  return {
    toDoc,
    assignments,
    isLoginPage,
    attendanceSummary,
    attendanceDetail,
    timetable,
    classGroups,
    calendarMonths,
    calendarMonth,
  };
})();
