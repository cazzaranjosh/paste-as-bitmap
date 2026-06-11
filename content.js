// content.js — ISOLATED world. Two jobs:
//   1. Decide whether this host is an active destination, and expose that to
//      the MAIN-world page.js via a data- attribute (the two worlds share the
//      DOM but not JS variables).
//   2. Bridge cross-origin image fetches: page.js can't call chrome APIs, so
//      it asks via a DOM CustomEvent; we fetch through the background worker
//      and reply with another CustomEvent.

(function () {
  "use strict";

  const FETCH_REQ = "PAB_fetch_request";
  const FETCH_RES = "PAB_fetch_response";

  let settings = { enabled: true, destinations: ["da.live"] };

  function applyActiveFlag() {
    const active = (() => {
      if (!settings.enabled) return false;
      if (!settings.destinations.length) return true;
      const host = location.hostname.toLowerCase();
      return settings.destinations.some((d) => {
        d = d.trim().toLowerCase();
        if (!d) return false;
        d = d.replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "").replace(/^\*\./, "");
        return d && (host === d || host.endsWith("." + d));
      });
    })();
    document.documentElement.dataset.pasteAsBitmap = active ? "on" : "off";
  }

  chrome.storage.sync.get(["enabled", "destinations"], (s) => {
    if (typeof s.enabled === "boolean") settings.enabled = s.enabled;
    if (Array.isArray(s.destinations)) settings.destinations = s.destinations;
    applyActiveFlag();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.destinations) settings.destinations = changes.destinations.newValue || [];
    applyActiveFlag();
  });
  // Set an initial value immediately so early pastes aren't missed.
  applyActiveFlag();

  // Bridge fetches from the page world to the background worker.
  window.addEventListener(FETCH_REQ, (e) => {
    const { id, url } = e.detail || {};
    chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url }, (resp) => {
      const detail = (chrome.runtime.lastError || !resp || !resp.ok)
        ? { id, ok: false, error: chrome.runtime.lastError?.message || (resp && resp.error) }
        : { id, ok: true, type: resp.type, bytes: resp.bytes };
      window.dispatchEvent(new CustomEvent(FETCH_RES, { detail }));
    });
  });
})();
