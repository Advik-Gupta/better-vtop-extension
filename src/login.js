(() => {
  const LINKS = [
    {
      href: "https://cdc-vit.advikgupta.dev/",
      title: "CDC Internship Tracker",
      text: "The 2028 batch internship tracker.",
    },
    {
      href: "https://better-vtop.advikgupta.dev/",
      title: "Better VTOP app",
      text: "A VITian alternative to manage attendance and everything else easily, with more features.",
    },
  ];

  let enabled = true;

  function scan() {
    const existing = document.querySelector(".vx-login-links");
    const form =
      document.querySelector("#vtopLoginForm") ??
      document.querySelector("input[type='password']")?.closest("form");

    if (!enabled || !form || document.querySelector("#vtop-header #vtopHeaderBarControl")) {
      return existing?.remove();
    }
    if (existing) return;

    const box = document.createElement("div");
    box.className = "vx-root vx-login-links";
    box.innerHTML = LINKS.map(
      (l) => `
        <a class="vx-link-card" href="${l.href}" target="_blank" rel="noopener">
          <strong>${VXDom.esc(l.title)} ↗</strong>
          <span>${VXDom.esc(l.text)}</span>
        </a>`,
    ).join("");
    (form.closest(".card") ?? form).after(box);
  }

  VXDom.onPageChange(scan);
  VXDom.onSetting("login", (on) => {
    enabled = on;
    scan();
  });
})();
