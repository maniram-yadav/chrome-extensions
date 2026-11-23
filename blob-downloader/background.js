// Watches network traffic for video files (mp4, webm, HLS/DASH manifests, ...)
// so videos that are not in the DOM yet still show up in the popup.
// Results are kept per tab in chrome.storage.session (survives worker restarts).

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|ogv|3gp|ts|m3u8|mpd)$/i;
const MAX_PER_TAB = 150;
const key = (tabId) => 'net_' + tabId;
const hiddenKey = (tabId) => 'hidden_' + tabId; // URLs the user deleted from the popup list

// Serialize writes so concurrent responses don't overwrite each other.
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch((e) => console.warn('[bvd]', e)));

function header(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name);
  return h ? h.value : '';
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const { tabId, url, type, frameId, responseHeaders } = details;
    if (tabId < 0 || !/^https?:/i.test(url)) return;

    if (type === 'main_frame') {
      // New page in this tab: forget what we saw (and hid) on the previous page.
      enqueue(() => chrome.storage.session.remove([key(tabId), hiddenKey(tabId)]));
    }

    let path = '';
    try { path = new URL(url).pathname; } catch (_) { return; }
    const contentType = header(responseHeaders, 'content-type').toLowerCase();
    const extMatch = VIDEO_EXT.test(path);
    const isVideoType = contentType.startsWith('video/') ||
      /mpegurl|dash\+xml/.test(contentType);

    // Media-element requests, or anything that looks like a video file.
    // Plain XHR/fetch with a video content-type are usually streaming segments - skip those.
    const isCandidate = type === 'media' || extMatch || (isVideoType && type !== 'xmlhttprequest');
    if (!isCandidate || contentType.startsWith('audio/') || contentType.startsWith('image/')) return;

    const total = header(responseHeaders, 'content-range').split('/')[1];
    const size = Number(total) || Number(header(responseHeaders, 'content-length')) || 0;

    enqueue(async () => {
      const k = key(tabId);
      const list = (await chrome.storage.session.get(k))[k] || [];
      if (list.some((x) => x.url === url)) return;
      list.push({ url, contentType, size, frameId, type, time: Date.now() });
      if (list.length > MAX_PER_TAB) list.shift();
      await chrome.storage.session.set({ [k]: list });
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => chrome.storage.session.remove([key(tabId), hiddenKey(tabId)]));
});
