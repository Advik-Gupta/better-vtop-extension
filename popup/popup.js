const KEYS = [
  "attendance",
  "home",
  "homeCgpa",
  "header",
  "timetable",
  "assignments",
  "login",
  "autoSemester",
];
const status = document.querySelector("#status");
document.querySelector("#version").textContent = `Version ${chrome.runtime.getManifest().version}`;
const box = (key) => document.querySelector(`#${key}`);

chrome.storage.local.get("settings").then(({ settings = {} }) => {
  for (const key of KEYS) box(key).checked = settings[key] !== false;
});

for (const key of KEYS) {
  box(key).addEventListener("change", async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, [key]: box(key).checked } });
  });
}

document.querySelector("#clear").addEventListener("click", async () => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.clear();
  if (settings) await chrome.storage.local.set({ settings });
  status.textContent = "Cleared. Reload VTOP to start fresh.";
});
