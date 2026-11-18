// Google Maps Business Scraper - content script.
// Injected into the Google Maps tab when the user clicks "Start" in the popup.
// The popup only injects this after a ping fails, so a stale copy (e.g. after an
// extension reload) is replaced by a fresh one rather than blocking it.
(() => {
  if (window.__gmsStop) window.__gmsStop();

  const KEYS = { items: 'gms_items', query: 'gms_query', status: 'gms_status' };

  const state = {
    running: false,
    detailed: true,
    autoScroll: false,
    query: '',
    items: new Map(), // key -> business record
    queue: [],        // keys waiting for detail scraping
    queued: new Set(),
    processing: false,
    observer: null,
    scanTimer: null,
    scrollTimer: null,
    saveTimer: null,
    lastDetailName: '',
  };

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const clean = (s) =>
    (s || '')
      .replace(/[-]/g, '') // Google icon-font glyphs
      .replace(/\s+/g, ' ')
      .trim();
  const norm = (s) => clean(s).toLowerCase();
  const text = (el) => (el ? clean(el.textContent) : '');
  const digits = (s) => (s || '').replace(/[^\d]/g, '');

  function getSearchQuery() {
    const input = document.querySelector('#searchboxinput, input[name="q"]');
    if (input && input.value.trim()) return input.value.trim();
    const m = location.pathname.match(/\/maps\/search\/([^/@]+)/);
    if (m) {
      try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (_) { /* ignore */ }
    }
    return '';
  }

  function featureIdFromUrl(url) {
    const m = (url || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    return m ? m[1] : '';
  }

  function keyFor(href, name) {
    return featureIdFromUrl(href) || (href || '').split('?')[0] || norm(name);
  }

  function geoFromUrl(url) {
    const out = { latitude: '', longitude: '', cid: '', placeId: '' };
    const ll = (url || '').match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (ll) { out.latitude = ll[1]; out.longitude = ll[2]; }
    const fid = featureIdFromUrl(url);
    if (fid) {
      try { out.cid = BigInt(fid.split(':')[1]).toString(); } catch (_) { /* ignore */ }
    }
    const pid = (url || '').match(/!19s(ChIJ[^!?&]+)/);
    if (pid) out.placeId = decodeURIComponent(pid[1]);
    return out;
  }

  // Merge only non-empty values from src into dst.
  function merge(dst, src) {
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') dst[k] = v;
    }
    return dst;
  }

  // ---------- list card extraction ----------
  function extractCard(link) {
    const card = link.closest('div.Nv2PK') || link.parentElement || link;
    const href = link.href;
    const name = clean(link.getAttribute('aria-label')) || text(card.querySelector('.fontHeadlineSmall, .qBF1Pd'));

    const rec = {
      name,
      rating: text(card.querySelector('span.MW4etd')),
      reviews: digits(text(card.querySelector('span.UY7F9'))),
      phone: text(card.querySelector('span.UsdlK')),
      website: '',
      mapsUrl: href,
    };

    const web = card.querySelector('a[data-value="Website"], a.lcr4fd');
    if (web && web.href && !web.href.includes('google.')) rec.website = web.href;

    // Leaf info lines, e.g. "Restaurant · ₹₹ · 12 Main St" / "Open ⋅ Closes 10 pm · 098765 43210"
    const lines = [...card.querySelectorAll('div.W4Efsd')]
      .filter((d) => !d.querySelector('div.W4Efsd'))
      .filter((d) => !d.querySelector('span.MW4etd, span.ZkP5Je'))
      .map((d) => clean(d.textContent))
      .filter(Boolean);

    if (lines[0]) {
      const parts = lines[0].split(/[·⋅]/).map(clean).filter(Boolean);
      if (parts.length) rec.category = parts[0];
      const addr = parts.slice(1).filter((p) => !/^[₹$€£¥]+$/.test(p) && !/^[₹$€£¥][\d,–\-\s₹$€£¥]+$/.test(p));
      if (addr.length) rec.address = addr[addr.length - 1];
    }
    if (lines[1]) {
      const parts = lines[1].split(/[·⋅]/).map(clean).filter(Boolean);
      const status = parts.filter((p) => p !== rec.phone);
      if (status.length) rec.openStatus = status.join(' · ');
    }

    return merge(rec, geoFromUrl(href));
  }

  // ---------- detail pane extraction ----------
  function findPlacePane(name) {
    const target = norm(name);
    for (const pane of document.querySelectorAll('div[role="main"][aria-label]')) {
      if (norm(pane.getAttribute('aria-label')) === target) return pane;
    }
    for (const h1 of document.querySelectorAll('h1.DUwDvf, div[role="main"] h1')) {
      if (norm(h1.textContent) === target) return h1.closest('div[role="main"]') || document;
    }
    return null;
  }

  function itemValue(pane, selector) {
    const el = pane.querySelector(selector);
    if (!el) return '';
    const inner = el.querySelector('.Io6YTe, .fontBodyMedium');
    if (inner && text(inner)) return text(inner);
    const label = el.getAttribute('aria-label') || '';
    return clean(label.includes(':') ? label.slice(label.indexOf(':') + 1) : label) || text(el);
  }

  function extractHours(pane) {
    const rows = [...pane.querySelectorAll('table tr')]
      .map((tr) => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) return '';
        const day = text(cells[0]);
        const hours = clean(cells[1].getAttribute('aria-label')) || text(cells[1]);
        return day && hours ? `${day}: ${hours}` : '';
      })
      .filter(Boolean);
    if (rows.length) return rows.join(' | ');

    const el = pane.querySelector('.t39EBf[aria-label], [aria-label*="open hours" i]');
    if (el) {
      return clean(el.getAttribute('aria-label'))
        .replace(/\.?\s*(Hide|Show) open hours for the week\.?/i, '')
        .split(/;\s*/)
        .join(' | ');
    }
    return '';
  }

  function extractDetails(pane) {
    const q = (s) => pane.querySelector(s);

    const rec = {
      name: text(q('h1')),
      category: text(q('button.DkEaL')) || text(q('span.DkEaL')),
      rating: text(q('div.F7nice span[aria-hidden="true"]')),
      reviews: '',
      address: itemValue(pane, '[data-item-id="address"]'),
      phone: itemValue(pane, '[data-item-id^="phone:tel:"]'),
      website: '',
      plusCode: itemValue(pane, '[data-item-id="oloc"]'),
      locatedIn: itemValue(pane, '[data-item-id="locatedin"]'),
      hours: extractHours(pane),
      openStatus: text(q('.OMl5r, .ZDu9vd')),
      priceLevel: '',
      description: text(q('.PYvSYb')),
      menuUrl: '',
      bookingUrl: '',
      claimed: '',
    };

    const revEl = q('div.F7nice span[aria-label]');
    if (revEl) rec.reviews = digits(revEl.getAttribute('aria-label'));
    if (!rec.reviews) rec.reviews = digits(text(q('div.F7nice span:last-child')));

    if (!rec.phone) {
      const ph = q('[data-item-id^="phone:tel:"]');
      if (ph) rec.phone = ph.getAttribute('data-item-id').replace('phone:tel:', '');
    }

    const web = q('a[data-item-id="authority"]');
    if (web) rec.website = web.href;

    const price = q('span[aria-label^="Price" i], span.mgr77e');
    if (price) rec.priceLevel = clean(price.getAttribute('aria-label')) || text(price);

    const menu = q('a[data-item-id="menu"]');
    if (menu) rec.menuUrl = menu.href;
    const book = q('a[data-item-id^="action:"]');
    if (book) rec.bookingUrl = book.href;

    // "Claim this business" link only appears on unclaimed listings.
    rec.claimed = q('a[data-item-id="merchant"], a[href*="business.google.com/create"]') ? 'No' : 'Yes';

    return rec;
  }

  async function waitFor(fn, timeout = 10000, interval = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function findLinkByKey(key) {
    for (const a of document.querySelectorAll('a.hfpxzc')) {
      if (keyFor(a.href, a.getAttribute('aria-label')) === key) return a;
    }
    return null;
  }

  async function scrapeDetails(key) {
    const rec = state.items.get(key);
    const link = findLinkByKey(key);
    if (!rec || !link) return;

    // If the same name was just scraped, the old pane would match instantly - give the new one time.
    const sameName = norm(state.lastDetailName) === norm(rec.name);

    link.click();
    if (sameName) await sleep(1500);

    const pane = await waitFor(() => findPlacePane(rec.name), 10000);
    if (!pane) return;

    // Wait for the info rows (address / phone / website) to render.
    await waitFor(() => pane.querySelector('[data-item-id]'), 4000);
    await sleep(400);

    const details = extractDetails(pane);
    merge(rec, details);
    merge(rec, geoFromUrl(location.href));
    rec.detailed = true;
    state.lastDetailName = rec.name;

    // Older layout: opening a place replaces the list - go back to it.
    if (!document.querySelector('div[role="feed"]')) {
      history.back();
      await waitFor(() => document.querySelector('div[role="feed"]'), 8000);
      await sleep(800);
    }
  }

  async function processQueue() {
    if (state.processing) return;
    state.processing = true;
    try {
      while (state.running && state.detailed && state.queue.length) {
        const key = state.queue[0];
        try {
          await scrapeDetails(key);
        } catch (e) {
          console.warn('[GMaps Scraper] detail scrape failed', e);
        }
        state.queue.shift();
        state.queued.delete(key);
        scheduleSave();
        await sleep(rand(700, 1400));
      }
    } finally {
      state.processing = false;
      scheduleSave();
    }
  }

  // ---------- scanning ----------
  function scan() {
    if (!state.running) return;
    let added = 0;

    for (const link of document.querySelectorAll('a.hfpxzc')) {
      const name = clean(link.getAttribute('aria-label'));
      if (!name) continue;
      const key = keyFor(link.href, name);
      const existing = state.items.get(key);
      const card = extractCard(link);

      if (existing) {
        // Fill gaps without overwriting richer detail data.
        for (const [k, v] of Object.entries(card)) if (!existing[k] && v) existing[k] = v;
      } else {
        state.items.set(key, merge({ key, searchQuery: state.query, scrapedAt: new Date().toISOString() }, card));
        added++;
      }
      enqueue(key);
    }

    // Search that resolved straight to a single place (no results list).
    if (!document.querySelector('a.hfpxzc')) {
      const pane = document.querySelector('div[role="main"][aria-label]');
      if (pane && pane.querySelector('[data-item-id="address"], [data-item-id^="phone:tel:"]')) {
        const d = extractDetails(pane);
        if (d.name) {
          const key = keyFor(location.href, d.name);
          const rec = state.items.get(key) || { key, searchQuery: state.query, scrapedAt: new Date().toISOString() };
          if (!state.items.has(key)) added++;
          merge(rec, d);
          merge(rec, geoFromUrl(location.href));
          rec.mapsUrl = rec.mapsUrl || location.href.split('?')[0];
          rec.detailed = true;
          state.items.set(key, rec);
        }
      }
    }

    if (added) scheduleSave();
    processQueue();
  }

  function enqueue(key) {
    if (!state.detailed) return;
    const rec = state.items.get(key);
    if (!rec || rec.detailed || state.queued.has(key)) return;
    state.queued.add(key);
    state.queue.push(key);
  }

  function scheduleScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scan, 400);
  }

  function autoScrollTick() {
    if (!state.running || !state.autoScroll) return;
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return;
    const endReached = feed.querySelector('span.HlvSq') || /reached the end of the list/i.test(feed.textContent.slice(-300));
    if (endReached) {
      clearInterval(state.scrollTimer);
      state.scrollTimer = null;
      return;
    }
    feed.scrollTop = feed.scrollHeight;
  }

  // ---------- persistence ----------
  function statusObj() {
    return {
      running: state.running,
      count: state.items.size,
      pending: state.detailed ? state.queue.length : 0,
      url: location.href,
      updatedAt: Date.now(),
    };
  }

  function save() {
    const items = [...state.items.values()];
    return chrome.storage.local.set({
      [KEYS.items]: items,
      [KEYS.query]: state.query,
      [KEYS.status]: statusObj(),
    });
  }

  function scheduleSave() {
    if (state.saveTimer) return;
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      save().catch(() => {});
    }, 500);
  }

  // ---------- control ----------
  async function start(opts) {
    state.detailed = opts.detailed !== false;
    state.autoScroll = !!opts.autoScroll;

    const query = getSearchQuery();
    const stored = await chrome.storage.local.get([KEYS.items, KEYS.query]);
    const storedItems = stored[KEYS.items] || [];

    state.items.clear();
    state.queue = [];
    state.queued.clear();

    // Same search -> continue the existing dataset; new search -> start fresh.
    if (storedItems.length && (stored[KEYS.query] || '') === query) {
      for (const it of storedItems) state.items.set(it.key, it);
    }
    state.query = query;
    state.running = true;

    for (const key of state.items.keys()) enqueue(key);

    if (!state.observer) {
      state.observer = new MutationObserver(scheduleScan);
    }
    state.observer.observe(document.body, { childList: true, subtree: true });

    clearInterval(state.scrollTimer);
    state.scrollTimer = state.autoScroll ? setInterval(autoScrollTick, 1500) : null;

    scan();
    await save();
    return statusObj();
  }

  async function stop() {
    state.running = false;
    if (state.observer) state.observer.disconnect();
    clearInterval(state.scrollTimer);
    state.scrollTimer = null;
    await save();
    return statusObj();
  }

  async function clearData() {
    state.items.clear();
    state.queue = [];
    state.queued.clear();
    state.query = getSearchQuery();
    await save();
    return statusObj();
  }

  // Lets a freshly injected copy shut this one down.
  window.__gmsStop = () => {
    state.running = false;
    if (state.observer) state.observer.disconnect();
    clearInterval(state.scrollTimer);
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handlers = {
      start: () => start(msg.options || {}),
      stop: () => stop(),
      clear: () => clearData(),
      status: async () => statusObj(),
      query: async () => ({ query: getSearchQuery() }),
    };
    const fn = handlers[msg && msg.cmd];
    if (!fn) return false;
    fn().then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true; // async response
  });
})();
