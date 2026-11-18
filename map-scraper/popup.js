const KEYS = { items: 'gms_items', query: 'gms_query', status: 'gms_status', options: 'gms_options' };

const COLUMNS = [
  ['name', 'Name'],
  ['category', 'Category'],
  ['rating', 'Rating'],
  ['reviews', 'Reviews'],
  ['phone', 'Phone'],
  ['website', 'Website'],
  ['address', 'Address'],
  ['plusCode', 'Plus Code'],
  ['locatedIn', 'Located In'],
  ['openStatus', 'Open Status'],
  ['hours', 'Opening Hours'],
  ['priceLevel', 'Price Level'],
  ['description', 'Description'],
  ['claimed', 'Claimed'],
  ['menuUrl', 'Menu URL'],
  ['bookingUrl', 'Booking URL'],
  ['latitude', 'Latitude'],
  ['longitude', 'Longitude'],
  ['cid', 'CID'],
  ['placeId', 'Place ID'],
  ['mapsUrl', 'Google Maps URL'],
  ['searchQuery', 'Search Query'],
  ['scrapedAt', 'Scraped At'],
];

const $ = (id) => document.getElementById(id);
const els = {
  badge: $('badge'), count: $('count'), pending: $('pending'), query: $('query'),
  detailed: $('detailed'), autoScroll: $('autoScroll'),
  start: $('start'), stop: $('stop'), exportBtn: $('export'), clear: $('clear'), message: $('message'),
};

function showMessage(msg, isError = false) {
  els.message.textContent = msg;
  els.message.className = 'message' + (isError ? ' error' : '');
}

function render({ items = [], query = '', status = {} }) {
  els.count.textContent = items.length;
  els.pending.textContent = status.running ? status.pending || 0 : 0;
  els.query.textContent = query || '—';
  els.badge.textContent = status.running ? 'Running' : 'Idle';
  els.badge.className = 'badge ' + (status.running ? 'running' : 'idle');
  els.start.hidden = !!status.running;
  els.stop.hidden = !status.running;
  els.exportBtn.disabled = items.length === 0;
}

async function loadAndRender() {
  const data = await chrome.storage.local.get([KEYS.items, KEYS.query, KEYS.status]);
  const status = data[KEYS.status] || {};

  // Verify the scraper is still alive in the tab (page reload kills it).
  if (status.running) {
    const res = await sendToTab({ cmd: 'status' }).catch(() => null);
    if (!res || !res.running) {
      status.running = false;
      await chrome.storage.local.set({ [KEYS.status]: status });
    }
  }
  render({ items: data[KEYS.items] || [], query: data[KEYS.query] || '', status });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isMapsUrl(url) {
  return /^https:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(url || '') || /^https:\/\/maps\.google\.[a-z.]+\//i.test(url || '');
}

async function sendToTab(msg) {
  const tab = await getActiveTab();
  if (!tab || !isMapsUrl(tab.url)) throw new Error('Open Google Maps in this tab first.');
  return chrome.tabs.sendMessage(tab.id, msg);
}

async function ensureInjected() {
  const tab = await getActiveTab();
  if (!tab || !isMapsUrl(tab.url)) throw new Error('Open Google Maps and search for businesses first.');
  const alive = await chrome.tabs.sendMessage(tab.id, { cmd: 'status' }).catch(() => null);
  if (!alive) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  return tab;
}

async function onStart() {
  try {
    await ensureInjected();
    const options = { detailed: els.detailed.checked, autoScroll: els.autoScroll.checked };
    await chrome.storage.local.set({ [KEYS.options]: options });
    const res = await sendToTab({ cmd: 'start', options });
    if (res && res.error) throw new Error(res.error);
    showMessage('Scraping… scroll the results list to load more businesses.');
  } catch (e) {
    showMessage(e.message || String(e), true);
  }
  loadAndRender();
}

async function onStop() {
  try {
    await sendToTab({ cmd: 'stop' });
    showMessage('Stopped. Click Start to resume.');
  } catch (e) {
    showMessage(e.message || String(e), true);
  }
  loadAndRender();
}

async function onClear() {
  try { await sendToTab({ cmd: 'clear' }); } catch (_) { /* scraper not loaded in this tab */ }
  await chrome.storage.local.set({ [KEYS.items]: [] });
  showMessage('Data cleared.');
  loadAndRender();
}

function csvEscape(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(items) {
  const header = COLUMNS.map(([, label]) => csvEscape(label)).join(',');
  const rows = items.map((it) => COLUMNS.map(([key]) => csvEscape(it[key])).join(','));
  return '﻿' + [header, ...rows].join('\r\n'); // BOM so Excel reads UTF-8 correctly
}

function buildFileName(query) {
  const safe = (query || 'google_maps_businesses')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 100) || 'google_maps_businesses';
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${safe}_${date}.csv`;
}

async function onExport() {
  const data = await chrome.storage.local.get([KEYS.items, KEYS.query]);
  const items = data[KEYS.items] || [];
  if (!items.length) return showMessage('Nothing to export yet.', true);

  // Search-bar text captured when scraping started; fall back to the live search bar.
  let query = data[KEYS.query] || '';
  if (!query) {
    const res = await sendToTab({ cmd: 'query' }).catch(() => null);
    if (res && res.query) query = res.query;
  }

  const blob = new Blob([buildCsv(items)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildFileName(query);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showMessage(`Exported ${items.length} businesses to ${a.download}`);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[KEYS.items] || changes[KEYS.status] || changes[KEYS.query])) {
    chrome.storage.local.get([KEYS.items, KEYS.query, KEYS.status]).then((d) =>
      render({ items: d[KEYS.items] || [], query: d[KEYS.query] || '', status: d[KEYS.status] || {} })
    );
  }
});

els.start.addEventListener('click', onStart);
els.stop.addEventListener('click', onStop);
els.exportBtn.addEventListener('click', onExport);
els.clear.addEventListener('click', onClear);

(async () => {
  const { [KEYS.options]: opts } = await chrome.storage.local.get(KEYS.options);
  if (opts) {
    els.detailed.checked = opts.detailed !== false;
    els.autoScroll.checked = !!opts.autoScroll;
  }
  loadAndRender();
})();
