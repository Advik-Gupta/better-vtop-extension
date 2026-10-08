const VXEngine = (() => {
  function toISO(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const todayISO = () => toISO(new Date());
  const parseISO = (iso) => new Date(iso + "T00:00:00");
  function weekdayOf(iso) {
    const d = parseISO(iso).getDay();
    return d === 0 ? 7 : d;
  }
  function daysBetween(from, to) {
    return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
  }
  function formatDate(iso, opts = { day: "numeric", month: "short" }) {
    return parseISO(iso).toLocaleDateString("en-IN", opts);
  }
  function relativeDay(iso, today = todayISO()) {
    const n = daysBetween(today, iso);
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }
  const REQUIRED = 75;
  const rawPct = (attended, total) => (total === 0 ? 100 : (attended / total) * 100);
  const shownPct = (attended, total) => Math.ceil(rawPct(attended, total));
  const isSafe = (attended, total) => shownPct(attended, total) >= REQUIRED;
  function buildLookup(data) {
    const recorded = new Map();
    for (const [code, list] of Object.entries(data.records)) {
      for (const r of list) {
        if (!recorded.has(r.date)) recorded.set(r.date, new Map());
        const byCode = recorded.get(r.date);
        byCode.set(code, [...(byCode.get(code) ?? []), r]);
      }
    }
    return {
      data,
      days: new Map(data.calendar.map((d) => [d.date, d])),
      courses: new Map(data.courses.map((c) => [c.code, c])),
      recorded,
    };
  }
  function blocksForWeekday(data, weekday) {
    const byCode = new Map();
    const courses = new Map(data.courses.map((c) => [c.code, c]));
    for (const e of data.timetable) {
      if (e.day !== weekday) continue;
      const b = byCode.get(e.code);
      if (b) {
        b.slots.push(e.slot);
        b.count += 1;
        if (e.start < b.start) b.start = e.start;
        if (e.end > b.end) b.end = e.end;
      } else {
        byCode.set(e.code, {
          code: e.code,
          course: courses.get(e.code),
          slots: [e.slot],
          start: e.start,
          end: e.end,
          venue: e.venue,
          kind: e.kind,
          count: 1,
        });
      }
    }
    return [...byCode.values()].sort((a, b) => a.start.localeCompare(b.start));
  }
  function dayOrderOn(look, date) {
    const day = look.days.get(date);
    if (!day || day.type !== "instructional") return null;
    return day.dayOrder ?? weekdayOf(date);
  }
  function blocksOn(look, date) {
    const order = dayOrderOn(look, date);
    return order ? blocksForWeekday(look.data, order) : [];
  }
  function dayTally(look, marks, code, date, scheduled) {
    const recs = look.recorded.get(date)?.get(code);
    const mark = marks[date]?.[code];
    if (recs?.length) {
      const vtopAttended = recs.filter((r) => r.status !== "absent").length;
      const attended = mark ? (mark === "absent" ? 0 : recs.length) : vtopAttended;
      return { total: recs.length, attended, vtopAttended, recorded: true };
    }
    if (mark && scheduled > 0) {
      return {
        total: scheduled,
        attended: mark === "absent" ? 0 : scheduled,
        vtopAttended: 0,
        recorded: false,
      };
    }
    return null;
  }
  function examWindows(calendar) {
    const out = [];
    for (const d of calendar) {
      if (d.type !== "exam") continue;
      const last = out[out.length - 1];
      if (last && last.label === d.label && daysBetween(last.end, d.date) <= 3) {
        last.end = d.date;
      } else {
        out.push({ label: d.label, start: d.date, end: d.date });
      }
    }
    return out;
  }
  function examsFor(calendar, course) {
    return examWindows(calendar).filter((e) => {
      const label = e.label.toLowerCase();
      if (/\blab/.test(label)) return course.kind === "lab";
      if (/theory/.test(label)) return course.kind !== "lab";
      return true;
    });
  }
  const dayAfter = (iso) => toISO(new Date(parseISO(iso).getTime() + 86_400_000));
  function horizonsFor(data, course) {
    const exams = course ? examsFor(data.calendar, course) : examWindows(data.calendar);
    const list = exams.map((e) => ({ date: e.start, label: e.label }));
    const lastClass = [...data.calendar].reverse().find((d) => d.type === "instructional")?.date;
    if (lastClass && !list.some((h) => h.date > lastClass)) {
      list.push({ date: dayAfter(lastClass), label: "FAT", inferred: true });
    }
    return list;
  }
  function defaultHorizon(data, today, course) {
    const all = horizonsFor(data, course);
    return (
      all.find((h) => h.date > today) ??
      all[all.length - 1] ?? { date: dayAfter(today), label: "semester end" }
    );
  }
  function courseStats(
    look,
    marks,
    course,
    today,
    horizon = defaultHorizon(look.data, today, course),
  ) {
    let attended = course.attended;
    let total = course.total;
    let localTotal = 0;
    let localAbsent = 0;
    let plannedAbsent = 0;
    let futureMarkedTotal = 0;
    let futureMarkedAttended = 0;
    const open = [];
    for (const [date, byCode] of Object.entries(marks)) {
      if (!byCode[course.code]) continue;
      const t = dayTally(look, marks, course.code, date, 0);
      if (t?.recorded) attended += t.attended - t.vtopAttended;
    }
    for (const day of look.data.calendar) {
      if (day.date >= horizon.date && day.date > today) break;
      const block = blocksOn(look, day.date).find((b) => b.code === course.code);
      if (!block) continue;
      if (look.recorded.get(day.date)?.has(course.code)) continue;
      const mark = marks[day.date]?.[course.code];
      if (day.date <= today) {
        if (mark) {
          localTotal += 1;
          total += block.count;
          if (mark === "absent") localAbsent += 1;
          else attended += block.count;
        } else if (day.date === today && day.date < horizon.date) {
          open.push(block.count);
        }
      } else if (mark) {
        futureMarkedTotal += block.count;
        if (mark === "absent") plannedAbsent += 1;
        else futureMarkedAttended += block.count;
      } else {
        open.push(block.count);
      }
    }
    const openPeriods = open.reduce((n, c) => n + c, 0);
    const endTotal = total + futureMarkedTotal + openPeriods;
    const endAttended = attended + futureMarkedAttended + openPeriods;
    const longestFirst = [...open].sort((x, y) => y - x);
    let canMiss = 0;
    let missed = 0;
    for (const periods of longestFirst) {
      missed += periods;
      if (!isSafe(endAttended - missed, endTotal)) break;
      canMiss += 1;
    }
    const safe = isSafe(endAttended, endTotal);
    if (!safe) canMiss = 0;
    return {
      course,
      attended,
      total,
      pct: shownPct(attended, total),
      safe,
      belowNow: !isSafe(attended, total),
      localTotal,
      localAbsent,
      upcoming: open.length,
      plannedAbsent,
      canMiss,
      needed: safe ? open.length - canMiss : null,
      bestPct: shownPct(endAttended, endTotal),
      horizon: horizon.date,
      horizonLabel: horizon.label,
    };
  }
  function examOutlook(look, marks, course, today) {
    const exams = horizonsFor(look.data, course);
    return exams.map((exam) => {
      const debarred =
        course.debar?.split(":")[0].trim().toLowerCase() === exam.label.toLowerCase();
      if (exam.date > today) {
        const s = courseStats(look, marks, course, today, exam);
        return {
          label: exam.label,
          start: exam.date,
          inferred: Boolean(exam.inferred),
          past: false,
          debarred,
          attended: s.attended,
          total: s.total,
          pct: s.pct,
          safe: s.safe,
          upcoming: s.upcoming,
          canMiss: s.canMiss,
          needed: s.needed,
        };
      }
      const dates = new Set();
      for (const r of look.data.records[course.code] ?? []) dates.add(r.date);
      for (const [date, byCode] of Object.entries(marks)) if (byCode[course.code]) dates.add(date);
      let attended = 0;
      let total = 0;
      for (const date of dates) {
        if (date >= exam.date) continue;
        const scheduled = blocksOn(look, date).find((b) => b.code === course.code)?.count ?? 0;
        const t = dayTally(look, marks, course.code, date, scheduled);
        if (!t) continue;
        attended += t.attended;
        total += t.total;
      }
      return {
        label: exam.label,
        start: exam.date,
        inferred: Boolean(exam.inferred),
        past: true,
        debarred,
        attended,
        total,
        pct: shownPct(attended, total),
        safe: isSafe(attended, total),
        upcoming: 0,
        canMiss: 0,
        needed: 0,
      };
    });
  }
  function riskOf(s) {
    if (s.course.debar) return "debarred";
    if (!s.safe) return "danger";
    if (s.canMiss <= 1) return "warning";
    return "safe";
  }
  const classes = (n) => `${n} class${n === 1 ? "" : "es"}`;
  function whenLabel(h) {
    const date = h.date ?? h.start;
    if (!h.inferred) return formatDate(date);
    return `after ${formatDate(toISO(new Date(parseISO(date).getTime() - 86_400_000)))}`;
  }
  function projection(s) {
    if (!s.safe) {
      return s.upcoming === 0
        ? `Below 75% with no classes left before ${s.horizonLabel}`
        : `Can't reach 75% before ${s.horizonLabel}`;
    }
    if (s.upcoming === 0) return `No classes left before ${s.horizonLabel}`;
    return s.canMiss === 0
      ? `Can't miss any before ${s.horizonLabel}`
      : `Can miss ${s.canMiss} more before ${s.horizonLabel}`;
  }
  function outlookSentence(s) {
    const left = `${classes(s.upcoming)} left before ${s.horizonLabel}`;
    if (s.upcoming === 0) {
      return s.safe
        ? `No classes left before ${s.horizonLabel}, you finish at ${s.pct}%, which is safe.`
        : `No classes left before ${s.horizonLabel}, you finish at ${s.pct}%, below 75%.`;
    }
    if (!s.safe) {
      return `${left}. Even attending all of them only gets you to ${s.bestPct}%, short of 75%.`;
    }
    if (s.canMiss === 0) {
      return `${left}. You need all of them to be at 75% when ${s.horizonLabel} starts.`;
    }
    return `${left}. You can miss ${s.canMiss} of them and still be at 75% or above when ${s.horizonLabel} starts.`;
  }

  return {
    toISO,
    todayISO,
    parseISO,
    weekdayOf,
    daysBetween,
    formatDate,
    relativeDay,
    REQUIRED,
    rawPct,
    shownPct,
    isSafe,
    buildLookup,
    blocksForWeekday,
    dayOrderOn,
    blocksOn,
    examWindows,
    examsFor,
    horizonsFor,
    defaultHorizon,
    courseStats,
    examOutlook,
    riskOf,
    whenLabel,
    projection,
    outlookSentence,
  };
})();
