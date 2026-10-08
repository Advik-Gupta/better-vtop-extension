(() => {
  const { clean, esc } = VXDom;
  const LETTERS = ["S", "A", "B", "C", "D", "E", "F"];

  let enabled = true;

  const fmt = (n) => (Math.round(n * 100) / 100).toString();

  function floorOf(range) {
    const lower = range.match(/>=?\s*([\d.]+)/);
    return lower ? parseFloat(lower[1]) : 0;
  }

  function readRanges(table) {
    for (const tr of table.rows) {
      const cells = [...tr.cells].map((c) => clean(c.textContent));
      const ranged = cells.filter((c) => /^(>=?|<)\s*[\d.]+/.test(c));
      if (ranged.length < LETTERS.length) continue;
      const ranges = ranged.slice(-LETTERS.length);
      const numbers = cells
        .slice(0, cells.length - ranged.length)
        .filter((c) => /^[\d.]+$/.test(c))
        .map(Number);
      return {
        bands: LETTERS.map((letter, i) => ({ letter, floor: floorOf(ranges[i]), text: ranges[i] })),
        strength: numbers[0] ?? null,
        mean: numbers.length >= 4 ? numbers[2] : (numbers[numbers.length - 2] ?? null),
        deviation: numbers.length >= 4 ? numbers[3] : (numbers[numbers.length - 1] ?? null),
      };
    }
    return null;
  }

  function readCourse(table) {
    let row = table.closest("tr");
    while (row && row.parentElement?.closest("tr")) row = row.parentElement.closest("tr");
    for (let tr = row?.previousElementSibling; tr; tr = tr.previousElementSibling) {
      const cells = [...tr.cells].map((c) => clean(c.textContent));
      const codeAt = cells.findIndex((c) => /^[A-Z]{3,5}\d{3}[A-Z]?$/.test(c));
      if (codeAt < 0) continue;
      const gradeAt = cells.findLastIndex((c) => /^[SABCDEFNPW]\d?$/.test(c));
      if (gradeAt < 1 || !/^[\d.]+$/.test(cells[gradeAt - 1])) return null;
      return {
        code: cells[codeAt],
        name: cells[codeAt + 1] ?? "",
        total: parseFloat(cells[gradeAt - 1]),
        grade: cells[gradeAt],
      };
    }
    return null;
  }

  function scan() {
    if (!enabled) {
      document.querySelectorAll(".vx-grade").forEach((el) => el.remove());
      document.querySelectorAll("table[data-vx-grade]").forEach((t) => delete t.dataset.vxGrade);
      return;
    }
    for (const table of document.querySelectorAll("#b5-pagewrapper table, #page-wrapper table")) {
      if (table.dataset.vxGrade || table.closest(".vx-root")) continue;
      if (!/range of grades/i.test(table.rows[0]?.textContent ?? "")) continue;
      table.dataset.vxGrade = "1";
      try {
        draw(table);
      } catch (err) {
        console.error("[Better VTOP] could not explain the grade ranges", err);
      }
    }
  }

  function draw(table) {
    const ranges = readRanges(table);
    const course = readCourse(table);
    if (!ranges || !course) return;
    const { bands } = ranges;
    const mine = bands.find((b) => course.total >= b.floor) ?? bands[bands.length - 1];
    const at = bands.indexOf(mine);
    const above = at > 0 ? bands[at - 1] : null;
    const below = at < bands.length - 1 ? bands[at + 1] : null;
    const toNext = above ? above.floor - course.total : null;
    const cushion = course.total - mine.floor;

    const low = Math.max(0, Math.min(bands[bands.length - 2].floor - 8, course.total - 5));
    const high = 100;
    const place = (value) => ((Math.min(high, Math.max(low, value)) - low) / (high - low)) * 100;

    const segments = [...bands]
      .reverse()
      .map((band, i, list) => {
        const from = i === 0 ? low : band.floor;
        const to = i === list.length - 1 ? high : list[i + 1].floor;
        const width = place(to) - place(from);
        if (width <= 0) return "";
        return `<div class="vx-band vx-band-${band.letter} ${band === mine ? "vx-band-mine" : ""}" style="width:${width}%">
          <strong>${band.letter}</strong><span>${band.letter === "F" ? `below ${fmt(to)}` : `${fmt(band.floor)}${i === list.length - 1 ? "+" : ` to ${fmt(to)}`}`}</span>
        </div>`;
      })
      .join("");

    const sentence = [
      `You scored <strong>${fmt(course.total)}</strong> and got <strong>${esc(course.grade)}</strong>.`,
      above
        ? `${above.letter} started at ${fmt(above.floor)}, so you missed it by <strong class="vx-bad">${fmt(toNext)} ${toNext === 1 ? "mark" : "marks"}</strong>.`
        : "That is the top grade.",
      below
        ? `You were <strong class="vx-good">${fmt(cushion)}</strong> above the ${mine.letter} cut-off of ${fmt(mine.floor)}.`
        : "",
    ].join(" ");

    const stats = [
      ranges.mean !== null
        ? `Class mean ${fmt(ranges.mean)} (you were ${fmt(Math.abs(course.total - ranges.mean))} ${course.total >= ranges.mean ? "above" : "below"})`
        : "",
      ranges.deviation !== null ? `spread (SD) ${fmt(ranges.deviation)}` : "",
      ranges.strength !== null ? `${fmt(ranges.strength)} students` : "",
    ].filter(Boolean);

    const root = document.createElement("div");
    root.className = "vx-root vx-grade";
    root.innerHTML = `
      <section class="vx-card">
        <h3>${esc(course.code)} ${esc(course.name)}</h3>
        <p class="vx-sentence">${sentence}</p>
        <div class="vx-bands">
          ${segments}
          <div class="vx-marker" style="left:${place(course.total)}%"><span>You: ${fmt(course.total)}</span></div>
          ${ranges.mean !== null ? `<div class="vx-marker vx-marker-mean" style="left:${place(ranges.mean)}%"><span>Mean: ${fmt(ranges.mean)}</span></div>` : ""}
        </div>
        <p class="vx-sub">${esc(stats.join(" · "))}</p>
      </section>`;
    (table.closest(".table-responsive") ?? table).before(root);
  }

  VXDom.onPageChange(scan);
  VXDom.onSetting("marks", (on) => {
    enabled = on;
    scan();
  });
})();
