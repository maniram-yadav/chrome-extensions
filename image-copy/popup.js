// Image Copy - popup: on/off switch, saved image list, and the effect applied on copy / add.

const { DEFAULT_EFFECT, PRESETS, PRESET_LABELS, normalizeEffect, isEffectActive, effectLabel,
  filterString, transformString, dataUrlToBlob, canvasToBlob, safeName, loadSettings, db } = ICP;

const $ = (id) => document.getElementById(id);

// ============================================================================
// Toast
// ============================================================================
let toastTimer = 0;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 3500 : 1600);
}

// ============================================================================
// On / off
// ============================================================================
const enabledEl = $('enabled');
function renderEnabled() {
  const on = enabledEl.checked;
  $('stateText').textContent = on ? 'On: buttons shown on page images' : 'Off: no buttons on pages';
  $('stateText').classList.toggle('off', !on);
}
enabledEl.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
  renderEnabled();
});

// ============================================================================
// Tabs
// ============================================================================
function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  $('listPanel').hidden = name !== 'list';
  $('effectPanel').hidden = name !== 'effect';
}
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showTab(t.dataset.tab));
$('fxChip').addEventListener('click', () => showTab('effect'));

// ============================================================================
// Saved list
// ============================================================================
const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6v8"/><path d="M12 18.5v.01"/></svg>',
};

let items = [];
const thumbs = new Map(); // id -> thumbnail data URL

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function flash(btn, state) {
  const kind = btn.dataset.kind;
  btn.classList.remove('done', 'error');
  btn.classList.add(state);
  btn.innerHTML = ICONS[state];
  setTimeout(() => { btn.classList.remove(state); btn.innerHTML = ICONS[kind]; }, 1400);
}

function iconButton(kind, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `icon${kind === 'delete' ? ' del' : ''}`;
  b.dataset.kind = kind;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = ICONS[kind];
  b.addEventListener('click', () => onClick(b));
  return b;
}

function renderList() {
  const list = $('list');
  list.textContent = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'item';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    if (thumbs.has(item.id)) img.src = thumbs.get(item.id);
    thumb.appendChild(img);

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name;
    name.title = item.name;
    const meta1 = document.createElement('div');
    meta1.className = 'meta';
    meta1.textContent = `${item.width}×${item.height} · ${String(item.ext).toUpperCase()} · ${fmtSize(item.size)}`;
    const meta2 = document.createElement('div');
    meta2.className = 'meta';
    if (item.effect) {
      const fx = document.createElement('span');
      fx.className = 'fx';
      fx.textContent = `${item.effect} · `;
      meta2.appendChild(fx);
    }
    const host = hostOf(item.pageUrl);
    if (host) {
      const a = document.createElement('a');
      a.href = item.pageUrl;
      a.textContent = host;
      a.title = item.pageUrl;
      a.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: item.pageUrl }); });
      meta2.append(a, ` · `);
    }
    meta2.append(ago(item.addedAt));
    info.append(name, meta1, meta2);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      iconButton('copy', 'Copy to clipboard', (b) => copyItem(item, b)),
      iconButton('download', 'Download', (b) => downloadItem(item, b)),
      iconButton('delete', 'Delete', () => deleteItem(item)),
    );

    li.append(thumb, info, actions);
    list.appendChild(li);
  }

  $('count').textContent = items.length;
  $('empty').hidden = items.length > 0;
  list.hidden = items.length === 0;
  $('deleteAll').disabled = items.length === 0;
  const total = items.reduce((n, i) => n + (i.size || 0), 0);
  $('totalSize').textContent = items.length ? `${items.length} image${items.length > 1 ? 's' : ''} · ${fmtSize(total)}` : '';
}

async function loadThumbs() {
  const missing = items.filter((i) => !thumbs.has(i.id));
  if (!missing.length) return;
  if (missing.length > 5) {
    for (const rec of await db.getAll()) thumbs.set(rec.id, rec.thumb);
  } else {
    for (const i of missing) {
      const rec = await db.get(i.id);
      if (rec) thumbs.set(i.id, rec.thumb);
    }
  }
}

