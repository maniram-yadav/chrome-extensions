// Image Downloader - code shared by background, offscreen page, popup and content script.
// Exposed as globalThis.IDL (assigned, not declared, so re-injection is safe).

globalThis.IDL = (() => {
  // ---- Formats ---------------------------------------------------------------
  const MIME_EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg',
    'image/png': 'png', 'image/apng': 'apng', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
    'image/bmp': 'bmp', 'image/x-ms-bmp': 'bmp',
    'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
    'image/tiff': 'tiff', 'image/heic': 'heic', 'image/heif': 'heif',
    'image/jxl': 'jxl', 'image/jp2': 'jp2', 'image/x-portable-pixmap': 'ppm',
  };

  // extension -> mime (to check whether the URL's extension agrees with the real type)
  const EXT_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', pjp: 'image/jpeg',
    png: 'image/png', apng: 'image/apng', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml', svgz: 'image/svg+xml', bmp: 'image/bmp', dib: 'image/bmp',
    ico: 'image/x-icon', cur: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
    heic: 'image/heic', heif: 'image/heif', jxl: 'image/jxl', jp2: 'image/jp2', ppm: 'image/x-portable-pixmap',
  };

  const MIME_ALIAS = {
    'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg',
    'image/vnd.microsoft.icon': 'image/x-icon', 'image/x-ms-bmp': 'image/bmp',
  };
  const normMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
  const canonMime = (m) => MIME_ALIAS[normMime(m)] || normMime(m);

  const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };

  function extFromPath(str) {
    if (!str || /^data:/i.test(str)) return '';
    let path = str;
    try { path = new URL(str).pathname; } catch (_) { /* plain file name */ }
    const m = /\.([a-z0-9]{2,5})$/i.exec(decodeSafe(path.split('/').pop() || ''));
    const ext = m ? m[1].toLowerCase() : '';
    return EXT_MIME[ext] ? ext : '';
  }

  const dataUrlMime = (url) => { const m = /^data:([^;,]*)/i.exec(url || ''); return m ? m[1] : ''; };

  // Extension for the saved file.
  // URL extension that matches the real type (keeps ".jpeg" as ".jpeg") > real type > URL extension
  // > Chrome's guess > "jpg".
  function pickExt(mime, url, fallbackName) {
    mime = canonMime(mime || dataUrlMime(url));
    const urlExt = extFromPath(url);
    if (urlExt && mime && canonMime(EXT_MIME[urlExt]) === mime) return urlExt;
    if (MIME_EXT[mime]) return MIME_EXT[mime];
    if (urlExt) return urlExt;
    return extFromPath(fallbackName) || 'jpg';
  }

  // Formats a canvas can write. Anything else (gif, svg, avif, bmp, ico, tiff...) becomes PNG
  // when an effect is applied.
  const CANVAS_MIME = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

  // ---- Effects ---------------------------------------------------------------
  const DEFAULT_EFFECT = Object.freeze({
    brightness: 100, // %
    contrast: 100,   // %
    saturate: 100,   // %
    grayscale: 0,    // %
    sepia: 0,        // %
    invert: 0,       // %
    hue: 0,          // deg
    blur: 0,         // px (on the full-size image)
    opacity: 100,    // %
    rotate: 0,       // 0 / 90 / 180 / 270
    flipH: false,
    flipV: false,
  });

  const PRESETS = {
    none:      {},
    bw:        { grayscale: 100, contrast: 110 },
    sepia:     { sepia: 100 },
    vintage:   { sepia: 45, contrast: 90, brightness: 105, saturate: 80 },
    vivid:     { saturate: 160, contrast: 115 },
    warm:      { sepia: 25, saturate: 130, hue: -10 },
    cool:      { hue: 190, saturate: 70, brightness: 105 },
    dramatic:  { grayscale: 60, contrast: 150, brightness: 90 },
    invert:    { invert: 100 },
    soft:      { blur: 3, brightness: 105 },
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

  // CSS / canvas filter string. blurScale lets on-page previews scale the blur to the shown size.
  function filterString(e, blurScale = 1) {
    e = normalizeEffect(e);
    const parts = [];
    if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
    if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
    if (e.saturate !== 100) parts.push(`saturate(${e.saturate}%)`);
    if (e.grayscale) parts.push(`grayscale(${e.grayscale}%)`);
    if (e.sepia) parts.push(`sepia(${e.sepia}%)`);
    if (e.invert) parts.push(`invert(${e.invert}%)`);
    if (e.hue) parts.push(`hue-rotate(${e.hue}deg)`);
    if (e.blur) parts.push(`blur(${+(e.blur * blurScale).toFixed(2)}px)`);
    if (e.opacity !== 100) parts.push(`opacity(${e.opacity}%)`);
    return parts.join(' ') || 'none';
  }

  function transformString(e) {
    e = normalizeEffect(e);
    const parts = [];
    if (e.rotate) parts.push(`rotate(${e.rotate}deg)`);
    if (e.flipH || e.flipV) parts.push(`scale(${e.flipH ? -1 : 1}, ${e.flipV ? -1 : 1})`);
    return parts.join(' ') || 'none';
  }

  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, effect: DEFAULT_EFFECT });

  async function loadSettings() {
    const s = await chrome.storage.local.get(['enabled', 'effect']);
    return { enabled: s.enabled !== false, effect: normalizeEffect(s.effect) };
  }

  return {
    MIME_EXT, EXT_MIME, CANVAS_MIME, canonMime, normMime, extFromPath, dataUrlMime, pickExt,
    DEFAULT_EFFECT, PRESETS, DEFAULT_SETTINGS, normalizeEffect, isEffectActive,
    filterString, transformString, loadSettings,
  };
})();
