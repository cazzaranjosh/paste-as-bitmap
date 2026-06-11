// background.js — service worker
// Fetches image bytes cross-origin on behalf of the content script.
// Extension fetches are not bound by page-origin CORS, so this can
// retrieve images the destination page's own JS could not.

// Seed sensible defaults on first install so da.live works out of the box
// without the user configuring anything.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.get(["enabled", "destinations"], (s) => {
      const patch = {};
      if (typeof s.enabled !== "boolean") patch.enabled = true;
      if (!Array.isArray(s.destinations)) patch.destinations = ["da.live"];
      if (Object.keys(patch).length) chrome.storage.sync.set(patch);
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "FETCH_IMAGE") return;

  (async () => {
    try {
      const resp = await fetch(msg.url, {
        // Include cookies in case the source image is behind the user's session.
        credentials: "include",
        redirect: "follow",
      });
      if (!resp.ok) {
        sendResponse({ ok: false, error: `HTTP ${resp.status}` });
        return;
      }
      const contentType = resp.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        // Not actually an image (e.g. an HTML error page). Bail.
        sendResponse({ ok: false, error: `Not an image: ${contentType}` });
        return;
      }
      const buf = await resp.arrayBuffer();
      // Transfer the ArrayBuffer to avoid base64 bloat for large images.
      sendResponse({ ok: true, type: contentType, bytes: Array.from(new Uint8Array(buf)) });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  // Keep the message channel open for the async response.
  return true;
});