let refreshSeq = 0;
async function refreshList(next) {
  const seq = ++refreshSeq;
  const list = Array.isArray(next) ? next : ((await chrome.storage.local.get('items')).items || []);
  if (seq !== refreshSeq) return; // a newer change arrived meanwhile
  items = list;
  const ids = new Set(items.map((i) => i.id));
  for (const id of [...thumbs.keys()]) if (!ids.has(id)) thumbs.delete(id);
  try { await loadThumbs(); } catch (e) { console.warn('[Image Copy] thumbnails', e); }
  if (seq === refreshSeq) renderList();
}

async function getFull(item) {
  const rec = await db.get(item.id);
  if (!rec || !rec.data) throw new Error('Image data is missing');
  return rec.data;
}

// Any image blob -> PNG blob (the clipboard only takes PNG).
function toPng(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 512;
        c.height = img.naturalHeight || 512;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(await canvasToBlob(c, 'image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
    img.src = url;
  });
}

function copyItem(item, btn) {
  // write() is called immediately (still inside the click); the PNG follows as a promise.
  const png = getFull(item).then((data) => {
    const blob = dataUrlToBlob(data);
    return blob.type === 'image/png' ? blob : toPng(blob);
  });
  navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
    () => { flash(btn, 'done'); toast('Copied to clipboard'); },
    (e) => { flash(btn, 'error'); toast(`Copy failed: ${e.message || e}`, true); }
  );
}

async function downloadItem(item, btn) {
  try {
    const data = await getFull(item);
    const base = safeName(item.name) || 'image';
    await chrome.downloads.download({ url: data, filename: `${base}.${item.ext || 'png'}`, conflictAction: 'uniquify', saveAs: false });
    flash(btn, 'done');
    toast('Download started');
  } catch (e) {
    flash(btn, 'error');
    toast(`Download failed: ${e.message || e}`, true);
  }
}

async function send(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Failed');
}

async function deleteItem(item) {
  try { await send('image-copy:delete', { id: item.id }); }
  catch (e) { toast(`Delete failed: ${e.message || e}`, true); }
}

// "Delete all" asks for a second click to confirm.
const delAll = $('deleteAll');
let confirmTimer = 0;
function resetDeleteAll() {
  clearTimeout(confirmTimer);
  delAll.classList.remove('confirm');
  delAll.textContent = 'Delete all';
}
delAll.addEventListener('click', async () => {
  if (!delAll.classList.contains('confirm')) {
    delAll.classList.add('confirm');
    delAll.textContent = `Delete ${items.length}? Click again`;
    confirmTimer = setTimeout(resetDeleteAll, 3000);
    return;
  }
  resetDeleteAll();
  try { await send('image-copy:clear'); toast('All images deleted'); }
  catch (e) { toast(`Delete failed: ${e.message || e}`, true); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.items) refreshList(changes.items.newValue || []);
  if (changes.enabled) { enabledEl.checked = changes.enabled.newValue !== false; renderEnabled(); }
});

// ============================================================================
// Effect editor
// ============================================================================
const SLIDERS = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
  { key: 'contrast',   label: 'Contrast',   min: 0, max: 200, unit: '%' },
  { key: 'saturate',   label: 'Saturation', min: 0, max: 300, unit: '%' },
  { key: 'grayscale',  label: 'Grayscale',  min: 0, max: 100, unit: '%' },
  { key: 'sepia',      label: 'Sepia',      min: 0, max: 100, unit: '%' },
  { key: 'invert',     label: 'Invert',     min: 0, max: 100, unit: '%' },
  { key: 'hue',        label: 'Hue',        min: -180, max: 180, unit: '°' },
  { key: 'blur',       label: 'Blur',       min: 0, max: 20, step: 0.5, unit: 'px' },
  { key: 'opacity',    label: 'Opacity',    min: 0, max: 100, unit: '%' },
];

// Built-in sample picture for previewing the effect.
const SAMPLE = 'data:image/svg+xml,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4f9de8"/><stop offset="1" stop-color="#ffd59e"/></linearGradient></defs>
  <rect width="240" height="140" fill="url(#sky)"/>
  <circle cx="178" cy="42" r="20" fill="#ffcf33"/>
  <path d="M0 110 L55 52 L100 96 L140 60 L240 118 V140 H0Z" fill="#3f7d4e"/>
  <path d="M0 125 Q60 105 120 124 T240 120 V140 H0Z" fill="#2c5e8f"/>
  <rect x="24" y="92" width="16" height="22" fill="#c0392b"/><path d="M20 94 L32 82 L44 94Z" fill="#7b241c"/>
