// Image Copy - background service worker.
// - "copy" requests: turns the image into a PNG (with the chosen effect) for the clipboard.
// - "add" requests: applies the effect and stores the image in the saved list.
// - list changes (delete / delete all) go through here too, so they never race with adds.

importScripts('shared.js');
const { isEffectActive, loadSettings, db } = ICP;

// ---- Offscreen page (canvas work) -------------------------------------------------------
let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Apply the chosen effect to an image on a canvas before copying or saving it',
      })
      .finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function processImage(url, effect, opts) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'image-copy-offscreen', type: 'process', url, effect, ...opts,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Could not process the image');
  return res;
}

// ---- List storage (serialised) ------------------------------------------------------------
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

const getItems = async () => (await chrome.storage.local.get('items')).items || [];
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function addItem({ url, name, pageUrl }) {
  const { effect } = await loadSettings();
  const r = await processImage(url, effect, { forPng: false, thumb: true });
  const id = newId();
  const item = {
    id,
    name: name || ICP.dateTimeName(),
    mime: r.mime,
    ext: r.ext,
    width: r.width,
    height: r.height,
    size: r.size,
    effect: isEffectActive(effect) ? ICP.effectLabel(effect) : '',
    pageUrl: pageUrl || '',
    srcUrl: /^data:/i.test(url) ? '' : url,
    addedAt: Date.now(),
  };
  await serial(async () => {
    await db.put({ id, data: r.dataUrl, thumb: r.thumb || r.dataUrl });
    const items = await getItems();
    await chrome.storage.local.set({ items: [item, ...items] });
  });
  return { id };
}

const deleteItem = (id) => serial(async () => {
  const items = await getItems();
  await chrome.storage.local.set({ items: items.filter((i) => i.id !== id) });
  await db.delete(id);
});

const clearItems = () => serial(async () => {
  await chrome.storage.local.set({ items: [] });
  await db.clear();
});

// ---- Messages -------------------------------------------------------------------------------
const HANDLERS = {
  'image-copy:copy': async ({ url }) => {
    const { effect } = await loadSettings();
    const r = await processImage(url, effect, { forPng: true, thumb: false });
    return { dataUrl: r.dataUrl };
  },
  'image-copy:add': (msg) => addItem(msg),
  'image-copy:delete': ({ id }) => deleteItem(id),
  'image-copy:clear': () => clearItems(),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return;
  Promise.resolve()
    .then(() => handler(msg))
    .then(
      (res) => sendResponse({ ok: true, ...(res || {}) }),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
    );
  return true; // async response
});

// ---- Toolbar badge: OFF when disabled, FX when an effect is set ------------------------------
async function updateBadge() {
  const { enabled, effect } = await loadSettings();
  const fx = isEffectActive(effect);
  await chrome.action.setBadgeText({ text: !enabled ? 'OFF' : fx ? 'FX' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#1a73e8' : '#5f6368' });
  await chrome.action.setTitle({
    title: !enabled ? 'Image Copy (off)' : fx ? `Image Copy (effect: ${ICP.effectLabel(effect)})` : 'Image Copy',
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.effect)) updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);

// ---- Install / update: inject into already-open tabs ----------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  updateBadge();
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['shared.js', 'content.js'] })
      .catch(() => {});
  }
});
