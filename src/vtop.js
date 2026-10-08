const VXApi = (() => {
  const BASE = `${location.origin}/vtop/`;
  const HOUR = 3_600_000;

  const TIMETABLE_TTL = 72 * HOUR;
  const CALENDAR_TTL = 12 * HOUR;

  class SessionExpiredError extends Error {
    constructor() {
      super("Your VTOP session has expired. Sign in again.");
    }
  }

  function csrf() {
    const field = document.querySelector('input[name="_csrf"]')?.value;
    if (field) return field;
    const meta = document.querySelector('meta[name="_csrf"]')?.content;
    if (meta) return meta;
    for (const s of document.scripts) {
      const m = s.textContent.match(/csrfValue\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    }
    return "";
  }

  function pageRegNo() {
    return (
      document.querySelector("#authorizedIDX")?.value ??
      document.querySelector('input[name="authorizedID"]')?.value ??
      ""
    );
  }

  async function post(regNo, path, fields = {}, multipart = false) {
    const all = { _csrf: csrf(), authorizedID: regNo, ...fields };
    let body;
    if (multipart) {
      body = new FormData();
      for (const [k, v] of Object.entries(all)) body.append(k, v);
    } else {
      all.x = new Date().toUTCString();
      body = new URLSearchParams(all);
    }
    const res = await fetch(BASE + path, {
      method: "POST",
      body,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if ([401, 403, 404].includes(res.status)) throw new SessionExpiredError();
    if (!res.ok) throw new Error(`VTOP returned ${res.status}`);
    const html = await res.text();
    if (VXParse.isLoginPage(html) || /\/vtop\/(login|open\/page)/.test(res.url)) {
      throw new SessionExpiredError();
    }
    return html;
  }

  const openMenu = (regNo, path) =>
    post(regNo, path, { verifyMenu: "true", nocache: "@(new Date().getTime())" });

  async function pooled(items, limit, task) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await task(items[i]);
        }
      }),
    );
    return out;
  }

  async function summary(regNo) {
    const menu = VXParse.toDoc(await openMenu(regNo, "academics/common/StudentAttendance"));
    const option = VXSemester.choose(
      [...menu.querySelectorAll("#semesterSubId option")].map((o) => ({
        value: o.getAttribute("value") ?? "",
        text: o.textContent.replace(/\s+/g, " ").trim(),
      })),
    );
    if (!option) throw new Error("VTOP did not list any semesters.");
    const page = VXParse.toDoc(
      await post(regNo, "processViewStudentAttendance", { semesterSubId: option.value }),
    );
    const table = page.querySelector("#AttendanceDetailDataTable");
    const parsed = table ? VXParse.attendanceSummary(table) : { courses: [] };
    return { courses: parsed.courses, semesterId: option.value };
  }

  async function details({ regNo, semesterId, courses }) {
    const lists = await pooled(courses, 3, async (c) =>
      c.courseId
        ? VXParse.attendanceDetail(
            await post(regNo, "processViewAttendanceDetail", {
              semesterSubId: semesterId,
              registerNumber: regNo,
              courseId: c.courseId,
              courseType: c.courseType,
            }),
          )
        : [],
    );
    const records = {};
    courses.forEach((c, i) => (records[c.code] = lists[i]));
    return records;
  }

  const assignments = (regNo, classIds) =>
    pooled(classIds, 3, async (classId) =>
      VXParse.assignments(await post(regNo, "examinations/processDigitalAssignment", { classId })),
    );

  const employee = (regNo, empId) => post(regNo, "hrms/EmployeeSearch1ForStudent", { empId });

  async function fetchTimetable(regNo, semesterId) {
    await openMenu(regNo, "academics/common/StudentTimeTable");
    return VXParse.timetable(
      await post(regNo, "processViewTimeTable", { semesterSubId: semesterId }),
    );
  }

  async function fetchCalendar(regNo, semSubId, classGroup) {
    await openMenu(regNo, "academics/common/CalendarPreview");
    const groups = VXParse.classGroups(
      await post(regNo, "getDateForSemesterPreview", {
        paramReturnId: "getDateForSemesterPreview",
        semSubId,
      }),
    );

    const classGroupId =
      groups.find((g) => g.name.toLowerCase() === classGroup.toLowerCase())?.id ?? "ALL";
    const months = VXParse.calendarMonths(
      await post(regNo, "getListForSemester", {
        paramReturnId: "getListForSemester",
        semSubId,
        classGroupId,
      }),
    );
    const days = await pooled(months, 3, async (calDate) =>
      VXParse.calendarMonth(
        await post(regNo, "processViewCalendar", { calDate, semSubId, classGroupId }),
        calDate,
      ),
    );
    return days.flat();
  }

  async function schedule({ regNo, semesterId, classGroup }, force = false) {
    const key = `schedule:${regNo}:${semesterId}`;
    const out = (await chrome.storage.local.get(key))[key] ?? {};
    const now = Date.now();
    const fresh = (at, ttl) => !force && at && now - at < ttl;
    const needTimetable = !(out.timetable?.length && fresh(out.timetableAt, TIMETABLE_TTL));
    const needCalendar = !(out.calendar?.length && fresh(out.calendarAt, CALENDAR_TTL));
    if (!needTimetable && !needCalendar) return out;

    let failure = null;
    try {
      if (needTimetable) {
        const timetable = await fetchTimetable(regNo, semesterId);
        if (timetable.length) Object.assign(out, { timetable, timetableAt: now });
      }
      if (needCalendar) {
        const calendar = await fetchCalendar(regNo, semesterId, classGroup);
        if (calendar.length) Object.assign(out, { calendar, calendarAt: now });
      }
    } catch (err) {
      failure = err;
    }
    await openMenu(regNo, "academics/common/StudentAttendance").catch(() => {});
    await chrome.storage.local.set({ [key]: out });

    if (failure && !(out.timetable?.length && out.calendar?.length)) throw failure;
    return out;
  }

  return { SessionExpiredError, pageRegNo, summary, details, schedule, assignments, employee };
})();
