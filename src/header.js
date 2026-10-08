(() => {
  const LINKS = [
    { key: "home", label: "Home" },
    { key: "attendance", label: "Attendance", url: "academics/common/StudentAttendance" },
    { key: "marks", label: "Marks", url: "examinations/StudentMarkView" },
    { key: "assignments", label: "Digital Assignments", url: "examinations/StudentDA" },
  ];
  const HOME = "#quickLinks a[onclick*='home()']";

  const REMOVED = ["#quickLinks", "#campusEtiquetteBtn", ".navbar-brand ~ .navbar-text"];

  let enabled = true;

  let active = "home";

  const target = (link) =>
    link.url
      ? (document.querySelector(`a[class*="BtnMenu"][data-url="${link.url}"]`) ??
        document.querySelector(`a[data-url="${link.url}"]`))
      : document.querySelector(HOME);

  function scan() {
    const header = document.querySelector("#vtop-header");
    if (!header) return;
    if (!enabled) return unmount(header);

    if (header.dataset.vx) return mark(header);
    const controls = header.querySelector("#vtopHeaderBarControl");
    if (!controls) return;
    header.dataset.vx = "1";

    for (const el of header.querySelectorAll(REMOVED.join(",")))
      el.classList.add("vx-hidden", "vx-bar-removed");

    const nav = document.createElement("div");
    nav.className = "vx-nav";
    for (const link of LINKS) {
      if (!target(link)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = link.label;
      button.dataset.key = link.key;
      button.addEventListener("click", () => VXDom.whenSettled(() => target(link)?.click()));
      nav.append(button);
    }
    controls.prepend(nav);

    const form = header.querySelector("form[action*='logout']");
    if (form) {
      const out = document.createElement("button");
      out.type = "button";
      out.className = "vx-signout";
      out.textContent = "Sign out";
      out.addEventListener("click", () => form.requestSubmit());
      controls.append(out);
    }
    mark(header);
  }

  function mark(header) {
    for (const button of header.querySelectorAll(".vx-nav button")) {
      const on = button.dataset.key === active;
      button.classList.toggle("vx-on", on);
      if (on) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }

  function unmount(header) {
    if (!header.dataset.vx) return;
    delete header.dataset.vx;
    header.querySelectorAll(".vx-nav, .vx-signout").forEach((el) => el.remove());
    header
      .querySelectorAll(".vx-bar-removed")
      .forEach((el) => el.classList.remove("vx-hidden", "vx-bar-removed"));
  }

  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest?.("a[data-url], a[onclick*='home()']");
      if (!link) return;
      active = link.dataset.url
        ? (LINKS.find((l) => l.url === link.dataset.url)?.key ?? "")
        : "home";
      const header = document.querySelector("#vtop-header");
      if (header) mark(header);
    },
    true,
  );

  VXDom.onPageChange(scan);
  VXDom.onSetting("header", (on) => {
    enabled = on;
    scan();
  });
})();
