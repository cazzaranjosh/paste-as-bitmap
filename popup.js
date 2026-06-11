// popup.js
const enabledEl = document.getElementById("enabled");
const scopeEl = document.getElementById("scope");

chrome.storage.sync.get(["enabled", "destinations"], (s) => {
  enabledEl.checked = s.enabled !== false;
  const d = Array.isArray(s.destinations) ? s.destinations : ["da.live"];
  scopeEl.textContent = d.length
    ? `Active on: ${d.join(", ")}`
    : "Active on all sites";
});

enabledEl.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

document.getElementById("opts").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
