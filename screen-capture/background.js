// Screen Capture - service worker
// Takes the screenshot, crops it to the selected rectangle, stores it, and handles downloads.

const STORAGE_KEY = 'captures';

// Serialize storage writes so rapid captures don't overwrite each other.
let storageQueue = Promise.resolve();
function updateCaptures(mutator) {
  const run = storageQueue.then(async () => {
    const { [STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
    const next = await mutator(list);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
  storageQueue = run.catch(() => {});
  return run;
}

async function getCaptures() {
  await storageQueue; // see pending writes (e.g. a rename just before a download)
  const {[STORAGE_KEY]: list = [] } = await chrome.storage.local.get(STORAGE_KEY);
  return list;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function captureArea(tab, rect, viewport, page) {
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(await (await fetch(shot)).blob());

  // Map CSS pixels -> screenshot pixels (handles devicePixelRatio and page zoom).
  const sx = bitmap.width / viewport.w;
  const sy = bitmap.height / viewport.h;
  const x = Math.max(0, Math.round(rect.x * sx));
  const y = Math.max(0, Math.round(rect.y * sy));
  const w = Math.max(1, Math.min(bitmap.width - x, Math.round(rect.w * sx)));
  const h = Math.max(1, Math.min(bitmap.height - y, Math.round(rect.h * sy)));

  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close();
  const dataUrl = await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    dataUrl,
    width: w,
    height: h,
    url: page?.url || tab.url || '',
    title: page?.title || tab.title || '',
    createdAt: Date.now(),
  };
  const list = await updateCaptures((l) => [...l, item]);
  return list.length;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Make a user-typed name safe for a file name (Windows is the strictest).
function sanitizeName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.png$/i, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120);
}

function timestamp(d = new Date()) {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

// Custom name if the user gave one, otherwise the current date and time.
// `index` is set for "Download all" so unnamed files keep their list order.
function filenameFor(item, index) {
  const custom = sanitizeName(item.name);
  if (custom) return `Screen Captures/${custom}.png`;
  const suffix = index != null ? `_${index + 1}` : '';
  return `Screen Captures/${timestamp()}${suffix}.png`;
}

// Chrome ignores the `filename` passed to downloads.download() whenever any other
// installed extension listens to onDeterminingFilename (e.g. Image Downloader).
// So we also suggest our own name from that event for downloads we started.
const pendingFilenames = new Map(); // data URL -> filename

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) return; // not ours — leave it alone
  const filename = pendingFilenames.get(item.url) || pendingFilenames.get(item.finalUrl);
  if (!filename) return;
  pendingFilenames.delete(item.url);
  pendingFilenames.delete(item.finalUrl);
  suggest({ filename, conflictAction: 'uniquify' });
});

async function download(item, index) {
  const filename = filenameFor(item, index);
  pendingFilenames.set(item.dataUrl, filename);
  try {
    return await chrome.downloads.download({
      url: item.dataUrl,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  } finally {
    // Drop the entry later in case the filename event never fires for it.
    setTimeout(() => pendingFilenames.delete(item.dataUrl), 10000);
  }
}

async function startSelectionInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'start-selection' });
  } catch {
    // Tab was open before the extension was installed/reloaded — inject now.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'start-selection' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    'capture-area': async () => {
      const count = await captureArea(sender.tab, msg.rect, msg.viewport, msg.page);
      return { count };
    },
    'start-selection-in-tab': async () => {
      await startSelectionInTab(msg.tabId);
      return {};
    },
    rename: async () => {
      await updateCaptures((l) =>
        l.map((c) => (c.id === msg.id ? { ...c, name: String(msg.name || '').trim() } : c)));
      return {};
    },
    download: async () => {
      const list = await getCaptures();
      const item = list.find((c) => c.id === msg.id);
      if (!item) throw new Error('Capture not found');
      await download(item);
      return {};
    },
    'download-all': async () => {
      const list = await getCaptures();
      for (let i = 0; i < list.length; i++) await download(list[i], i);
      return { count: list.length };
    },
    delete: async () => {
      await updateCaptures((l) => l.filter((c) => c.id !== msg.id));
      return {};
    },
    'clear-all': async () => {
      await updateCaptures(() => []);
      return {};
    },
  };

  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  handler()
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // keep the channel open for the async response
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'start-capture' || !tab?.id) return;
  try {
    await startSelectionInTab(tab.id);
  } catch (err) {
    console.warn('Screen Capture: cannot run on this page', err);
  }
});
