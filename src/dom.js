const VXDom = (() => {
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const settled = () =>
    !document.querySelector("body > .blockUI, .modal-backdrop, .modal.show") &&
    !document.body.classList.contains("modal-open");

  function whenSettled(task, tries = 0) {
    if (!settled() && tries < 100) return setTimeout(() => whenSettled(task, tries + 1), 100);
    setTimeout(() => (settled() || tries >= 100 ? task() : whenSettled(task, tries + 1)), 150);
  }

  function waitFor(find, timeout = 12_000) {
    return new Promise((resolve) => {
      const started = Date.now();
      let calm = 0;
      (function poll() {
        const hit = settled() && find();
        calm = hit ? calm + 1 : 0;
        if (calm >= 3) return resolve(hit);
        if (Date.now() - started > timeout) return resolve(null);
        setTimeout(poll, 100);
      })();
    });
  }

  function onPageChange(callback) {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        callback();
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function onSetting(name, apply) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) apply(changes.settings.newValue?.[name] !== false);
    });
    chrome.storage.local.get("settings").then(({ settings }) => apply(settings?.[name] !== false));
  }

  document.addEventListener(
    "click",
    (e) => {
      const button = e.target.closest?.("button");
      if (button?.closest(".vx-root, .vx-nav, .vx-signout")) e.preventDefault();
    },
    true,
  );

  return { clean, esc, whenSettled, waitFor, onPageChange, onSetting };
})();
