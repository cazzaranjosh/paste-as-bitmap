// options.js
const enabledEl = document.getElementById("enabled");
const destEl = document.getElementById("destinations");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["enabled", "destinations"], (s) => {
  enabledEl.checked = s.enabled !== false; // default on
  const dests = Array.isArray(s.destinations) ? s.destinations : ["da.live"];
  destEl.value = dests.join("\n");
});

document.getElementById("save").addEventListener("click", () => {
  const destinations = destEl.value
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
  chrome.storage.sync.set(
    { enabled: enabledEl.checked, destinations },
    () => {
      statusEl.textContent = "Saved.";
      setTimeout(() => (statusEl.textContent = ""), 1500);
    }
  );
});
