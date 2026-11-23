// Image Downloader - background service worker
// Receives download requests from content.js and saves the image with the requested base
// name + the image's real extension. If an effect is set in the popup, the image is edited
// in the offscreen page first.

importScripts('shared.js');
const { pickExt, isEffectActive, loadSettings } = IDL;

// ---- Original-file downloads --------------------------------------------------------
// Downloads started by us, waiting for Chrome to ask for a filename.
const pendingById = new Map();  // downloadId -> {url, base}
const pendingByUrl = new Map(); // url -> base (in case the filename event fires before download() resolves)
const active = new Map();       // downloadId -> {url, base} until finished (for the fallback)

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  let job = pendingById.get(item.id);
  if (!job && pendingByUrl.has(item.url)) job = { url: item.url, base: pendingByUrl.get(item.url) };
  if (!job) return; // not one of ours: let Chrome / other extensions decide
  pendingById.delete(item.id);
  pendingByUrl.delete(item.url);
  active.set(item.id, job);
  const ext = pickExt(item.mime, item.finalUrl || item.url, item.filename);
  suggest({ filename: `${job.base}.${ext}`, conflictAction: 'uniquify' });
});

// If Chrome's own download fails (e.g. the server refuses requests without the page's
// Referer), fetch the bytes ourselves and save them.
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
  await saveDataUrl(dataUrl, `${base}.${ext}`);
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

const saveDataUrl = (url, filename) =>
  chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });

async function downloadOriginal(url, base) {
  if (url.startsWith('data:')) {
    await saveDataUrl(url, `${base}.${pickExt('', url, '')}`);
    return;
  }
  pendingByUrl.set(url, base);
  try {
    const id = await chrome.downloads.download({ url, conflictAction: 'uniquify', saveAs: false });
    if (pendingByUrl.has(url)) pendingById.set(id, { url, base }); // filename not decided yet
  } catch (e) {
    pendingByUrl.delete(url);
    await downloadViaFetch(url, base); // e.g. a URL Chrome's downloader rejects
  }
}

// ---- Downloads with an effect (via the offscreen page) --------------------------------
let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Apply the chosen effect to an image on a canvas before saving it',
      })
      .finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function downloadWithEffect(url, base, effect) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'image-downloader-offscreen', type: 'apply-effect', url, effect,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Could not apply the effect');
  await saveDataUrl(res.dataUrl, `${base}.${res.ext}`);
}

// ---- Messages from content scripts ---------------------------------------------------------
async function handleDownload({ url, base }) {
  const { effect } = await loadSettings();
  if (isEffectActive(effect)) await downloadWithEffect(url, base, effect);
  else await downloadOriginal(url, base);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'image-downloader:download') return;
  handleDownload(msg).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true; // async response
});

// ---- Toolbar badge: "OFF" when disabled, "FX" when an effect is set --------------------------
async function updateBadge() {
  const { enabled, effect } = await loadSettings();
  const text = !enabled ? 'OFF' : isEffectActive(effect) ? 'FX' : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#1a73e8' : '#5f6368' });
  await chrome.action.setTitle({
    title: !enabled ? 'Image Downloader (off)' : isEffectActive(effect) ? 'Image Downloader (effect on)' : 'Image Downloader',
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.effect)) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);

// ---- Install / update ----------------------------------------------------------------------
// Inject into tabs that were already open, so the buttons appear without reloading the page.
chrome.runtime.onInstalled.addListener(async () => {
  updateBadge();
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['shared.js', 'content.js'] })
      .catch(() => {}); // restricted pages (Web Store, etc.)
  }
});