</svg>`);

const previewImg = $('previewImg');
previewImg.src = SAMPLE;

let effect = { ...DEFAULT_EFFECT };
const sliderEls = {};
const fmt = (v, unit) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;

for (const s of SLIDERS) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="label">${s.label}</span>
    <input type="range" min="${s.min}" max="${s.max}" step="${s.step || 1}">
    <span class="value"></span>`;
  const input = row.querySelector('input');
  const value = row.querySelector('.value');
  input.addEventListener('input', () => {
    effect[s.key] = Number(input.value);
    value.textContent = fmt(effect[s.key], s.unit);
    changed();
  });
  input.addEventListener('change', flushSave);
  input.addEventListener('dblclick', () => { effect[s.key] = DEFAULT_EFFECT[s.key]; changed(true); });
  sliderEls[s.key] = { input, value, unit: s.unit };
  $('sliders').appendChild(row);
}

for (const [key, label] of Object.entries(PRESET_LABELS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.preset = key;
  b.addEventListener('click', () => {
    // presets replace the colour settings but keep rotate / flip
    effect = normalizeEffect({ ...DEFAULT_EFFECT, ...PRESETS[key], rotate: effect.rotate, flipH: effect.flipH, flipV: effect.flipV });
    changed(true);
  });
  $('presets').appendChild(b);
}

$('rotL').addEventListener('click', () => { effect.rotate = (effect.rotate + 270) % 360; changed(true); });
$('rotR').addEventListener('click', () => { effect.rotate = (effect.rotate + 90) % 360; changed(true); });
$('flipH').addEventListener('click', () => { effect.flipH = !effect.flipH; changed(true); });
$('flipV').addEventListener('click', () => { effect.flipV = !effect.flipV; changed(true); });
$('reset').addEventListener('click', () => { effect = { ...DEFAULT_EFFECT }; changed(true); });

function renderEffect(updateSliders) {
  if (updateSliders) {
    for (const s of SLIDERS) {
      const el = sliderEls[s.key];
      el.input.value = effect[s.key];
      el.value.textContent = fmt(effect[s.key], el.unit);
    }
  }
  previewImg.style.filter = filterString(effect, 0.5);
  const sideways = effect.rotate === 90 || effect.rotate === 270;
  const t = transformString(effect);
  previewImg.style.transform = sideways ? `${t === 'none' ? '' : t} scale(0.58)` : t;
  $('rotVal').textContent = `${effect.rotate}°`;
  $('flipH').classList.toggle('active', effect.flipH);
  $('flipV').classList.toggle('active', effect.flipV);

  for (const b of $('presets').children) {
    const p = normalizeEffect({ ...DEFAULT_EFFECT, ...PRESETS[b.dataset.preset] });
    b.classList.toggle('active', SLIDERS.every((s) => p[s.key] === effect[s.key]));
  }

  const active = isEffectActive(effect);
  const status = $('effectStatus');
  status.classList.toggle('on', active);
  status.textContent = active
    ? 'Effect on: applied to every image you copy or add to the list. JPG, PNG and WebP keep their format; others are saved as PNG.'
    : 'No effect: images are copied and saved unchanged.';

  $('fxDot').hidden = !active;
  const chip = $('fxChip');
  chip.textContent = `Effect: ${effectLabel(effect)}`;
  chip.classList.toggle('on', active);
}

let saveTimer = 0;
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  chrome.storage.local.set({ effect });
}
function changed(updateSliders = false) {
  effect = normalizeEffect(effect);
  renderEffect(updateSliders);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 120);
}
window.addEventListener('pagehide', flushSave);

// ============================================================================
// Init
// ============================================================================
loadSettings().then((s) => {
  enabledEl.checked = s.enabled;
  effect = s.effect;
  renderEnabled();
  renderEffect(true);
});
refreshList();
