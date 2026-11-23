// Image Downloader - offscreen page.
// Fetches an image, draws it on a canvas with the chosen effect and returns the result.
// Runs as an extension page, so cross-site images are fetched without CORS problems and
// the canvas is never "tainted".

const { normalizeEffect, filterString, canonMime, pickExt, CANVAS_MIME, MIME_EXT } = IDL;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'image-downloader-offscreen' || msg.type !== 'apply-effect') return;
  applyEffect(msg.url, msg.effect).then(
    (res) => sendResponse({ ok: true, ...res }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});

async function applyEffect(url, effect) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const srcMime = await detectMime(blob, res.url || url);

  const img = await loadImage(blob);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('Could not decode image');

  const e = normalizeEffect(effect);
  const quarter = e.rotate === 90 || e.rotate === 270;
  const canvas = document.createElement('canvas');
  canvas.width = quarter ? h : w;
  canvas.height = quarter ? w : h;
  const ctx = canvas.getContext('2d');

  // Keep the original format when a canvas can write it; otherwise PNG.
  const outMime = CANVAS_MIME[srcMime] ? srcMime : 'image/png';
  if (outMime === 'image/jpeg') { // JPEG has no transparency: avoid black edges (blur / rotation)
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (e.rotate) ctx.rotate((e.rotate * Math.PI) / 180);
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.filter = filterString(e);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);

  const out = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), outMime, 0.95));

  const ext = outMime === srcMime ? pickExt(srcMime, res.url || url, '') : MIME_EXT[outMime];
  return { dataUrl: await blobToDataUrl(out), ext };
}

// Real format of the file: magic bytes first (servers often send a wrong / generic
// content type), then the content type, then the URL's extension.
async function detectMime(blob, url) {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  const type = canonMime(blob.type);
  if (type.startsWith('image/')) return type;
  return IDL.EXT_MIME[IDL.extFromPath(url)] || type;
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
