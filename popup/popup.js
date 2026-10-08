const KEYS = [
  "attendance",
  "home",
  "homeCgpa",
  "header",
  "timetable",
  "assignments",
  "marks",
  "feedback",
  "login",
  "captcha",
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

const feedbackStatus = document.querySelector("#feedbackStatus");
document.querySelector("#feedbackStart").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const message = {
    type: "vx-feedback-start",
    rating: Number(document.querySelector("#feedbackRating").value),
  };
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, message);
    feedbackStatus.textContent = reply?.text ?? "Open the course feedback list first.";
    feedbackStatus.className = reply?.ok ? "ok" : "problem";
  } catch {
    feedbackStatus.textContent = "Open the course feedback list on VTOP first, then press Start.";
    feedbackStatus.className = "problem";
  }
});
