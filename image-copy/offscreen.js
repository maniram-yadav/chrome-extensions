// Image Copy - offscreen page.
// Fetches an image, applies the effect on a canvas and returns the result (plus a thumbnail).
// It is an extension page, so images from any site load without CORS problems and the
// canvas is never "tainted".

const { normalizeEffect, isEffectActive, canonMime, pickExt, CANVAS_MIME, MIME_EXT, EXT_MIME, extFromPath,
  renderToCanvas, canvasToBlob, blobToDataUrl } = ICP;

const THUMB = 160; // longest side of list thumbnails (px)

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'image-copy-offscreen' || msg.type !== 'process') return;
  processImage(msg).then(
    (res) => sendResponse({ ok: true, ...res }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});

// forPng: the result must be PNG (the clipboard only takes PNG images).
// thumb: also return a small preview.
async function processImage({ url, effect, forPng, thumb }) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const srcUrl = res.url || url;
  const srcMime = await detectMime(blob, srcUrl);
  const img = await loadImage(blob);
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) { w = 512; h = 512; } // SVG without an intrinsic size
  const e = normalizeEffect(effect);
  const active = isEffectActive(e);

  let out, outMime, ext;
  if (!active && !forPng) {
    out = blob; // untouched original file
    outMime = srcMime;
    ext = pickExt(srcMime, srcUrl);
  } else if (!active && forPng && srcMime === 'image/png') {
    out = blob;
    outMime = 'image/png';
    ext = 'png';
  } else {
    outMime = forPng ? 'image/png' : (CANVAS_MIME[srcMime] ? srcMime : 'image/png');
    const canvas = renderToCanvas(img, w, h, e, 1, outMime === 'image/jpeg' ? '#fff' : '');
    out = await canvasToBlob(canvas, outMime);
    ext = outMime === srcMime ? pickExt(srcMime, srcUrl) : MIME_EXT[outMime];
  }

  const quarter = e.rotate === 90 || e.rotate === 270;
  const result = {
    dataUrl: await blobToDataUrl(out.type === outMime ? out : new Blob([out], { type: outMime })),
    mime: outMime,
    ext,
    width: quarter ? h : w,
    height: quarter ? w : h,
    size: out.size,
  };
  if (thumb) {
    const scale = Math.min(1, THUMB / Math.max(w, h));
    const c = renderToCanvas(img, w, h, e, scale);
    result.thumb = await blobToDataUrl(await canvasToBlob(c, 'image/webp', 0.82));
  }
  return result;
}

// Real format: magic bytes first (servers often send a wrong type), then content type, then URL.
async function detectMime(blob, url) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  const type = canonMime(blob.type);
  if (type.startsWith('image/')) return type;
  return EXT_MIME[extFromPath(url)] || type || 'image/png';
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(objUrl); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Could not decode image')); };
    img.src = objUrl;
  });
}
