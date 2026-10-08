const VXSemester = (() => {
  const KEY = "currentSemester";
  const SELECTS = "select#semesterSubId, select[name='semesterSubId'], select#semSubId";

  let label = "";
  let enabled = true;

  let ready = false;

  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

  function choose(options, name = label) {
    const real = options.filter((o) => o.value);
    const m = name.match(/([A-Z]+?)SEM\s?(\d{4}-\d{2})/i);
    if (m) {
      const season = new RegExp(m[1], "i");
      const hit = real.find((o) => season.test(o.text) && o.text.includes(m[2]));
      if (hit) return hit;
    }
    return real[0] ?? null;
  }

  function remember(name) {
    if (!name || name === label) return;
    label = name;
    chrome.storage.local.set({ [KEY]: name });
    scan();
  }

  function scan() {
    if (!enabled || !ready) return;
    for (const select of document.querySelectorAll(SELECTS)) {
      if (select.dataset.vxSemester || select.closest(".vx-root")) continue;
      if (select.options.length < 2) continue;
      select.dataset.vxSemester = "1";
      if (select.value) continue;
      const option = choose(
        [...select.options].map((o) => ({ value: o.value, text: clean(o.textContent) })),
      );
      if (!option) continue;
      VXDom.whenSettled(() => {
        if (!select.isConnected || select.value) return;
        select.value = option.value;

        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KEY]) label = changes[KEY].newValue ?? "";
    if (changes.settings) {
      enabled = changes.settings.newValue?.autoSemester !== false;
      scan();
    }
  });

  chrome.storage.local.get([KEY, "settings"]).then((stored) => {
    label = stored[KEY] ?? label;
    enabled = stored.settings?.autoSemester !== false;
    ready = true;
    scan();
  });

  return { choose, remember };
})();
