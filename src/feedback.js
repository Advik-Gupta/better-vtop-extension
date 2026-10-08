(() => {
  const { clean, esc, waitFor } = VXDom;
  const KEY = "feedbackRun";
  const POST =
    'button[onclick*="processCourseFeedbackPerception"], button[onclick*="processCourseOutcomeFeedbackPerception"]';
  const SAVE = 'button[onclick*="saveCourseOutcomeFeedbackPerception"]';
  const BACK = 'button[onclick*="goBackCourseFeedback"]';
  const MAX_AGE = 10 * 60 * 1000;

  let enabled = true;
  let rating = 5;
  let state = null;
  let stepping = false;
  let offered = "";
  let dismissed = "";

  const save = () => chrome.storage.local.set({ [KEY]: state });

  const byText = (text) =>
    [...document.querySelectorAll("button, input[type='button'], input[type='submit']")].filter(
      (b) =>
        !b.closest(".vx-root, .vx-hidden") &&
        clean(b.textContent || b.value).toLowerCase() === text,
    );

  function postButtons() {
    const known = [...document.querySelectorAll(POST)].filter(
      (b) => !b.closest(".vx-hidden, .vx-root"),
    );
    return known.length ? known : byText("post").filter((b) => b.closest("table"));
  }

  const ratingGroups = () => [...document.querySelectorAll("fieldset.rating")];

  const onRatingPage = () =>
    Boolean(document.querySelector("#CourseOutcomeFeedbackPerception") || ratingGroups().length);

  function courseName(button) {
    const cells = [...(button.closest("tr")?.cells ?? [])].map((c) => clean(c.textContent));
    const code = cells.find((c) => /^[A-Z]{3,5}\d{3}[A-Z]?$/.test(c));
    const title = cells[cells.indexOf(code) + 1] || cells.find((c) => c.length > 12) || "";
    return [code, title].filter(Boolean).join(" ") || "Course";
  }

  function selectStars(value) {
    const groups = ratingGroups();
    const inputs = groups.length
      ? groups.map((g) => g.querySelector(`input[type="radio"][value="${value}"]`)).filter(Boolean)
      : [...document.querySelectorAll(`input[type="radio"][value="${value}"]`)];
    for (const input of inputs) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const label = input.id
        ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
        : null;
      if (label) label.click();
      else input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    return inputs.length;
  }

  function panel() {
    let el = document.querySelector(".vx-feedback");
    if (!el) {
      el = document.createElement("div");
      el.className = "vx-root vx-feedback";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Better VTOP course feedback");
      document.body.append(el);
      el.addEventListener("change", (e) => {
        if (e.target.matches("[data-rating]")) rating = Number(e.target.value);
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-stop]") && state?.active) {
          state.stopped = true;
          save();
          paintRun();
        } else if (e.target.closest("[data-close]")) {
          dismissed = offered;
          if (state && !state.active) {
            state = null;
            chrome.storage.local.remove(KEY);
          }
          closePanel();
        } else if (e.target.closest("[data-go]")) {
          start(rating);
        } else if (e.target.closest("[data-fill]")) {
          el.querySelector("[data-result]").textContent = fillOnly(rating);
        }
      });
    }
    return el;
  }

  function closePanel() {
    document.querySelector(".vx-feedback")?.remove();
    offered = "";
  }

  function fillOnly(value) {
    const count = selectStars(value);
    return `Selected ${value} ${value === 1 ? "star" : "stars"} for ${count} ${count === 1 ? "outcome" : "outcomes"}. Review and press Submit.`;
  }

  const stars = () => `<label>Rating
      <select data-rating>${[5, 4, 3, 2, 1]
        .map(
          (n) =>
            `<option value="${n}" ${n === rating ? "selected" : ""}>${n} ${n === 1 ? "star" : "stars"}</option>`,
        )
        .join("")}</select>
    </label>`;

  function offer(kind, pending) {
    const key = `${kind}:${pending}`;
    if (offered === key || dismissed === key) return;
    offered = key;
    panel().innerHTML =
      kind === "list"
        ? `<section class="vx-card">
            <h3>Fill your course feedback?</h3>
            <p>${pending} ${pending === 1 ? "course is" : "courses are"} waiting. Better VTOP can rate every outcome and submit ${pending === 1 ? "it" : "them all"} for you.</p>
            <div class="vx-feedback-row">${stars()}</div>
            <p class="vx-sub">Each form is submitted straight away and cannot be changed afterwards.</p>
            <div class="vx-feedback-actions">
              <button type="button" class="vx-btn vx-primary" data-go>▶ Start filling</button>
              <button type="button" class="vx-btn" data-close>Not now</button>
            </div>
          </section>`
        : `<section class="vx-card">
            <h3>Rate every outcome at once?</h3>
            <p>Better VTOP can select the same rating for all outcomes on this page.</p>
            <div class="vx-feedback-row">${stars()}</div>
            <p class="vx-sub" data-result>Nothing is submitted until you press Submit yourself.</p>
            <div class="vx-feedback-actions">
              <button type="button" class="vx-btn vx-primary" data-fill>Select for all</button>
              <button type="button" class="vx-btn" data-close>Close</button>
            </div>
          </section>`;
  }

  function paintRun() {
    if (!state) return;
    offered = "";
    const share = state.total ? Math.round((state.done / state.total) * 100) : 0;
    const signature = JSON.stringify([state.active, state.stopped, state.done, state.log.length]);
    const el = panel();
    if (el.dataset.signature === signature) return;
    el.dataset.signature = signature;
    el.innerHTML = `
      <section class="vx-card">
        <h3>Course feedback <span class="vx-pill ${state.active ? "" : "vx-good"}">${state.active ? "Working" : "Finished"}</span></h3>
        <div class="vx-progress"><span style="width:${share}%"></span></div>
        <p class="vx-sub">${state.done} of ${state.total} submitted with ${state.rating} ${state.rating === 1 ? "star" : "stars"}</p>
        <ul class="vx-log">${state.log
          .slice(-6)
          .map((l) => `<li class="${l.tone}">${esc(l.text)}</li>`)
          .join("")}</ul>
        <div class="vx-feedback-actions">
          ${
            state.active
              ? `<button type="button" class="vx-btn" data-stop ${state.stopped ? "disabled" : ""}>${state.stopped ? "Stopping…" : "Stop"}</button>`
              : `<button type="button" class="vx-btn" data-close>Close</button>`
          }
        </div>
      </section>`;
  }

  function note(text, tone = "") {
    state.log = [...state.log, { text, tone }].slice(-20);
  }

  async function finish(text, tone) {
    note(text, tone);
    state.active = false;
    await save();
    paintRun();
  }

  async function start(value) {
    const pending = postButtons().length;
    if (!pending || state?.active) return false;
    state = {
      active: true,
      rating: value,
      total: pending,
      pending,
      done: 0,
      phase: "open",
      course: "",
      log: [],
      at: Date.now(),
    };
    await save();
    paintRun();
    step();
    return true;
  }

  async function step() {
    if (!state?.active || stepping) return;
    stepping = true;
    let again = false;
    try {
      again = await advance();
    } finally {
      stepping = false;
    }
    if (again) step();
  }

  async function advance() {
    if (Date.now() - state.at > MAX_AGE) {
      await finish("Stopped: this took too long. Start again to continue.", "vx-warn");
      return false;
    }
    paintRun();

    if (onRatingPage()) {
      if (state.phase !== "submitted") {
        if (state.stopped) {
          await finish("Stopped. Start again to continue with the rest.", "vx-warn");
          return false;
        }
        const picked = selectStars(state.rating);
        const submit = document.querySelector(SAVE) ?? byText("submit")[0];
        if (!picked || !submit) {
          await finish(`${state.course}: no ratings or Submit button found.`, "vx-bad");
          return false;
        }
        state.phase = "submitted";
        await save();
        submit.click();
        await waitFor(() => true, 6000);
        document.querySelector(".sweet-alert.visible button.confirm")?.click();
      }
      if (onRatingPage()) {
        const back = document.querySelector(BACK) ?? byText("back")[0];
        if (!back) return false;
        back.click();
        if (!(await waitFor(() => !onRatingPage(), 8000))) return false;
      }
      return true;
    }

    const buttons = postButtons();
    if (state.phase === "submitted") {
      if (buttons.length >= state.pending) {
        await finish(`${state.course}: VTOP did not accept the submission.`, "vx-bad");
        return false;
      }
      state.done += 1;
      note(`${state.course}: submitted`, "vx-good");
      state.phase = "open";
    }
    state.pending = buttons.length;

    if (!buttons.length) {
      await finish("All feedback submitted.", "vx-good");
      return false;
    }
    if (state.stopped) {
      await finish("Stopped. Start again to continue with the rest.", "vx-warn");
      return false;
    }
    if (state.phase === "opened" && state.course === courseName(buttons[0])) {
      await finish(`${state.course}: the rating page did not open.`, "vx-bad");
      return false;
    }
    state.course = courseName(buttons[0]);
    state.phase = "opened";
    await save();
    paintRun();
    buttons[0].click();
    return Boolean(await waitFor(onRatingPage, 8000));
  }

  function scan() {
    if (!enabled) return closePanel();
    if (state?.active) return step();
    if (state) return paintRun();
    if (onRatingPage()) return offer("rating", ratingGroups().length);
    const pending = postButtons().length;
    if (pending) return offer("list", pending);
    dismissed = "";
    closePanel();
  }

  chrome.runtime?.onMessage?.addListener((message, sender, reply) => {
    if (message?.type !== "vx-feedback-start") return;
    rating = Number(message.rating) || 5;
    if (state?.active) {
      reply({ ok: true, text: "Already filling. Watch the card on the page." });
    } else if (onRatingPage()) {
      reply({ ok: true, text: fillOnly(rating) });
    } else if (postButtons().length) {
      state = null;
      start(rating);
      reply({ ok: true, text: "Started. Keep this tab open until it finishes." });
    } else {
      reply({ ok: false, text: "Open the course feedback list first, then press Start." });
    }
  });

  VXDom.onPageChange(scan);
  chrome.storage.local.get([KEY, "settings"]).then((stored) => {
    state = stored[KEY] ?? null;
    if (state && Date.now() - state.at > MAX_AGE) state = null;
    enabled = stored.settings?.feedback !== false;
    scan();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    enabled = changes.settings.newValue?.feedback !== false;
    scan();
  });
})();
