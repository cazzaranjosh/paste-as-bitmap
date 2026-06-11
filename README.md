# Paste As Bitmap

A Chrome extension that forces images copied from one website to paste as real
bitmap bytes into another, instead of as a fragile URL reference.

## What it does

When you copy an image and paste it into a destination editor, the clipboard
often carries only a URL (an `<img src="...">` reference). If the source site
goes offline, that reference breaks. This extension intercepts the paste on the
destination site, fetches the actual image bytes (cross-origin, via the
extension's background worker), and re-injects them as a genuine image paste so
the destination stores pixels, not a link.

It only acts when the clipboard has **no** real image bytes already — a normal
bitmap copy passes through untouched.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. (Optional) Click the extension's **Details → Extension options**, or use the
   toolbar popup → "Configure domains…", to restrict it to your destination
   site(s). Leave the list empty to act everywhere.

## Configuration

- **Enabled** — master on/off (toolbar popup or options page).
- **Destination domains** — one per line (subdomains included). Only pastes on
  these domains get rewritten. Source domains need no setup.

## Important caveats

- **Synthetic-paste acceptance.** Most rich editors read `clipboardData.files`
  and accept the re-injected image. A few frameworks reject events where
  `isTrusted === false`. If that happens, the extension falls back to writing
  the real image bytes onto the system clipboard and logs a message — you press
  paste once more and it lands as bytes. Check the destination's behavior first.
- **Source auth / CORS.** The background worker fetches with `credentials:
  "include"`, so session-protected images usually work. Some servers still
  refuse cross-origin or hotlink-protected requests; those can't be fetched.
- **Permissions.** The extension requests `<all_urls>` host access because it
  cannot know your source domains in advance (it must fetch from wherever the
  copied image lives). You can narrow `host_permissions` in `manifest.json` if
  your sources are fixed.

## Files

- `manifest.json` — MV3 manifest
- `background.js` — cross-origin image fetcher (service worker)
- `content.js` — paste interceptor + re-injection
- `options.html` / `options.js` — settings page
- `popup.html` / `popup.js` — toolbar quick toggle
