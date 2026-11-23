// Image Downloader - content script
// Puts a download button on the top-right corner of every real image on the page
// (icons, logos, spacers and other small images are skipped).

(() => {
  // A previous copy may still be around after the extension is reloaded: remove it.
  if (window.__imageDownloader) {
    try { window.__imageDownloader.destroy(); } catch (_) {}
  }

  // ---- Settings ------------------------------------------------------------
  const MIN_SIDE = 80;            // rendered width AND height must be at least this (px)
  const MIN_AREA = 100 * 100;     // rendered area must be at least this (px²)
  const MIN_NATURAL = 64;         // the image file itself must be at least this big (px)
  const BTN = 32;                 // button size (px)
  const MARGIN = 6;               // gap from the image corner (px)

  // ---- Overlay (shadow DOM so page CSS can't touch it) --------------------
  const host = document.createElement('image-downloader-overlay');
  host.style.cssText =
    'all:initial!important;position:fixed!important;top:0!important;left:0!important;' +
    'width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .btn {
        position: fixed; top: 0; left: 0;
        width: ${BTN}px; height: ${BTN}px;
        display: none; align-items: center; justify-content: center;
        margin: 0; padding: 0; box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.75); border-radius: 50%;
        background: rgba(20,20,20,.62); color: #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,.45);
        pointer-events: auto; cursor: pointer;
        opacity: .85;
        transition: background .15s, opacity .15s, box-shadow .15s;
        -webkit-tap-highlight-color: transparent;
      }
      .btn.show { display: flex; }
      .btn:hover { background: #1a73e8; opacity: 1; box-shadow: 0 2px 8px rgba(0,0,0,.55); }
      .btn:active { background: #1557b0; }
      .btn:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
      .btn svg { width: 18px; height: 18px; display: block; pointer-events: none; }
      .btn.busy { cursor: progress; }
      .btn.busy svg { animation: spin .8s linear infinite; }
      .btn.done  { background: #188038; opacity: 1; }
      .btn.error { background: #d93025; opacity: 1; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>`;

  const ICONS = {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>',
    busy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 6v8"/><path d="M12 18.5v.01"/></svg>',
  };

  const attachHost = () => {
    if (!host.isConnected) (document.documentElement || document).appendChild(host);
  };

  // ---- Tracking ------------------------------------------------------------
  /** @type {Map<HTMLImageElement, {btn: HTMLButtonElement, clips: Element[]}>} */
  const tracked = new Map();

  const srcOf = (img) => img.currentSrc || img.src || '';
  const isSvgSrc = (src) => /^data:image\/svg/i.test(src) || /\.svgz?(?:[?#]|$)/i.test(src);

  function isRealImage(img) {
    const src = srcOf(img);
    if (!src || src === 'about:blank') return false;
    if (!img.complete) return false;

    // Size of the actual image file (rules out 1x1 trackers, sprites, tiny icons).
    // SVGs may report 0 natural size, so only the rendered size is used for them.
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!isSvgSrc(src)) {
      if (!nw || !nh) return false; // broken image
      if (nw < MIN_NATURAL || nh < MIN_NATURAL) return false;
    }

    // Size it is shown at on the page (rules out icons / avatars / thumbnails-of-icons).
    const r = img.getBoundingClientRect();
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
    if (r.width * r.height < MIN_AREA) return false;

    const cs = getComputedStyle(img);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
    return true;
  }

  // Ancestors that clip their content (overflow != visible), so the button is not
  // shown for images scrolled out of a carousel / scroll box.
  function clipAncestors(img, cache) {
    const out = [];
    for (let el = img.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      let clips = cache.get(el);
      if (clips === undefined) {
        const cs = getComputedStyle(el);
        clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
        cache.set(el, clips);
      }
      if (clips) out.push(el);
    }
    return out;
  }

  function makeButton(img) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.title = 'Download image';
    btn.setAttribute('aria-label', 'Download image');
    btn.innerHTML = ICONS.download;

    // Keep the page from reacting (links, lightboxes, drag handlers...).
    const swallow = (e) => { e.stopPropagation(); };
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'touchstart', 'touchend']) {
      btn.addEventListener(t, swallow);
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadImage(img, btn);
    });
    root.appendChild(btn);
    return btn;
  }

  function untrack(img) {
    const rec = tracked.get(img);
    if (!rec) return;
    rec.btn.remove();
    tracked.delete(img);
  }

  function scan() {
    attachHost();
    const cache = new Map();
    const seen = new Set();
    for (const img of document.images) {
      seen.add(img);
      if (isRealImage(img)) {
        let rec = tracked.get(img);
        if (!rec) {
          rec = { btn: makeButton(img), clips: [] };
          tracked.set(img, rec);
        }
        rec.clips = clipAncestors(img, cache);
      } else {
        untrack(img);
      }
    }
    for (const img of tracked.keys()) if (!seen.has(img)) untrack(img);
    position();
  }

  // ---- Positioning -----------------------------------------------------------
  function position() {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const need = BTN + MARGIN * 2;

    for (const [img, rec] of tracked) {
      if (!img.isConnected) { untrack(img); continue; }
      const r = img.getBoundingClientRect();
      // visible part of the image = image rect ∩ viewport ∩ clipping ancestors
      let top = Math.max(r.top, 0), left = Math.max(r.left, 0);
      let right = Math.min(r.right, vw), bottom = Math.min(r.bottom, vh);
      for (const c of rec.clips) {
        if (right - left < need || bottom - top < need) break;
        const cr = c.getBoundingClientRect();
        top = Math.max(top, cr.top); left = Math.max(left, cr.left);
        right = Math.min(right, cr.right); bottom = Math.min(bottom, cr.bottom);
      }
      if (right - left < need || bottom - top < need || r.width === 0) {
        rec.btn.classList.remove('show');
        continue;
      }
      rec.btn.style.transform = `translate(${Math.round(right - BTN - MARGIN)}px, ${Math.round(top + MARGIN)}px)`;
      rec.btn.classList.add('show');
    }
  }

  let posQueued = false;
  const queuePosition = () => {
    if (posQueued) return;
    posQueued = true;
    requestAnimationFrame(() => { posQueued = false; position(); });
  };

  let scanTimer = 0;
  const queueScan = (delay = 250) => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = 0; scan(); }, delay);
  };

  // ---- Naming --------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  function dateTimeName() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
           `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  function safeName(text) {
    let s = String(text || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ') // illegal in file names
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');                  // no leading/trailing dots or spaces
    s = Array.from(s).slice(0, 120).join('').trim();      // keep emoji / surrogate pairs intact
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s += '_'; // reserved on Windows
    return s;
  }

  const baseNameFor = (img) => safeName(img.getAttribute('alt')) || dateTimeName();

  // ---- Download ------------------------------------------------------------
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

  // blob: URLs only exist inside this page, so read them here and hand the bytes over.
  async function blobUrlToDataUrl(img, src) {
    try {
      const blob = await (await fetch(src)).blob();
      return await blobToDataUrl(blob);
    } catch (_) {
      // URL already revoked by the page: re-encode what is on screen (PNG).
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    }
  }

  function setState(btn, state, title) {
    btn.classList.remove('busy', 'done', 'error');
    if (state !== 'download') btn.classList.add(state);
    btn.innerHTML = ICONS[state];
    btn.title = title || 'Download image';
  }

  async function downloadImage(img, btn) {
    if (btn.classList.contains('busy')) return;
    setState(btn, 'busy', 'Downloading…');
    try {
      let url = srcOf(img);
      if (url.startsWith('blob:')) url = await blobUrlToDataUrl(img, url);
      const res = await chrome.runtime.sendMessage({
        type: 'image-downloader:download',
        url,
        base: baseNameFor(img),
      });
      if (!res || !res.ok) throw new Error((res && res.error) || 'Download failed');
      setState(btn, 'done', 'Downloaded');
    } catch (e) {
      const msg = String((e && e.message) || e);
      setState(btn, 'error', /context invalidated/i.test(msg)
        ? 'Extension was reloaded - refresh this page'
        : `Download failed: ${msg}`);
    }
    setTimeout(() => setState(btn, 'download'), 1800);
  }

  // ---- Wiring ----------------------------------------------------------------
  const mo = new MutationObserver(() => queueScan());
  mo.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'sizes', 'style', 'class', 'hidden', 'width', 'height'],
  });

  const onLoad = (e) => { if (e.target && e.target.tagName === 'IMG') queueScan(50); };
  const onScroll = () => queuePosition();
  const onResize = () => { queuePosition(); queueScan(); };

  document.addEventListener('load', onLoad, true);          // lazy-loaded images
  document.addEventListener('scroll', onScroll, true);      // any scrolling element
  document.addEventListener('transitionend', onScroll, true);
  document.addEventListener('animationend', onScroll, true);
  window.addEventListener('resize', onResize);

  // Safety net for sliders / JS animations that move images without any event.
  const posInterval = setInterval(() => { if (!document.hidden) queuePosition(); }, 300);
  const scanInterval = setInterval(() => { if (!document.hidden) queueScan(0); }, 2000);

  scan();

  window.__imageDownloader = {
    destroy() {
      mo.disconnect();
      clearInterval(posInterval);
      clearInterval(scanInterval);
      clearTimeout(scanTimer);
      document.removeEventListener('load', onLoad, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('transitionend', onScroll, true);
      document.removeEventListener('animationend', onScroll, true);
      window.removeEventListener('resize', onResize);
      host.remove();
      tracked.clear();
    },
  };
})();
