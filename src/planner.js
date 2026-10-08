const VXPlan = (() => {
  const E = VXEngine;

  const marksKey = (regNo, semesterId) => `marks:${regNo}:${semesterId}`;
  const snapshotKey = (regNo) => `snapshot:${regNo}`;

  function prune(marks, records, courses) {
    const out = {};
    for (const [date, byCode] of Object.entries(marks)) {
      for (const [code, status] of Object.entries(byCode)) {
        if (!courses.some((c) => c.code === code)) continue;
        const recs = (records[code] ?? []).filter((r) => r.date === date);
        if (recs.length && !(status === "od" && recs.some((r) => r.status === "absent"))) continue;
        (out[date] ??= {})[code] = status;
      }
    }
    return out;
  }

  function saveSnapshot(regNo, semesterId, stats) {
    const courses = {};
    for (const s of stats) {
      courses[s.course.code] = {
        canMiss: s.canMiss,
        upcoming: s.upcoming,
        safe: s.safe,
        horizonLabel: s.horizonLabel,
      };
    }
    const snapshot = { at: Date.now(), semesterId, courses };
    chrome.storage.local.set({ [snapshotKey(regNo)]: snapshot });
    return snapshot;
  }

  async function calculate(regNo) {
    const { courses, semesterId } = await VXApi.summary(regNo);
    if (!courses.length) throw new Error("VTOP returned no attendance for this semester.");
    const records = await VXApi.details({ regNo, semesterId, courses });
    const { timetable = [], calendar = [] } = await VXApi.schedule({
      regNo,
      semesterId,
      classGroup: courses[0].classGroup,
    });
    if (!timetable.length || !calendar.length) {
      throw new Error("VTOP did not return the timetable or the academic calendar.");
    }
    const key = marksKey(regNo, semesterId);
    const stored = (await chrome.storage.local.get(key))[key] ?? {};
    const marks = prune(stored, records, courses);

    const data = { courses, records, timetable, calendar };
    const look = E.buildLookup(data);
    const today = E.todayISO();
    return saveSnapshot(
      regNo,
      semesterId,
      courses.map((c) => E.courseStats(look, marks, c, today)),
    );
  }

  return { marksKey, snapshotKey, prune, saveSnapshot, calculate };
})();
