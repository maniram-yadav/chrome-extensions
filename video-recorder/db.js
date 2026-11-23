// Shared IndexedDB helper (used by popup.html and offscreen.html — same extension origin).
const RecDB = (() => {
  const DB_NAME = 'area-video-recorder';
  const STORE = 'recordings';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      const r = fn(store);
      if (r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  return {
    add: (rec) => tx('readwrite', (s) => s.put(rec)),
    get: (id) => tx('readonly', (s) => s.get(id)),
    all: async () => {
      const list = (await tx('readonly', (s) => s.getAll())) || [];
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    rename: async (id, name) => {
      const rec = await tx('readonly', (s) => s.get(id));
      if (!rec) return;
      rec.name = name;
      await tx('readwrite', (s) => s.put(rec));
    },
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
    clear: () => tx('readwrite', (s) => s.clear()),
  };
})();
