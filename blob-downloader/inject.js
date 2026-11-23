// Runs in the page's MAIN world at document_start, in every frame.
// It records blobs handed to URL.createObjectURL and every chunk appended to a
// MediaSource SourceBuffer, so blob: videos can be saved later - even streaming
// (MSE) videos whose blob: URL cannot be fetched, and blobs that were revoked.
(() => {
  'use strict';

  const KEY = '__blobVideoDownloader__';
  if (window[KEY]) return;

  const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // stop capturing MSE data past ~2 GB per frame
  const MAX_BLOBS = 100;
  const MIN_UNTYPED_BLOB = 256 * 1024; // untyped blobs smaller than this are ignored

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;

  let nextId = 1;
  let totalBytes = 0;

  const blobs = new Map(); // id -> { id, url, blob, type, size, created, revoked }
  const blobByUrl = new Map(); // url -> id
  const sources = new Map(); // id -> MediaSource entry
  const sourceByMs = new WeakMap(); // MediaSource -> entry
  const trackBySb = new WeakMap(); // SourceBuffer -> track
  const removedUrls = new Set(); // blob: URLs the user deleted from the list

  const isMediaType = (t) => /^(video|audio)\//i.test(t || '');
  const isUntyped = (t) => !t || /^application\/(octet-stream|binary)/i.test(t);

  function rememberBlob(blob, url) {
    const type = blob.type || '';
    if (!(isMediaType(type) || (isUntyped(type) && blob.size >= MIN_UNTYPED_BLOB))) return;
    const id = 'b' + nextId++;
    blobs.set(id, { id, url, blob, type, size: blob.size, created: Date.now(), revoked: false });
    blobByUrl.set(url, id);
    if (blobs.size > MAX_BLOBS) {
      const oldest = blobs.keys().next().value;
      blobByUrl.delete(blobs.get(oldest).url);
      blobs.delete(oldest);
    }
  }

  function sourceEntry(ms) {
    let entry = sourceByMs.get(ms);
    if (!entry) {
      const id = 'm' + nextId++;
      entry = { id, urls: [], tracks: [], created: Date.now(), ended: false };
      sourceByMs.set(ms, entry);
      sources.set(id, entry);
    }
    return entry;
  }

  // --- URL.createObjectURL / revokeObjectURL -------------------------------
  URL.createObjectURL = function (obj) {
    const url = origCreate.apply(this, arguments);
    try {
      if (obj instanceof Blob) {
        rememberBlob(obj, url);
      } else if (typeof MediaSource !== 'undefined' && obj instanceof MediaSource) {
        sourceEntry(obj).urls.push(url);
      }
    } catch (_) { /* never break the page */ }
    return url;
  };

  URL.revokeObjectURL = function (url) {
    try {
      const id = blobByUrl.get(url);
      if (id && blobs.has(id)) blobs.get(id).revoked = true; // keep the Blob so it stays downloadable
    } catch (_) {}
    return origRevoke.apply(this, arguments);
  };

  // --- MediaSource / SourceBuffer -------------------------------------------
  if (typeof MediaSource !== 'undefined' && typeof SourceBuffer !== 'undefined') {
    const msProto = MediaSource.prototype;
    const sbProto = SourceBuffer.prototype;

    const origAdd = msProto.addSourceBuffer;
    msProto.addSourceBuffer = function (mime) {
      const sb = origAdd.apply(this, arguments);
      try {
        const entry = sourceEntry(this);
        const track = {
          id: entry.id + '-t' + entry.tracks.length,
          mime: String(mime || ''),
          chunks: [],
          bytes: 0,
          truncated: false,
        };
        entry.tracks.push(track);
        trackBySb.set(sb, track);
      } catch (_) {}
      return sb;
    };

    const origAppend = sbProto.appendBuffer;
    sbProto.appendBuffer = function (data) {
      try {
        const track = trackBySb.get(this);
        if (track && data && !track.removed) {
          const view = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          if (totalBytes + view.byteLength <= MAX_TOTAL_BYTES) {
            track.chunks.push(view.slice()); // copy: pages often reuse their buffers
            track.bytes += view.byteLength;
            totalBytes += view.byteLength;
          } else {
            track.truncated = true;
          }
        }
      } catch (_) {}
      return origAppend.apply(this, arguments);
    };

    if (sbProto.changeType) {
      const origChangeType = sbProto.changeType;
      sbProto.changeType = function (mime) {
        try {
          const track = trackBySb.get(this);
          if (track) track.mime = String(mime || track.mime);
        } catch (_) {}
        return origChangeType.apply(this, arguments);
      };
    }

    const origEnd = msProto.endOfStream;
    msProto.endOfStream = function () {
      try { sourceEntry(this).ended = true; } catch (_) {}
      return origEnd.apply(this, arguments);
    };
  }

  // --- API used by the extension popup (via chrome.scripting in MAIN world) --
  const baseMime = (m) => String(m || '').split(';')[0].trim();

  function findTrack(id) {
    for (const entry of sources.values()) {
      const t = entry.tracks.find((x) => x.id === id);
      if (t) return t;
    }
    return null;
  }

  // A removed track stops capturing for good: restarting mid-stream would
  // produce a file without its init segment, which can't be played.
  function removeTrack(entry, track) {
    if (track.removed) return;
    totalBytes -= track.bytes;
    track.chunks = [];
    track.bytes = 0;
    track.removed = true;
    if (entry.tracks.every((t) => t.removed)) entry.urls.forEach((u) => removedUrls.add(u));
  }

  const api = {
    list() {
      return {
        blobs: [...blobs.values()].map(({ id, url, type, size, created, revoked }) =>
          ({ id, url, type, size, created, revoked })),
        sources: [...sources.values()]
          .filter((e) => e.tracks.some((t) => t.bytes > 0 && !t.removed))
          .map((e) => ({
            id: e.id,
            urls: e.urls.slice(),
            created: e.created,
            ended: e.ended,
            tracks: e.tracks.filter((t) => !t.removed).map((t) => ({
              id: t.id, mime: t.mime, bytes: t.bytes, chunks: t.chunks.length, truncated: t.truncated,
            })),
          })),
        removedUrls: [...removedUrls],
      };
    },

    // Delete one blob or one MSE track from the list and free its memory.
    remove(id) {
      if (blobs.has(id)) {
        const b = blobs.get(id);
        blobs.delete(id);
        blobByUrl.delete(b.url);
        removedUrls.add(b.url);
        return true;
      }
      for (const entry of sources.values()) {
        const track = entry.tracks.find((t) => t.id === id);
        if (track) { removeTrack(entry, track); return true; }
      }
      return false;
    },

    // Delete everything captured so far in this frame.
    clear() {
      for (const b of blobs.values()) removedUrls.add(b.url);
      blobs.clear();
      blobByUrl.clear();
      for (const entry of sources.values()) entry.tracks.forEach((t) => removeTrack(entry, t));
    },

    // Returns a Blob for a recorded blob id, a recorded MSE track id, or a blob: URL.
    async getBlob(idOrUrl) {
      if (blobs.has(idOrUrl)) return blobs.get(idOrUrl).blob;
      const byUrl = blobByUrl.get(idOrUrl);
      if (byUrl && blobs.has(byUrl)) return blobs.get(byUrl).blob;
      const track = findTrack(idOrUrl);
      if (track) return new Blob(track.chunks, { type: baseMime(track.mime) });
      if (String(idOrUrl).startsWith('blob:')) {
        const res = await fetch(idOrUrl); // works for plain blobs created before the hook ran
        return await res.blob();
      }
      throw new Error('Video data not found (try reloading the page and playing the video).');
    },

    saveBlob(blob, filename) {
      const url = origCreate.call(URL, blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => origRevoke.call(URL, url), 120000);
    },
  };

  Object.defineProperty(window, KEY, { value: api, enumerable: false, configurable: false, writable: false });
})();
