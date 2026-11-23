'use strict';

const contentEl = document.getElementById('content');
const noticeEl = document.getElementById('notice');
document.getElementById('refresh').addEventListener('click', scan);

let tab = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MIME_EXT = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/quicktime': 'mov',
  'video/mp2t': 'ts', 'video/ogg': 'ogv', 'video/3gpp': '3gp', 'video/x-flv': 'flv',
  'video/x-msvideo': 'avi', 'video/x-ms-wmv': 'wmv',
  'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac',
  'application/vnd.apple.mpegurl': 'm3u8', 'application/x-mpegurl': 'm3u8', 'audio/mpegurl': 'm3u8',
  'application/dash+xml': 'mpd',
};
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|ogv|3gp|ts|m3u8|mpd)$/i;

const baseMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();

function extFor(mime, url) {
  const fromMime = MIME_EXT[baseMime(mime)];
  if (fromMime) return fromMime;
  try {
    const m = new URL(url).pathname.match(VIDEO_EXT);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return 'mp4';
}

// e.g. "video_2026-11-23_22-15-08"
function timestampName(prefix = 'video') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function formatBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function formatDuration(s) {
  if (!s || !isFinite(s)) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function hostOf(url) {
  try { return new URL(url).host; } catch (_) { return ''; }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------------------
// Injected into every frame (MAIN world). Must be self-contained.
// ---------------------------------------------------------------------------
function scanFrame() {
  const api = window.__blobVideoDownloader__;
  const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|ogv|3gp|ts|m3u8|mpd)$/i;
  const els = [];
  const seen = new Set();
  const add = (o) => {
    if (!o.url || seen.has(o.url) || /^(data|javascript|about):/i.test(o.url)) return;
    seen.add(o.url);
    els.push(o);
  };
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (_) { return ''; } };

  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    root.querySelectorAll('*').forEach((n) => { if (n.shadowRoot) roots.push(n.shadowRoot); });

    root.querySelectorAll('video').forEach((v) => {
      const info = {
        tag: 'video',
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
        duration: isFinite(v.duration) ? v.duration : 0,
        poster: v.poster ? abs(v.poster) : '',
      };
      const srcs = [v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map((s) => s.src)];
      srcs.filter(Boolean).forEach((u) =>
        add({ ...info, url: u.startsWith('blob:') ? u : abs(u), type: '' }));
      if (!srcs.some(Boolean) && v.srcObject) {
        // srcObject = MediaSource (no URL); the hook still captured it if present.
        els.push({ ...info, url: '', srcObject: true });
      }
    });

    root.querySelectorAll('a[href]').forEach((a) => {
      let path = '';
      try { path = new URL(a.href).pathname; } catch (_) { return; }
      if (VIDEO_EXT.test(path)) add({ tag: 'link', url: a.href, text: (a.textContent || '').trim().slice(0, 80) });
    });
  }

  return {
    frameUrl: location.href,
    isTop: window === window.top,
    hooked: !!api,
    data: api ? api.list() : null,
    els,
  };
}

// Injected into one frame (MAIN world) to save a blob / captured stream track.
async function downloadInFrame(target, baseName, mimeExt) {
  try {
    const api = window.__blobVideoDownloader__;
    let blob;
    if (api) {
      blob = await api.getBlob(target);
    } else {
      const res = await fetch(target); // hook missing: only works for plain (non-MSE) blobs
      blob = await res.blob();
    }
    if (!blob || !blob.size) throw new Error('No video data captured yet - play the video first.');
    const type = String(blob.type || '').split(';')[0].toLowerCase();
    const ext = mimeExt[type] || 'mp4';
    const filename = `${baseName}.${ext}`;

    if (api) {
      api.saveBlob(blob, filename);
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }
    return { ok: true, filename, size: blob.size };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return {
      ok: false,
      error: /Failed to fetch|NetworkError/i.test(msg)
        ? 'This is a streaming (MediaSource) blob. Reload the page, play the video, then try again.'
        : msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Scan & build list
// ---------------------------------------------------------------------------
async function scan() {
  contentEl.replaceChildren(el('p', 'empty', 'Scanning page…'));
  noticeEl.hidden = true;

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^(https?|file):/i.test(tab.url || '')) {
    contentEl.replaceChildren(el('p', 'empty', 'This page cannot be scanned (browser or extension page).'));
    return;
  }

  let frames = [];
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: scanFrame,
    });
  } catch (e) {
    contentEl.replaceChildren(el('p', 'empty', 'Could not scan this page: ' + e.message));
    return;
  }

  const netKey = 'net_' + tab.id;
  const network = (await chrome.storage.session.get(netKey))[netKey] || [];

  render(buildItems(frames, network), frames);
}

