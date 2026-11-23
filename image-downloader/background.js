// Image Downloader - background service worker
// Receives download requests from content.js and saves the image with
// the requested base name + the image's real extension.

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/apng': 'apng',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jxl': 'jxl',
  'image/jp2': 'jp2',
  'image/x-portable-pixmap': 'ppm',
};

// extension -> mime (used to check whether the URL's extension agrees with the server's mime)
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
const sameMime = (a, b) => (MIME_ALIAS[a] || a) === (MIME_ALIAS[b] || b);

function extFromPath(str) {
  if (!str) return '';
  let path = str;
  try { path = new URL(str).pathname; } catch (_) { /* plain filename */ }
  const m = /\.([a-z0-9]{2,5})$/i.exec(decodeURIComponentSafe(path.split('/').pop() || ''));
  const ext = m ? m[1].toLowerCase() : '';
  return EXT_MIME[ext] ? ext : '';
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

// Pick the extension the saved file should have.
// Priority: URL extension that matches the real mime (keeps e.g. ".jpeg" as-is)
//           > extension from the real mime > URL extension > Chrome's guess > "jpg".
function pickExt(mime, url, chromeFilename) {
  mime = normMime(mime);
  const urlExt = extFromPath(url);
  if (urlExt && mime && sameMime(EXT_MIME[urlExt], mime)) return urlExt;
  if (MIME_EXT[mime]) return MIME_EXT[mime];
  if (urlExt) return urlExt;
  const chromeExt = extFromPath(chromeFilename);
  if (chromeExt) return chromeExt;
  return 'jpg';
}

function dataUrlMime(url) {
  const m = /^data:([^;,]*)/i.exec(url);
  return m ? m[1] : '';
}

// Downloads started by us, waiting for Chrome to ask for a filename.
const pendingById = new Map();  // downloadId -> {url, base}
const pendingByUrl = new Map(); // url -> base (covers the case where the filename event fires before download() resolves)
const active = new Map();       // downloadId -> {url, base} until finished (for the fallback)

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let job = pendingById.get(item.id);
  if (!job && pendingByUrl.has(item.url)) job = { url: item.url, base: pendingByUrl.get(item.url) };
  if (!job) return; // not one of ours - let Chrome / other extensions decide
  pendingById.delete(item.id);
  pendingByUrl.delete(item.url);
  active.set(item.id, job);
  const ext = pickExt(item.mime, item.finalUrl || item.url, item.filename);
  suggest({ filename: `${job.base}.${ext}`, conflictAction: 'uniquify' });
});

// If Chrome's own download fails (e.g. the server refuses requests without the page's
// Referer), fall back to fetching the bytes ourselves and saving them.
chrome.downloads.onChanged.addListener(async (delta) => {
  const job = active.get(delta.id);
  if (!job || !delta.state) return;
  if (delta.state.current === 'complete') {
    active.delete(delta.id);
  } else if (delta.state.current === 'interrupted') {
    active.delete(delta.id);
    try {
      await downloadViaFetch(job.url, job.base);
      chrome.downloads.erase({ id: delta.id }).catch(() => {});
    } catch (e) {
      console.warn('[Image Downloader] fallback failed', job.url, e);
    }
  }
});

async function downloadViaFetch(url, base) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const ext = pickExt(blob.type || res.headers.get('content-type'), res.url || url, '');
  const dataUrl = await blobToDataUrl(blob);
  await chrome.downloads.download({ url: dataUrl, filename: `${base}.${ext}`, conflictAction: 'uniquify', saveAs: false });
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

async function startDownload({ url, base }) {
  if (url.startsWith('data:')) {
    const ext = pickExt(dataUrlMime(url), '', '');
    await chrome.downloads.download({ url, filename: `${base}.${ext}`, conflictAction: 'uniquify', saveAs: false });
    return;
  }
  pendingByUrl.set(url, base);
  try {
    const id = await chrome.downloads.download({ url, conflictAction: 'uniquify', saveAs: false });
    if (pendingByUrl.has(url)) pendingById.set(id, { url, base }); // filename not decided yet
  } catch (e) {
    pendingByUrl.delete(url);
    await downloadViaFetch(url, base); // e.g. URL scheme Chrome's downloader rejects
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'image-downloader:download') return;
  startDownload(msg).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true; // async response
});

// Inject into tabs that were already open when the extension was installed/updated,
// so the buttons appear without reloading the page.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
      .catch(() => {}); // restricted pages (Web Store, etc.)
  }
});
