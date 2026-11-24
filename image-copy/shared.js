// Image Copy - code shared by the background worker, offscreen page, popup and content script.
// Exposed as globalThis.ICP (assigned, not declared, so re-injection is safe).

globalThis.ICP = (() => {
  // ---- Formats ---------------------------------------------------------------
  const MIME_EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/apng': 'apng', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
    'image/x-icon': 'ico', 'image/tiff': 'tiff', 'image/heic': 'heic', 'image/heif': 'heif',
    'image/jxl': 'jxl',
  };
  const EXT_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
    png: 'image/png', apng: 'image/apng', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml', svgz: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl',
  };
  const MIME_ALIAS = {
    'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg',
    'image/vnd.microsoft.icon': 'image/x-icon', 'image/x-ms-bmp': 'image/bmp',
  };
  const normMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
  const canonMime = (m) => MIME_ALIAS[normMime(m)] || normMime(m);

  function extFromPath(str) {
    if (!str || /^data:/i.test(str)) return '';
    let path = str;
    try { path = new URL(str).pathname; } catch (_) { /* plain name */ }
    const m = /\.([a-z0-9]{2,5})$/i.exec(path.split('/').pop() || '');
    const ext = m ? m[1].toLowerCase() : '';
    return EXT_MIME[ext] ? ext : '';
  }

  // Extension for a file of this type (keeps ".jpeg" if the URL used it).
  function pickExt(mime, url) {
    mime = canonMime(mime);
    const urlExt = extFromPath(url);
    if (urlExt && mime && EXT_MIME[urlExt] === mime) return urlExt;
    return MIME_EXT[mime] || urlExt || 'png';
  }

  // Formats a canvas can write. Others become PNG when an effect is applied.
  const CANVAS_MIME = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

  // ---- Effects ---------------------------------------------------------------
  const DEFAULT_EFFECT = Object.freeze({
    brightness: 100, contrast: 100, saturate: 100, // %
    grayscale: 0, sepia: 0, invert: 0,              // %
    hue: 0,                                         // deg
    blur: 0,                                        // px on the full-size image
    opacity: 100,                                   // %
    rotate: 0,                                      // 0 / 90 / 180 / 270
    flipH: false, flipV: false,
  });

  const PRESETS = {
    none:     {},
    bw:       { grayscale: 100, contrast: 110 },
    sepia:    { sepia: 100 },
    vintage:  { sepia: 45, contrast: 90, brightness: 105, saturate: 80 },
    vivid:    { saturate: 160, contrast: 115 },
    warm:     { sepia: 25, saturate: 130, hue: -10 },
    cool:     { hue: 190, saturate: 70, brightness: 105 },
    dramatic: { grayscale: 60, contrast: 150, brightness: 90 },
    invert:   { invert: 100 },
    soft:     { blur: 3, brightness: 105 },
  };
  const PRESET_LABELS = {
    none: 'None', bw: 'B&W', sepia: 'Sepia', vintage: 'Vintage', vivid: 'Vivid',
    warm: 'Warm', cool: 'Cool', dramatic: 'Dramatic', invert: 'Invert', soft: 'Soft',
  };

  function normalizeEffect(e) {
    const out = { ...DEFAULT_EFFECT };
    if (e && typeof e === 'object') {
      for (const k of Object.keys(DEFAULT_EFFECT)) {
        if (typeof DEFAULT_EFFECT[k] === 'boolean') out[k] = !!e[k];
        else if (Number.isFinite(Number(e[k]))) out[k] = Number(e[k]);
      }
    }
    out.rotate = ((Math.round(out.rotate / 90) * 90) % 360 + 360) % 360;
    return out;
  }

  const isEffectActive = (e) => {
    e = normalizeEffect(e);
    return Object.keys(DEFAULT_EFFECT).some((k) => e[k] !== DEFAULT_EFFECT[k]);
  };

  // Short human label, e.g. "Sepia" or "Custom".
  function effectLabel(e) {
    e = normalizeEffect(e);
    if (!isEffectActive(e)) return 'None';
    const colour = Object.keys(PRESETS).find((k) => {
      const p = normalizeEffect({ ...DEFAULT_EFFECT, ...PRESETS[k] });
      return ['brightness', 'contrast', 'saturate', 'grayscale', 'sepia', 'invert', 'hue', 'blur', 'opacity']
        .every((f) => p[f] === e[f]);
    });
    const parts = [];
    if (colour && colour !== 'none') parts.push(PRESET_LABELS[colour]);
    else if (!colour) parts.push('Custom');
    if (e.rotate) parts.push(`${e.rotate}°`);
    if (e.flipH) parts.push('flip H');
    if (e.flipV) parts.push('flip V');
    return parts.join(', ');
  }

  // CSS / canvas filter. blurScale scales the blur to a smaller rendering.
  function filterString(e, blurScale = 1) {
    e = normalizeEffect(e);
    const p = [];
    if (e.brightness !== 100) p.push(`brightness(${e.brightness}%)`);
    if (e.contrast !== 100) p.push(`contrast(${e.contrast}%)`);
    if (e.saturate !== 100) p.push(`saturate(${e.saturate}%)`);
    if (e.grayscale) p.push(`grayscale(${e.grayscale}%)`);
    if (e.sepia) p.push(`sepia(${e.sepia}%)`);
    if (e.invert) p.push(`invert(${e.invert}%)`);
    if (e.hue) p.push(`hue-rotate(${e.hue}deg)`);
    if (e.blur) p.push(`blur(${+(e.blur * blurScale).toFixed(2)}px)`);
    if (e.opacity !== 100) p.push(`opacity(${e.opacity}%)`);
    return p.join(' ') || 'none';
  }

  function transformString(e) {
    e = normalizeEffect(e);
    const p = [];
    if (e.rotate) p.push(`rotate(${e.rotate}deg)`);
    if (e.flipH || e.flipV) p.push(`scale(${e.flipH ? -1 : 1}, ${e.flipV ? -1 : 1})`);
    return p.join(' ') || 'none';
  }

  // Draw an image (img / bitmap of size w×h) on a new canvas with the effect, scaled by `scale`.
  // `background` fills the canvas first (for JPEG, which has no transparency).
  function renderToCanvas(img, w, h, effect, scale = 1, background = '') {
    const e = normalizeEffect(effect);
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    const quarter = e.rotate === 90 || e.rotate === 270;
    const canvas = document.createElement('canvas');
    canvas.width = quarter ? sh : sw;
    canvas.height = quarter ? sw : sh;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (e.rotate) ctx.rotate((e.rotate * Math.PI) / 180);
    ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
    ctx.filter = filterString(e, scale);
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    return canvas;
  }

  const canvasToBlob = (canvas, mime, quality = 0.95) =>
    new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), mime, quality));

  // data: URL -> Blob without fetch() (so a page's CSP can't block it in a content script).
  function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const head = dataUrl.slice(5, comma);
    const mime = head.split(';')[0] || 'application/octet-stream';
    const body = dataUrl.slice(comma + 1);
    if (/;base64/i.test(head)) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // ---- Naming ----------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');
  function dateTimeName(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
           `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  function safeName(text) {
    let s = String(text || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');
    s = Array.from(s).slice(0, 100).join('').trim();
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s += '_';
    return s;
  }

  // ---- Settings --------------------------------------------------------------
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, effect: DEFAULT_EFFECT });
  async function loadSettings() {
    const s = await chrome.storage.local.get(['enabled', 'effect']);
    return { enabled: s.enabled !== false, effect: normalizeEffect(s.effect) };
  }

  // ---- Saved list storage ----------------------------------------------------
  // chrome.storage.local "items" -> [{id, name, mime, ext, width, height, size, effect, pageUrl,
  //   srcUrl, addedAt}] (newest first). Small, so the popup can watch it for changes.
  // The image bytes live in the extension's IndexedDB (background + popup only), so big
  // images are never broadcast to every tab through storage.onChanged.
  //   store "images": {id, data: dataURL (effect applied), thumb: dataURL}
  let dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('image-copy', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('images', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }
  async function dbRun(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode);
      const req = fn(tx.objectStore('images'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
    });
  }
  const db = {
    put: (rec) => dbRun('readwrite', (s) => s.put(rec)),
    get: (id) => dbRun('readonly', (s) => s.get(id)),
    getAll: () => dbRun('readonly', (s) => s.getAll()),
    delete: (id) => dbRun('readwrite', (s) => s.delete(id)),
    clear: () => dbRun('readwrite', (s) => s.clear()),
  };

  return {
    MIME_EXT, EXT_MIME, CANVAS_MIME, canonMime, extFromPath, pickExt,
    DEFAULT_EFFECT, PRESETS, PRESET_LABELS, normalizeEffect, isEffectActive, effectLabel,
    filterString, transformString, renderToCanvas, canvasToBlob, dataUrlToBlob, blobToDataUrl,
    dateTimeName, safeName, DEFAULT_SETTINGS, loadSettings, db,
  };
})();
