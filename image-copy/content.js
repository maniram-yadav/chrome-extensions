// Image Copy - content script
// Puts a "copy" and an "add to list" button on the top-right corner of every real image on
// the page (icons, logos, spacers and other small images are skipped). The effect chosen in
// the popup is applied to the copied / saved image.

(() => {
  // A previous copy may still be around after the extension is reloaded: remove it.
  if (window.__imageCopy) {
    try { window.__imageCopy.destroy(); } catch (_) {}
  }

  const { normalizeEffect, isEffectActive, effectLabel, filterString, dataUrlToBlob, blobToDataUrl,
    safeName, DEFAULT_SETTINGS, loadSettings } = globalThis.ICP;

  // ---- Settings ------------------------------------------------------------
  // Starts disabled so nothing flashes on screen before the saved settings are read.
  let settings = { ...DEFAULT_SETTINGS, enabled: false };
  const MIN_SIDE = 80;          // rendered width AND height must be at least this (px)
  const MIN_AREA = 100 * 100;   // rendered area must be at least this (px²)
  const MIN_NATURAL = 64;       // the image file itself must be at least this big (px)
  const BTN = 30;               // button size (px)
  const GAP = 4;                // gap between the two buttons (px)
  const MARGIN = 6;             // gap from the image corner (px)
  const GROUP_W = BTN * 2 + GAP;

  // ---- Overlay (shadow DOM so page CSS can't touch it) --------------------
  const host = document.createElement('image-copy-overlay');
  host.style.cssText =
    'all:initial!important;position:fixed!important;top:0!important;left:0!important;' +
    'width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .group {
        position: fixed; top: 0; left: 0;
        display: none; gap: ${GAP}px;
        pointer-events: none;
      }
      .group.show { display: flex; }
      .btn {
        width: ${BTN}px; height: ${BTN}px;
        display: flex; align-items: center; justify-content: center;
        margin: 0; padding: 0; box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.75); border-radius: 50%;
        background: rgba(20,20,20,.62); color: #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,.45);
        pointer-events: auto; cursor: pointer;
        opacity: .85;
        transition: background .15s, opacity .15s, box-shadow .15s;
        -webkit-tap-highlight-color: transparent;
      }
      .btn:hover { background: #1a73e8; opacity: 1; box-shadow: 0 2px 8px rgba(0,0,0,.55); }
      .btn:active { background: #1557b0; }
      .btn:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
      .btn svg { width: 16px; height: 16px; display: block; pointer-events: none; }
      .btn.busy { cursor: progress; }
      .btn.busy svg { animation: spin .8s linear infinite; }
      .btn.done  { background: #188038; opacity: 1; }
      .btn.error { background: #d93025; opacity: 1; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>`;

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    busy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 6v8"/><path d="M12 18.5v.01"/></svg>',
  };

  const attachHost = () => {
    if (!host.isConnected) (document.documentElement || document).appendChild(host);
  };

  // ---- Tracking ------------------------------------------------------------
  /** @type {Map<HTMLImageElement, {group: HTMLElement, copyBtn: HTMLButtonElement, addBtn: HTMLButtonElement, clips: Element[]}>} */
  const tracked = new Map();

  const srcOf = (img) => img.currentSrc || img.src || '';
  const isSvgSrc = (src) => /^data:image\/svg/i.test(src) || /\.svgz?(?:[?#]|$)/i.test(src);

  function isRealImage(img) {
    const src = srcOf(img);
    if (!src || src === 'about:blank') return false;
    if (!img.complete) return false;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!isSvgSrc(src)) {
      if (!nw || !nh) return false;
      if (nw < MIN_NATURAL || nh < MIN_NATURAL) return false;
    }
    const r = img.getBoundingClientRect();
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
    if (r.width * r.height < MIN_AREA) return false;
    const cs = getComputedStyle(img);
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) return false;
    return true;
  }

  // Ancestors that clip their content, so buttons are hidden for images scrolled out of a box.
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

  const fxSuffix = () => (isEffectActive(settings.effect) ? ` (effect: ${effectLabel(settings.effect)})` : '');
  const IDLE = {
    copy: () => `Copy image${fxSuffix()}`,
    add: () => `Add to list${fxSuffix()}`,
  };

  function makeButton(kind, img, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.dataset.kind = kind;
    btn.title = IDLE[kind]();
    btn.setAttribute('aria-label', kind === 'copy' ? 'Copy image' : 'Add image to list');
    btn.innerHTML = ICONS[kind];
    btn.addEventListener('mouseenter', () => startPreview(img));
    btn.addEventListener('mouseleave', () => stopPreview(img));
    // Keep the page from reacting (links, lightboxes, drag handlers...).
    const swallow = (e) => { e.stopPropagation(); };
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'touchstart', 'touchend']) {
      btn.addEventListener(t, swallow);
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(img, btn);
    });
    return btn;
  }

  function makeGroup(img) {
    const group = document.createElement('div');
    group.className = 'group';
    const copyBtn = makeButton('copy', img, copyImage);
    const addBtn = makeButton('add', img, addImage);
    group.append(copyBtn, addBtn);
    root.appendChild(group);
    return { group, copyBtn, addBtn, clips: [] };
  }

  // ---- Effect preview while hovering a button ----------------------------------
  // Only filter + flip are previewed: rotating would move the image away from the mouse.
  const previews = new Map();
  function startPreview(img) {
    const e = settings.effect;
    if (!isEffectActive(e) || previews.has(img)) return;
    const s = img.style;
    previews.set(img, {
      filter: [s.getPropertyValue('filter'), s.getPropertyPriority('filter')],
      transform: [s.getPropertyValue('transform'), s.getPropertyPriority('transform')],
    });
    const shownScale = img.naturalWidth ? img.getBoundingClientRect().width / img.naturalWidth : 1;
    s.setProperty('filter', filterString(e, shownScale), 'important');
    if (e.flipH || e.flipV) {
      const base = getComputedStyle(img).transform;
      const flip = `scale(${e.flipH ? -1 : 1}, ${e.flipV ? -1 : 1})`;
      s.setProperty('transform', base && base !== 'none' ? `${base} ${flip}` : flip, 'important');
    }
  }
  function stopPreview(img) {
    const saved = previews.get(img);
    if (!saved) return;
    previews.delete(img);
    for (const prop of ['filter', 'transform']) {
      const [value, priority] = saved[prop];
      if (value) img.style.setProperty(prop, value, priority);
      else img.style.removeProperty(prop);
    }
  }
  const stopAllPreviews = () => { for (const img of [...previews.keys()]) stopPreview(img); };

  function untrack(img) {
    const rec = tracked.get(img);
    if (!rec) return;
    stopPreview(img);
    rec.group.remove();
    tracked.delete(img);
  }

  function scan() {
    if (!settings.enabled) {
      for (const img of [...tracked.keys()]) untrack(img);
      host.remove();
      return;
    }
    attachHost();
    const cache = new Map();
    const seen = new Set();
    for (const img of document.images) {
      seen.add(img);
      if (isRealImage(img)) {
        let rec = tracked.get(img);
        if (!rec) { rec = makeGroup(img); tracked.set(img, rec); }
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
    const needW = GROUP_W + MARGIN * 2;
    const needH = BTN + MARGIN * 2;

    for (const [img, rec] of tracked) {
      if (!img.isConnected) { untrack(img); continue; }
      const r = img.getBoundingClientRect();
      let top = Math.max(r.top, 0), left = Math.max(r.left, 0);
      let right = Math.min(r.right, vw), bottom = Math.min(r.bottom, vh);
      for (const c of rec.clips) {
        if (right - left < needW || bottom - top < needH) break;
        const cr = c.getBoundingClientRect();
        top = Math.max(top, cr.top); left = Math.max(left, cr.left);
        right = Math.min(right, cr.right); bottom = Math.min(bottom, cr.bottom);
      }
      if (right - left < needW || bottom - top < needH || r.width === 0) {
        rec.group.classList.remove('show');
        continue;
      }
      rec.group.style.transform = `translate(${Math.round(right - GROUP_W - MARGIN)}px, ${Math.round(top + MARGIN)}px)`;
      rec.group.classList.add('show');
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

  // ---- Getting the image bytes ------------------------------------------------------
  // The pixels as shown, re-encoded as PNG. Throws for cross-site images (tainted canvas).
  function captureRaw(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  // blob: URLs only exist inside this page, so read them here.
  async function sourceUrl(img) {
    const src = srcOf(img);
    if (!src.startsWith('blob:')) return src;
    try {
      return await blobToDataUrl(await (await fetch(src)).blob());
    } catch (_) {
      return captureRaw(img); // URL already revoked by the page
    }
  }

  // Ask the background worker; if it can't load the image (e.g. hotlink protection), retry
  // with the pixels the page has already loaded.
  async function request(type, img, extra = {}) {
    const send = (url) => chrome.runtime.sendMessage({ type, url, ...extra });
    let res = await send(await sourceUrl(img));
    if (!res || !res.ok) {
      let raw = '';
      try { raw = captureRaw(img); } catch (_) { /* cross-site image */ }
      if (raw) res = await send(raw);
    }
    if (!res || !res.ok) throw new Error((res && res.error) || 'Failed');
    return res;
  }

  // ---- Button actions ------------------------------------------------------------------
  function setState(btn, state, title) {
    const kind = btn.dataset.kind;
    btn.classList.remove('busy', 'done', 'error');
    if (state !== 'idle') btn.classList.add(state);
    btn.innerHTML = ICONS[state === 'idle' ? kind : state];
    btn.title = title || IDLE[kind]();
  }

  const errorText = (e, what) => {
    const msg = String((e && e.message) || e);
    if (/context invalidated/i.test(msg)) return 'Extension was reloaded - refresh this page';
    if (/not allowed|denied|permission|focus/i.test(msg)) return `${what} failed: the page did not allow clipboard access (${msg})`;
    return `${what} failed: ${msg}`;
  };

  function copyImage(img, btn) {
    if (btn.classList.contains('busy')) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      setState(btn, 'error', 'Copy is not available on this page (the clipboard needs an https page). Use "Add to list" and copy from the extension.');
      setTimeout(() => setState(btn, 'idle'), 2500);
      return;
    }
    setState(btn, 'busy', isEffectActive(settings.effect) ? 'Applying effect…' : 'Copying…');
    // clipboard.write() must be called right away (during the click); the image is
    // handed over as a promise that resolves once it is ready.
    const png = request('image-copy:copy', img).then((res) => dataUrlToBlob(res.dataUrl));
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': png })])
      .then(() => setState(btn, 'done', 'Copied to clipboard'))
      .catch((e) => setState(btn, 'error', errorText(e, 'Copy')))
      .finally(() => setTimeout(() => setState(btn, 'idle'), 1800));
  }

  async function addImage(img, btn) {
    if (btn.classList.contains('busy')) return;
    setState(btn, 'busy', isEffectActive(settings.effect) ? 'Applying effect…' : 'Adding…');
    try {
      await request('image-copy:add', img, {
        name: safeName(img.getAttribute('alt')) || safeName(img.getAttribute('title')),
        pageUrl: location.href,
      });
      setState(btn, 'done', 'Added to list');
    } catch (e) {
      setState(btn, 'error', errorText(e, 'Add'));
    }
    setTimeout(() => setState(btn, 'idle'), 1800);
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

  document.addEventListener('load', onLoad, true);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('transitionend', onScroll, true);
  document.addEventListener('animationend', onScroll, true);
  window.addEventListener('resize', onResize);

  const posInterval = setInterval(() => { if (!document.hidden) queuePosition(); }, 300);
  const scanInterval = setInterval(() => { if (!document.hidden && settings.enabled) queueScan(0); }, 2000);

  const applySettings = (next) => {
    settings = { enabled: next.enabled !== false, effect: normalizeEffect(next.effect) };
    stopAllPreviews();
    for (const rec of tracked.values()) {
      for (const btn of [rec.copyBtn, rec.addBtn]) {
        if (!btn.classList.contains('busy')) btn.title = IDLE[btn.dataset.kind]();
      }
    }
    scan();
  };
  const onStorage = (changes, area) => {
    if (area !== 'local' || (!changes.enabled && !changes.effect)) return;
    applySettings({
      enabled: changes.enabled ? changes.enabled.newValue : settings.enabled,
      effect: changes.effect ? changes.effect.newValue : settings.effect,
    });
  };
  chrome.storage.onChanged.addListener(onStorage);
  loadSettings().then(applySettings, () => applySettings(DEFAULT_SETTINGS));

  window.__imageCopy = {
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
      try { chrome.storage.onChanged.removeListener(onStorage); } catch (_) {}
      stopAllPreviews();
      host.remove();
      tracked.clear();
    },
  };
})();
