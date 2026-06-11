// page.js — runs in the MAIN world (the page's own JS context), so the
// DragEvent/DataTransfer it builds are page-native and accepted by the
// editor's drop handler. This mirrors exactly what works in the console.
//
// Activation is gated by the isolated-world content script, which sets
// document.documentElement.dataset.pasteAsBitmap = "on" when this host is
// in the user's destination list.

(function () {
  "use strict";

  const FETCH_REQ = "PAB_fetch_request";
  const FETCH_RES = "PAB_fetch_response";
  let reqId = 0;
  const pending = new Map();

  // Receive fetched bytes from the isolated world.
  window.addEventListener(FETCH_RES, (e) => {
    const { id, ok, type, bytes, error } = e.detail || {};
    const cb = pending.get(id);
    if (!cb) return;
    pending.delete(id);
    cb(ok ? { type, bytes } : { error });
  });

  function fetchViaExtension(url) {
    return new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      window.dispatchEvent(new CustomEvent(FETCH_REQ, { detail: { id, url } }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); resolve({ error: "timeout" }); }
      }, 15000);
    });
  }

  function isActive() {
    return document.documentElement.dataset.pasteAsBitmap === "on";
  }

  // ---- editor drop target (pierces shadow roots) -------------------------
  function findDropTarget() {
    const host = document.querySelector("ew-editor-doc");
    const pm = host && host.shadowRoot && host.shadowRoot.querySelector(".ProseMirror");
    if (pm) return pm;
    const stack = [document];
    while (stack.length) {
      const root = stack.pop();
      const found = root.querySelector && root.querySelector('.ProseMirror, [contenteditable="true"]');
      if (found) return found;
      const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of all) if (el.shadowRoot) stack.push(el.shadowRoot);
    }
    return null;
  }

  function extractImageUrl(html, text) {
    if (html) {
      const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (m) return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
    if (text && /^https?:\/\/\S+$/i.test(text.trim())) return text.trim();
    return null;
  }

  // --- image processing config (tweak here) -------------------------------
  const MAX_EDGE = 2000;        // cap longest edge at this many px (downscale only)
  const JPEG_QUALITY = 0.85;    // 0.85 ≈ visually lossless for photos; raise toward
                                // 0.92 for screenshots/sharp edges, lower for max savings
  const JPEG_BG = "#ffffff";    // fill behind any transparency (JPEG has no alpha)

  // Above this size, the editor's upload has a perceptible wait, so we show the
  // progress toast. (We now process every image, so this is just a UI gate.)
  const LARGE_FILE_BYTES = 1024 * 1024; // 1 MB

  // Compute target dimensions: scale longest edge down to MAX_EDGE, never up.
  function targetSize(w, h) {
    const longest = Math.max(w, h);
    if (longest <= MAX_EDGE) return { w, h };
    const scale = MAX_EDGE / longest;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
  }

  // Process any image blob → resized, compressed JPEG File.
  // Runs fully off the main thread when createImageBitmap + OffscreenCanvas
  // are available, so the progress toast stays smooth.
  async function prepareFile(blob) {
    const file = await toJpeg(blob);
    return { file, converted: true };
  }

  async function toJpeg(blob) {
    if (typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function") {
      try {
        const bmp = await createImageBitmap(blob);
        const { w, h } = targetSize(bmp.width, bmp.height);
        const oc = new OffscreenCanvas(w, h);
        const ctx = oc.getContext("2d");
        ctx.fillStyle = JPEG_BG;            // opaque background for transparency
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bmp, 0, 0, w, h);
        bmp.close && bmp.close();
        const jpeg = await oc.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
        return new File([jpeg], "image.jpg", { type: "image/jpeg" });
      } catch (e) {
        // fall through to the DOM canvas path
      }
    }
    // Fallback: classic <img> + canvas (main thread).
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const { w, h } = targetSize(img.naturalWidth, img.naturalHeight);
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          ctx.fillStyle = JPEG_BG;
          ctx.fillRect(0, 0, w, h);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);
          c.toBlob((jpeg) => {
            URL.revokeObjectURL(url);
            jpeg ? resolve(new File([jpeg], "image.jpg", { type: "image/jpeg" }))
                 : reject(new Error("toBlob null"));
          }, "image/jpeg", JPEG_QUALITY);
        } catch (err) { URL.revokeObjectURL(url); reject(err); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
      img.src = url;
    });
  }

  function dropFile(file, target) {
    const r = target.getBoundingClientRect();
    const mk = (t) => {
      const d = new DataTransfer();
      d.items.add(file);
      return new DragEvent(t, {
        bubbles: true, cancelable: true, composed: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + Math.min(r.height / 2, 40),
        dataTransfer: d,
      });
    };
    target.dispatchEvent(mk("dragenter"));
    target.dispatchEvent(mk("dragover"));
    return !target.dispatchEvent(mk("drop"));
  }

  // ---- visual indicator --------------------------------------------------
  let toastEl = null;
  let toastTimer = null;

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.setAttribute("data-paste-as-bitmap-toast", "");
    Object.assign(toastEl.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "2147483647", // max — sit above editor chrome
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "14px 20px",
      borderRadius: "10px",
      font: "15px/1.3 system-ui, -apple-system, sans-serif",
      color: "#fff",
      background: "rgba(20,20,20,0.92)",
      boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.15s ease",
    });
    const spinner = document.createElement("div");
    spinner.setAttribute("data-pab-spinner", "");
    Object.assign(spinner.style, {
      width: "16px",
      height: "16px",
      border: "2px solid rgba(255,255,255,0.35)",
      borderTopColor: "#fff",
      borderRadius: "50%",
      animation: "pab-spin 0.7s linear infinite",
      flex: "0 0 auto",
    });
    const label = document.createElement("span");
    label.setAttribute("data-pab-label", "");
    toastEl.appendChild(spinner);
    toastEl.appendChild(label);

    // keyframes (injected once)
    if (!document.getElementById("pab-style")) {
      const style = document.createElement("style");
      style.id = "pab-style";
      style.textContent = "@keyframes pab-spin{to{transform:rotate(360deg)}}";
      document.documentElement.appendChild(style);
    }
    document.documentElement.appendChild(toastEl);
    return toastEl;
  }

  function showWorking(text) {
    const t = ensureToast();
    clearTimeout(toastTimer);
    t.querySelector("[data-pab-spinner]").style.display = "block";
    t.querySelector("[data-pab-label]").textContent = text || "Pasting image…";
    t.style.background = "rgba(20,20,20,0.92)";
    t.style.opacity = "1";
  }

  function showDone(text, isError) {
    const t = ensureToast();
    t.querySelector("[data-pab-spinner]").style.display = "none";
    const label = t.querySelector("[data-pab-label]");
    label.textContent = (isError ? "✕ " : "✓ ") + (text || (isError ? "Paste failed" : "Image pasted"));
    t.style.background = isError ? "rgba(150,30,30,0.94)" : "rgba(25,110,60,0.94)";
    t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = "0"; }, isError ? 3500 : 1400);
  }

  // Yield to the browser so a just-changed style actually paints before we
  // begin synchronous heavy work (large-image decode blocks the main thread).
  function nextPaint() {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  }

  document.addEventListener(
    "paste",
    (e) => {
      if (!isActive()) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const target = findDropTarget();
      if (!target) return;

      const imageItem = [...dt.items].find(
        (i) => i.kind === "file" && i.type.startsWith("image/")
      );
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Every image is now resized + recompressed, so there's always work.
          // Show the toast when the source is large enough to take a moment.
          const showProgress = file.size > LARGE_FILE_BYTES;
          if (showProgress) showWorking("Optimizing image…");
          (showProgress ? nextPaint() : Promise.resolve())
            .then(() => prepareFile(file))
            .then(({ file: out }) => {
              dropFile(out, target);
              if (showProgress) showDone("Image pasted", false);
            })
            .catch((err) => {
              console.warn("[Paste As Bitmap] drop failed:", err);
              showDone("Couldn't paste image", true);
            });
          return;
        }
      }

      const url = extractImageUrl(dt.getData("text/html"), dt.getData("text/plain"));
      if (!url) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showWorking("Fetching image…");
      nextPaint()
        .then(() => fetchViaExtension(url))
        .then((resp) => {
          if (!resp || resp.error) {
            console.warn("[Paste As Bitmap] fetch failed:", resp && resp.error);
            showDone("Couldn't fetch image", true);
            return;
          }
          const blob = new Blob([new Uint8Array(resp.bytes)], { type: resp.type });
          showWorking("Optimizing image…");
          return nextPaint()
            .then(() => prepareFile(blob))
            .then(({ file: out }) => {
              dropFile(out, target);
              showDone("Image pasted", false);
            });
        })
        .catch((err) => {
          console.warn("[Paste As Bitmap] drop failed:", err);
          showDone("Couldn't paste image", true);
        });
    },
    true
  );

  console.info("[Paste As Bitmap] page-world handler ready on", location.hostname);
})();