function buildItems(frames, network) {
  const blobItems = [];
  const otherItems = [];
  const seenUrls = new Set();

  for (const fr of frames) {
    const r = fr.result;
    if (!r) continue;
    const frameId = fr.frameId;
    const frameHost = r.isTop ? '' : hostOf(r.frameUrl);
    const elByUrl = new Map(r.els.filter((x) => x.url).map((x) => [x.url, x]));
    const knownBlobUrls = new Set();

    if (r.data) {
      // Streaming videos (MediaSource) - one item per captured track.
      for (const src of r.data.sources) {
        src.urls.forEach((u) => knownBlobUrls.add(u));
        const elInfo = src.urls.map((u) => elByUrl.get(u)).find(Boolean) ||
          r.els.find((x) => x.srcObject) || {};
        const multi = src.tracks.filter((t) => t.bytes > 0).length > 1;
        for (const t of src.tracks) {
          if (!t.bytes) continue;
          const isAudio = baseMime(t.mime).startsWith('audio/');
          blobItems.push({
            kind: 'mse',
            badge: isAudio ? 'AUDIO' : 'STREAM',
            title: 'Streaming blob video' + (multi ? (isAudio ? ' · audio track' : ' · video track') : ''),
            target: t.id,
            frameId,
            prefix: isAudio ? 'audio' : 'video',
            meta: [
              baseMime(t.mime),
              formatBytes(t.bytes) + (src.ended ? ' (complete)' : ' captured so far'),
              !isAudio && elInfo.width ? `${elInfo.width}×${elInfo.height}` : '',
              formatDuration(elInfo.duration),
              t.truncated ? 'size limit reached' : '',
              frameHost,
            ],
            url: src.urls[0] || '(MediaSource)',
            poster: elInfo.poster,
          });
        }
      }

      // Plain blobs created with URL.createObjectURL(blob).
      for (const b of r.data.blobs) {
        knownBlobUrls.add(b.url);
        const elInfo = elByUrl.get(b.url) || {};
        blobItems.push({
          kind: 'blob',
          badge: 'BLOB',
          title: 'Blob video' + (b.revoked ? ' (revoked, still saved)' : ''),
          target: b.id,
          frameId,
          meta: [
            baseMime(b.type) || 'unknown type',
            formatBytes(b.size),
            elInfo.width ? `${elInfo.width}×${elInfo.height}` : '',
            formatDuration(elInfo.duration),
            frameHost,
          ],
          url: b.url,
          poster: elInfo.poster,
        });
      }
    }

    // DOM elements.
    for (const x of r.els) {
      if (!x.url) continue;
      const meta = [
        x.width ? `${x.width}×${x.height}` : '',
        formatDuration(x.duration),
        x.tag === 'link' ? 'link' + (x.text ? `: ${x.text}` : '') : '',
        frameHost,
      ];
      if (x.url.startsWith('blob:')) {
        if (knownBlobUrls.has(x.url)) continue;
        // Blob that the hook didn't see (page loaded before the extension).
        blobItems.push({
          kind: 'blob', badge: 'BLOB', title: 'Blob video (not captured)', target: x.url, frameId,
          meta, url: x.url, poster: x.poster, unhooked: true,
        });
      } else if (!seenUrls.has(x.url)) {
        seenUrls.add(x.url);
        otherItems.push(directItem(x.url, '', 0, meta, x.poster));
      }
    }
  }

  // Network-detected videos.
  for (const n of network) {
    if (seenUrls.has(n.url)) continue;
    seenUrls.add(n.url);
    otherItems.push(directItem(n.url, n.contentType, n.size, ['seen in network'], ''));
  }

  return { blobItems, otherItems };
}

function directItem(url, contentType, size, meta, poster) {
  const ext = extFor(contentType, url);
  const isManifest = ext === 'm3u8' || ext === 'mpd';
  return {
    kind: 'direct',
    badge: ext.toUpperCase(),
    stream: isManifest,
    title: isManifest ? 'Stream playlist (manifest file only)' : 'Video file',
    url,
    ext,
    meta: [baseMime(contentType), formatBytes(size), ...meta],
    poster,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render({ blobItems, otherItems }, frames) {
  contentEl.replaceChildren();

  const notices = [];
  if (frames.some((f) => f.result && !f.result.hooked)) {
    notices.push('Some frames were loaded before the extension was active. Reload the page to capture blob / streaming videos.');
  }
  if (blobItems.some((i) => i.kind === 'mse')) {
    notices.push('Streaming videos are captured while they play. Play the video to the end (without seeking) to get the full file. Video and audio may be separate tracks.');
  }
  if (notices.length) {
    noticeEl.replaceChildren(...notices.map((t) => el('div', '', t)));
    noticeEl.hidden = false;
  }

  if (!blobItems.length && !otherItems.length) {
    contentEl.append(el('p', 'empty', 'No videos found on this page. Try playing the video, then press Refresh.'));
    return;
  }
  section('Blob videos', blobItems);
  section('Other videos', otherItems);
}

function section(title, items) {
  if (!items.length) return;
  const h = el('h2', '', title);
  h.append(el('span', 'count', String(items.length)));
  contentEl.append(h);
  items.forEach((item) => contentEl.append(row(item)));
}

function row(item) {
  const btn = el('button', 'item');
  btn.type = 'button';

  const thumb = el('div', 'thumb ' + (item.stream ? 'stream' : item.kind), item.badge);
  if (item.poster) {
    thumb.style.backgroundImage = `url("${item.poster.replace(/"/g, '%22')}")`;
    thumb.textContent = '';
  }

  const info = el('div', 'info');
  info.append(el('div', 'title', item.title));
  const meta = item.meta.filter(Boolean).join(' · ');
  if (meta) info.append(el('div', 'meta', meta));
  info.append(el('div', 'url', item.url));
  info.title = item.url;

  const status = el('div', 'status', 'Download');
  btn.append(thumb, info, status);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.className = 'status';
    status.textContent = 'Saving…';
    info.querySelector('.error-text')?.remove();

    const res = await download(item);
    if (res.ok) {
      status.className = 'status ok';
      status.textContent = 'Saved ✓';
      info.querySelector('.url').textContent = res.filename;
    } else {
      status.className = 'status err';
      status.textContent = 'Failed';
      info.append(el('div', 'error-text', res.error));
    }
    btn.disabled = false;
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
async function download(item) {
  if (item.kind === 'direct') {
    const filename = `${timestampName()}.${item.ext}`;
    try {
      await chrome.downloads.download({ url: item.url, filename, conflictAction: 'uniquify' });
      return { ok: true, filename };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [item.frameId] },
      world: 'MAIN',
      func: downloadInFrame,
      args: [item.target, timestampName(item.prefix || 'video'), MIME_EXT],
    });
    return res.result || { ok: false, error: 'No response from page.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

scan();
