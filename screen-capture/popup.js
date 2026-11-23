const $ = (id) => document.getElementById(id);
const listEl = $('list');
const emptyEl = $('empty');
const errorEl = $('error');
const downloadAllBtn = $('downloadAll');
const clearAllBtn = $('clearAll');

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (!res || !res.ok) throw new Error((res && res.error) || 'Unknown error');
    return res;
  });
}

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = !text;
}

function flashButton(btn, text) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => { btn.textContent = original; }, 1500);
}

function formatTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ---------- Names ----------
const pendingNames = new Map(); // id -> { name, timer }

function queueRename(id, name) {
  const p = pendingNames.get(id);
  if (p) clearTimeout(p.timer);
  pendingNames.set(id, { name, timer: setTimeout(() => flushRename(id), 400) });
}

function flushRename(id) {
  const p = pendingNames.get(id);
  if (!p) return Promise.resolve();
  clearTimeout(p.timer);
  pendingNames.delete(id);
  return send({ type: 'rename', id, name: p.name });
}

function flushAllRenames() {
  return Promise.all([...pendingNames.keys()].map(flushRename));
}

window.addEventListener('pagehide', () => { flushAllRenames().catch(() => {}); });

let renderedIds = '';

function render(captures) {
  // Skip the redraw when only names changed, so an input being typed in keeps focus.
  const ids = captures.map((c) => c.id).join(',');
  if (ids === renderedIds && listEl.childElementCount === captures.length) return;
  renderedIds = ids;

  listEl.replaceChildren();
  emptyEl.hidden = captures.length > 0;
  downloadAllBtn.disabled = clearAllBtn.disabled = captures.length === 0;
  downloadAllBtn.textContent = captures.length ? `Download all (${captures.length})` : 'Download all';
  resetClearAll();

  // Newest first
  [...captures].reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'item';

    const img = document.createElement('img');
    img.src = c.dataUrl;
    img.alt = 'Capture';
    img.title = c.url;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = c.title || c.url || 'Untitled page';
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `${c.width} × ${c.height} · ${formatTime(c.createdAt)}`;
    info.append(title, sub);

    const nameRow = document.createElement('div');
    nameRow.className = 'name-row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'name';
    nameInput.value = c.name || '';
    nameInput.placeholder = 'File name (default: current date & time)';
    nameInput.spellcheck = false;
    nameInput.addEventListener('input', () => queueRename(c.id, nameInput.value));
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dl.click(); }
    });
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = '.png';
    nameRow.append(nameInput, ext);

    const dl = document.createElement('button');
    dl.className = 'small primary';
    dl.textContent = 'Download';
    dl.addEventListener('click', async () => {
      showError('');
      try {
        await flushRename(c.id);
        await send({ type: 'download', id: c.id });
      } catch (e) {
        showError(e.message);
      }
    });

    const copy = document.createElement('button');
    copy.className = 'small';
    copy.textContent = 'Copy';
    copy.title = 'Copy image to clipboard';
    copy.addEventListener('click', async () => {
      showError('');
      try {
        // Pass the blob as a promise so the write happens inside the click gesture.
        const blob = fetch(c.dataUrl).then((r) => r.blob());
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        flashButton(copy, 'Copied ✓');
      } catch (e) {
        showError(`Copy failed: ${e.message}`);
      }
    });

    const del = document.createElement('button');
    del.className = 'small danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      pendingNames.delete(c.id);
      send({ type: 'delete', id: c.id }).catch((e) => showError(e.message));
    });

    meta.append(info, copy, dl, del);
    item.append(img, nameRow, meta);
    listEl.append(item);
  });
}

async function load() {
  const { captures = [], showFab = true } = await chrome.storage.local.get(['captures', 'showFab']);
  $('showFab').checked = showFab;
  render(captures);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captures) render(changes.captures.newValue || []);
});

$('showFab').addEventListener('change', (e) => {
  chrome.storage.local.set({ showFab: e.target.checked });
});

$('capture').addEventListener('click', async () => {
  showError('');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await send({ type: 'start-selection-in-tab', tabId: tab.id });
    window.close(); // get the popup out of the way so the user can drag
  } catch {
    showError("Can't capture on this page (Chrome blocks extensions on chrome:// pages, the Web Store, etc.).");
  }
});

downloadAllBtn.addEventListener('click', async () => {
  showError('');
  downloadAllBtn.disabled = true;
  try {
    await flushAllRenames();
    await send({ type: 'download-all' });
  } catch (e) {
    showError(e.message);
  } finally {
    downloadAllBtn.disabled = false;
  }
});

// Two-click confirm so captures aren't wiped by accident.
let clearArmed = false;
let clearTimer;
function resetClearAll() {
  clearArmed = false;
  clearTimeout(clearTimer);
  clearAllBtn.textContent = 'Clear all';
}
clearAllBtn.addEventListener('click', async () => {
  if (!clearArmed) {
    clearArmed = true;
    clearAllBtn.textContent = 'Click again to confirm';
    clearTimer = setTimeout(resetClearAll, 3000);
    return;
  }
  resetClearAll();
  await send({ type: 'clear-all' }).catch((e) => showError(e.message));
});

load();
