// Screen Capture - content script
// Shows a floating capture button and handles the drag-to-select overlay.
(() => {
  if (window.__screenCaptureExtLoaded) return;
  window.__screenCaptureExtLoaded = true;

  const MIN_SIZE = 5; // px — smaller selections are treated as a cancel

  // ---------- UI (isolated in a shadow root so page CSS can't break it) ----------
  const host = document.createElement('div');
  host.id = 'screen-capture-ext-host';
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }

      .fab {
        position: fixed; right: 18px; bottom: 18px;
        width: 44px; height: 44px; border-radius: 50%;
        border: none; cursor: pointer; pointer-events: auto;
        background: #2563eb; color: #fff;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 14px rgba(0,0,0,.25);
        opacity: .85; transition: transform .15s, opacity .15s;
      }
      .fab:hover { opacity: 1; transform: scale(1.08); }
      .fab[hidden] { display: none; }
      .fab svg { width: 22px; height: 22px; }

      .blur {
        position: fixed; inset: 0; pointer-events: none;
        background: rgba(15, 23, 42, .28);
        backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
      }
      .catcher {
        position: fixed; inset: 0; pointer-events: auto;
        cursor: crosshair; background: transparent;
      }
      .sel {
        position: fixed; pointer-events: none; display: none;
        border: 2px dashed #60a5fa; outline: 1px solid rgba(0,0,0,.35);
      }
      .size {
        position: absolute; left: 0; top: -24px;
        background: #2563eb; color: #fff; font-size: 11px;
        padding: 2px 6px; border-radius: 4px; white-space: nowrap;
      }
      .hint {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        pointer-events: none; background: rgba(15,23,42,.9); color: #fff;
        font-size: 13px; padding: 8px 14px; border-radius: 8px;
      }
      .toast {
        position: fixed; right: 18px; bottom: 72px; pointer-events: none;
        background: rgba(15,23,42,.92); color: #fff; font-size: 13px;
        padding: 8px 12px; border-radius: 8px;
        opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
      .toast.error { background: #b91c1c; }
      [hidden] { display: none !important; }
    </style>

    <button class="fab" title="Capture an area (Alt+Shift+S)" aria-label="Capture an area">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>

    <div class="overlay" hidden>
      <div class="blur"></div>
      <div class="sel"><span class="size"></span></div>
      <div class="hint">Click and drag to select an area &middot; Esc to cancel</div>
      <div class="catcher"></div>
    </div>

    <div class="toast"></div>
  `;

  const fab = root.querySelector('.fab');
  const overlay = root.querySelector('.overlay');
  const blur = root.querySelector('.blur');
  const sel = root.querySelector('.sel');
  const sizeLabel = root.querySelector('.size');
  const hint = root.querySelector('.hint');
  const catcher = root.querySelector('.catcher');
  const toast = root.querySelector('.toast');

  (document.body || document.documentElement).appendChild(host);

  // Floating-button visibility is a user setting (toggled from the popup).
  // Settings (toggled from the popup).
  let autoCopy = true;
  chrome.storage.local.get({ showFab: true, autoCopy: true }, (s) => {
    fab.hidden = !s.showFab;
    autoCopy = s.autoCopy;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.showFab) fab.hidden = !changes.showFab.newValue;
    if (changes.autoCopy) autoCopy = changes.autoCopy.newValue !== false;
  });

  // ---------- Selection mode ----------
  let active = false;
  let start = null;
  let rect = null;

  function startSelection() {
    if (active) return;
    active = true;
    start = rect = null;
    sel.style.display = 'none';
    blur.style.clipPath = '';
    hint.hidden = false;
    overlay.hidden = false;
    fab.style.visibility = 'hidden';
    document.addEventListener('keydown', onKey, true);
  }

  function stopSelection() {
    active = false;
    start = rect = null;
    overlay.hidden = true;
    fab.style.visibility = '';
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopSelection();
    }
  }

  function updateSelection(x, y) {
    const left = Math.max(0, Math.min(start.x, x));
    const top = Math.max(0, Math.min(start.y, y));
    const right = Math.min(window.innerWidth, Math.max(start.x, x));
    const bottom = Math.min(window.innerHeight, Math.max(start.y, y));
    rect = { x: left, y: top, w: right - left, h: bottom - top };

    sel.style.display = 'block';
    sel.style.left = `${left}px`;
    sel.style.top = `${top}px`;
    sel.style.width = `${rect.w}px`;
    sel.style.height = `${rect.h}px`;
    sizeLabel.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
    sizeLabel.style.top = top < 26 ? '4px' : '-24px';
    sizeLabel.style.left = top < 26 ? '4px' : '0';

    // Cut a sharp "window" out of the blur layer over the selected area.
    blur.style.clipPath =
      `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
      `${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
  }

  catcher.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    catcher.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
    hint.hidden = true;
    updateSelection(e.clientX, e.clientY);
  });

  catcher.addEventListener('pointermove', (e) => {
    if (start) updateSelection(e.clientX, e.clientY);
  });

  catcher.addEventListener('pointerup', (e) => {
    if (!start) return;
    updateSelection(e.clientX, e.clientY);
    const finalRect = rect;
    stopSelection();
    if (!finalRect || finalRect.w < MIN_SIZE || finalRect.h < MIN_SIZE) return;
    capture(finalRect);
  });

  // ---------- Capture ----------
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  async function capture(r) {
    // Start the clipboard write now, while the mouse-up still counts as a user
    // gesture; the image is supplied later through a promise.
    let resolveBlob, rejectBlob;
    const blobPromise = new Promise((res, rej) => { resolveBlob = res; rejectBlob = rej; });
    blobPromise.catch(() => {});
    let copyPromise = null;
    if (autoCopy) {
      if (navigator.clipboard && window.ClipboardItem) {
        try {
          copyPromise = navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        } catch (err) {
          copyPromise = Promise.reject(err);
        }
      } else {
        copyPromise = Promise.reject(new Error('not allowed on this page'));
      }
      copyPromise.catch(() => {});
    }

    // Hide all of our UI so it isn't in the screenshot, and let the page repaint.
    host.style.display = 'none';
    await nextFrame();
    await nextFrame();
    await new Promise((res) => setTimeout(res, 60));

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'capture-area',
        rect: r,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        page: { url: location.href, title: document.title },
      });
    } catch (err) {
      res = { ok: false, error: err.message };
    }

    host.style.display = '';

    if (!res || !res.ok) {
      rejectBlob(new Error('capture failed'));
      showToast(`Capture failed: ${(res && res.error) || 'unknown error'}`, true);
      return;
    }

    if (!copyPromise) {
      showToast(`Captured ✓  (${res.count} in list)`);
      return;
    }
    try {
      resolveBlob(dataUrlToBlob(res.dataUrl));
      await copyPromise;
      showToast(`Captured & copied to clipboard ✓  (${res.count} in list)`);
    } catch {
      showToast(`Captured ✓  (${res.count} in list) — couldn't copy here, use Copy in the popup`);
    }
  }

  // Decode locally (no fetch) so strict page CSPs can't block it.
  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: head.match(/data:([^;]+)/)[1] });
  }

  let toastTimer;
  function showToast(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ---------- Triggers ----------
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startSelection();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'start-selection') {
      startSelection();
      sendResponse({ ok: true });
    }
  });
})();
