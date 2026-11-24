import { PROVIDERS, aspectOptions, generate, listModels } from './providers.js';

const CUSTOM = '__custom__';
const MANUAL = '__manual__';

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

const PLACEHOLDERS = {
  text: 'Ask anything. Leave empty to run the system prompt on its own.',
  image: 'Describe the image you want…',
  video: 'Describe the video you want…',
};

const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
};

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v; // only used with constant ICONS strings
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

let toastTimer;
function toast(message, kind = 'info') {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast ${kind === 'error' ? 'error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'error' ? 6000 : 3000);
}

// Icon button whose handler may return a message; shows a check mark on success.
function actionBtn(icon, label, handler) {
  const btn = el('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, html: ICONS[icon] });
  btn.addEventListener('click', async () => {
    try {
      const msg = await handler();
      btn.innerHTML = ICONS.check;
      btn.classList.add('ok');
      setTimeout(() => {
        btn.innerHTML = ICONS[icon];
        btn.classList.remove('ok');
      }, 1500);
      if (msg) toast(msg);
    } catch (e) {
      toast(e.message || String(e), 'error');
    }
  });
  return btn;
}

// Delete button that asks for a second click instead of a blocking confirm().
function deleteBtn(label, onConfirm) {
  const btn = el('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, html: ICONS.trash });
  let armed = false;
  let timer;
  btn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    armed = true;
    btn.textContent = 'Delete?';
    btn.classList.add('danger-confirm');
    timer = setTimeout(() => {
      armed = false;
      btn.innerHTML = ICONS.trash;
      btn.classList.remove('danger-confirm');
    }, 3000);
  });
  return btn;
}

/* ------------------------------------------------------------------ */
/* State + storage                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_PREFS = { provider: 'openai', type: 'text', model: {}, aspect: {}, promptId: '', keyId: {} };

let prompts = [];        // [{ id, name, text }]
let apiKeys = [];        // [{ id, provider, label, key }]
let fetchedModels = {};  // { provider: { text: [], image: [], video: [] } }
let customModels = {};   // same shape, model IDs the user typed in
let prefs = { ...DEFAULT_PREFS };
const manualKeys = {};   // unsaved keys typed this session, per provider
let running = null;      // AbortController of the current job

const persist = (obj) => chrome.storage.local.set(obj);
const savePrefs = () => persist({ prefs });

async function loadState() {
  const d = await chrome.storage.local.get(['prompts', 'apiKeys', 'fetchedModels', 'customModels', 'prefs']);
  prompts = d.prompts || [];
  apiKeys = d.apiKeys || [];
  fetchedModels = d.fetchedModels || {};
  customModels = d.customModels || {};
  prefs = { ...DEFAULT_PREFS, ...d.prefs };
  prefs.model ||= {};
  prefs.aspect ||= {};
  prefs.keyId ||= {};
  if (!PROVIDERS[prefs.provider]) prefs.provider = 'openai';
}

/* ------------------------------------------------------------------ */
/* Generate form                                                       */
/* ------------------------------------------------------------------ */

const ui = {
  provider: $('#provider'),
  typeBtns: [...document.querySelectorAll('#typeGroup button')],
  model: $('#model'),
  modelCustom: $('#modelCustom'),
  modelNote: $('#modelNote'),
  refresh: $('#refreshModels'),
  aspect: $('#aspect'),
  aspectField: $('#aspectField'),
  prompt: $('#prompt'),
  promptPreview: $('#promptPreview'),
  apiKey: $('#apiKey'),
  manualWrap: $('#manualKeyWrap'),
  manualKey: $('#manualKey'),
  saveKey: $('#saveKey'),
  input: $('#userInput'),
  generate: $('#generate'),
};

const modelPrefKey = () => `${prefs.provider}:${prefs.type}`;
const unsupportedMsg = () => PROVIDERS[prefs.provider].unsupported?.[prefs.type];
const maskKey = (k) => `••••${k.slice(-4)}`;

function modelChoices(p, t) {
  return [
    ...new Set([
      ...(PROVIDERS[p].models[t] || []),
      ...(fetchedModels[p]?.[t] || []),
      ...(customModels[p]?.[t] || []),
    ]),
  ];
}

const currentModelId = () => (ui.model.value === CUSTOM ? ui.modelCustom.value.trim() : ui.model.value);
const aspectPrefKey = () => `${prefs.provider}:${prefs.type}:${currentModelId()}`;

// Rebuilds the aspect ratio list for the selected model. Hidden when the
// model has no choice (text, dall-e-2, unsupported video).
function renderAspect() {
  const options = unsupportedMsg() ? [] : aspectOptions(prefs.provider, prefs.type, currentModelId());
  ui.aspectField.hidden = options.length === 0;
  ui.aspect.replaceChildren(new Option('Model default', ''));
  for (const o of options) ui.aspect.append(new Option(o.label, o.value));
  const saved = prefs.aspect[aspectPrefKey()];
  ui.aspect.value = options.some((o) => o.value === saved) ? saved : '';
}

function renderModels() {
  const p = prefs.provider;
  const t = prefs.type;
  const unsupported = unsupportedMsg();
  ui.model.replaceChildren();

  if (unsupported) {
    ui.model.append(new Option('Not available', ''));
    ui.model.disabled = true;
    ui.modelCustom.hidden = true;
    ui.modelNote.textContent = unsupported;
    ui.modelNote.className = 'note warn';
    ui.modelNote.hidden = false;
    renderAspect();
    return;
  }

  ui.model.disabled = false;
  const list = modelChoices(p, t);
  for (const m of list) ui.model.append(new Option(m, m));
  ui.model.append(new Option('Custom model ID…', CUSTOM));

  const saved = prefs.model[modelPrefKey()];
  ui.model.value = list.includes(saved) ? saved : list[0] ?? CUSTOM;
  ui.modelCustom.hidden = ui.model.value !== CUSTOM;

  if (t === 'video') {
    ui.modelNote.textContent = 'Video takes a few minutes. Keep this panel open until it finishes.';
    ui.modelNote.className = 'note';
    ui.modelNote.hidden = false;
  } else {
    ui.modelNote.hidden = true;
  }
  renderAspect();
}

function renderPromptSelect() {
  ui.prompt.replaceChildren(new Option('No system prompt', ''));
  for (const pr of prompts) ui.prompt.append(new Option(pr.name, pr.id));
  if (!prompts.some((pr) => pr.id === prefs.promptId)) prefs.promptId = '';
  ui.prompt.value = prefs.promptId;
  const current = prompts.find((pr) => pr.id === prefs.promptId);
  ui.promptPreview.textContent = current?.text || '';
  ui.promptPreview.hidden = !current;
}

function renderKeySelect() {
  const p = prefs.provider;
  const keys = apiKeys.filter((k) => k.provider === p);
  ui.apiKey.replaceChildren();
  for (const k of keys) ui.apiKey.append(new Option(`${k.label} (${maskKey(k.key)})`, k.id));
  ui.apiKey.append(new Option('Enter key manually…', MANUAL));

  const saved = prefs.keyId[p];
  ui.apiKey.value = keys.some((k) => k.id === saved) || saved === MANUAL ? saved : keys[0]?.id ?? MANUAL;
  ui.manualWrap.hidden = ui.apiKey.value !== MANUAL;
  ui.manualKey.value = manualKeys[p] || '';
  ui.manualKey.placeholder = `Paste your ${PROVIDERS[p].name} key (${PROVIDERS[p].keyPlaceholder})`;
}

function renderTypeButtons() {
  for (const b of ui.typeBtns) b.setAttribute('aria-pressed', String(b.dataset.type === prefs.type));
  ui.input.placeholder = PLACEHOLDERS[prefs.type];
}

function updateGenerateButton() {
  if (running) {
    ui.generate.textContent = 'Cancel';
    ui.generate.classList.add('stop');
    ui.generate.disabled = false;
  } else {
    ui.generate.textContent = 'Generate';
    ui.generate.classList.remove('stop');
    ui.generate.disabled = Boolean(unsupportedMsg());
  }
}

function renderForm() {
  ui.provider.value = prefs.provider;
  renderTypeButtons();
  renderModels();
  renderPromptSelect();
  renderKeySelect();
  updateGenerateButton();
}

// Returns the chosen model ID, remembering custom IDs for next time.
function resolveModel() {
  if (ui.model.value !== CUSTOM) return ui.model.value;
  const id = ui.modelCustom.value.trim();
  if (!id) return '';
  const p = prefs.provider;
  const t = prefs.type;
  customModels[p] ||= { text: [], image: [], video: [] };
  if (!modelChoices(p, t).includes(id)) {
    customModels[p][t].push(id);
    persist({ customModels });
  }
  prefs.model[modelPrefKey()] = id;
  savePrefs();
  ui.modelCustom.value = '';
  renderModels();
  return id;
}

// Returns the API key to use, saving a manually entered one if asked to.
function resolveKey() {
  const p = prefs.provider;
  if (ui.apiKey.value !== MANUAL) return apiKeys.find((k) => k.id === ui.apiKey.value)?.key || '';
  const key = ui.manualKey.value.trim();
  if (key && ui.saveKey.checked) {
    const count = apiKeys.filter((k) => k.provider === p).length;
    const entry = { id: crypto.randomUUID(), provider: p, label: count ? `Key ${count + 1}` : 'Default', key };
    apiKeys.push(entry);
    persist({ apiKeys });
    prefs.keyId[p] = entry.id;
    savePrefs();
    manualKeys[p] = '';
    ui.saveKey.checked = false;
    renderKeySelect();
    renderKeyList();
    toast('API key saved.');
  }
  return key;
}

async function refreshModels() {
  const p = prefs.provider;
  const key = resolveKey();
  if (!key) {
    toast(`Add a ${PROVIDERS[p].name} API key first. The model list is loaded with your key.`, 'error');
    return;
  }
  ui.refresh.classList.add('spin');
  ui.refresh.disabled = true;
  try {
    fetchedModels[p] = await listModels(p, key);
    await persist({ fetchedModels });
    renderModels();
    const n = fetchedModels[p][prefs.type]?.length || 0;
    toast(`Loaded ${n} ${prefs.type} model${n === 1 ? '' : 's'} from ${PROVIDERS[p].name}.`);
  } catch (e) {
    toast(`Couldn't load models: ${e.message}`, 'error');
  } finally {
    ui.refresh.classList.remove('spin');
    ui.refresh.disabled = false;
  }
}

async function onGenerate() {
  if (running) {
    running.abort();
    return;
  }
  const p = prefs.provider;
  const t = prefs.type;
  if (unsupportedMsg()) return toast(unsupportedMsg(), 'error');

  const model = resolveModel();
  if (!model) {
    toast('Enter a model ID.', 'error');
    ui.modelCustom.focus();
    return;
  }
  const apiKey = resolveKey();
  if (!apiKey) {
    toast(`Add a ${PROVIDERS[p].name} API key, or pick a saved one.`, 'error');
    (ui.apiKey.value === MANUAL ? ui.manualKey : ui.apiKey).focus();
    return;
  }
  const aspect = ui.aspectField.hidden ? '' : ui.aspect.value;
  const aspectLabel = aspect ? ui.aspect.selectedOptions[0].textContent.split(' · ')[0] : '';
  const promptObj = prompts.find((pr) => pr.id === ui.prompt.value);
  const system = promptObj?.text.trim() || '';
  const input = ui.input.value.trim();
  if (!system && !input) {
    toast('Type some input or choose a system prompt.', 'error');
    ui.input.focus();
    return;
  }

  const ctrl = new AbortController();
  running = ctrl;
  updateGenerateButton();
  const card = createCard({ provider: p, type: t, model, aspectLabel, promptName: promptObj?.name, input });

  try {
    const result = await generate({
      provider: p, type: t, model, apiKey, system, input, aspect,
      signal: ctrl.signal,
      onProgress: (msg) => card.setStatus(msg),
    });
    card.fill(result);
  } catch (e) {
    if (e.name === 'AbortError') card.fail('Cancelled.', true);
    else card.fail(e.message || String(e));
  } finally {
    running = null;
    updateGenerateButton();
  }
}

/* ------------------------------------------------------------------ */
/* Result cards                                                        */
/* ------------------------------------------------------------------ */

const resultsEl = $('#results');
const objectUrls = new Set();

function syncEmptyState() {
  const has = resultsEl.children.length > 0;
  $('#emptyState').hidden = has;
  $('#resultsHead').hidden = !has;
}

const fmtElapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function fileName(meta, blob) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${meta.provider}-${meta.type}-${stamp}.${EXT[blob.type] || (meta.type === 'video' ? 'mp4' : 'png')}`;
}

function downloadBlob(url, name) {
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

// The clipboard only accepts PNG images, so other formats are converted.
async function copyImage(blob) {
  let png = blob;
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    png = await canvas.convertToBlob({ type: 'image/png' });
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return 'Image copied.';
}

// Chrome does not allow video files on the clipboard. Copy the public link
// when there is one, otherwise say so.
async function copyVideo(result) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [result.blob.type || 'video/mp4']: result.blob })]);
    return 'Video copied.';
  } catch {
    if (result.sourceUrl) {
      await navigator.clipboard.writeText(result.sourceUrl);
      return "Video link copied. Browsers can't put video files on the clipboard.";
    }
    throw new Error("Browsers can't put video files on the clipboard, and this video has no public link. Use Download instead.");
  }
}

function createCard(meta) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const actions = el('div', { class: 'card-actions' });
  const status = el('span', { class: 'status' }, 'Generating…');
  const elapsed = el('span', { class: 'elapsed small' }, '0:00');
  const body = el('div', { class: 'card-body' }, el('div', { class: 'pending' }, el('span', { class: 'spinner' }), status, elapsed));
  const promptLine = [meta.promptName && `[${meta.promptName}]`, meta.input].filter(Boolean).join(' ');
  const metaText = [PROVIDERS[meta.provider].name, meta.model, meta.aspectLabel, time].filter(Boolean).join(' · ');

  const card = el(
    'article',
    { class: 'card' },
    el(
      'header',
      { class: 'card-head' },
      el('span', { class: 'badge' }, meta.type),
      el('span', { class: 'card-meta', title: metaText }, metaText),
      actions,
    ),
    promptLine ? el('p', { class: 'card-prompt', title: promptLine }, promptLine) : null,
    body,
  );
  resultsEl.prepend(card);
  syncEmptyState();
  $('.results').scrollTop = 0;

  const started = Date.now();
  const timer = setInterval(() => (elapsed.textContent = fmtElapsed(Date.now() - started)), 1000);
  let url = null;

  const removeBtn = actionBtn('close', 'Remove', () => {
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }
    card.remove();
    syncEmptyState();
  });

  return {
    setStatus(msg) {
      status.textContent = msg;
    },

    fill(result) {
      clearInterval(timer);
      if (result.kind === 'text') {
        body.replaceChildren(el('div', { class: 'text-out' }, result.text));
        actions.append(actionBtn('copy', 'Copy text', async () => {
          await navigator.clipboard.writeText(result.text);
          return 'Text copied.';
        }));
      } else {
        url = URL.createObjectURL(result.blob);
        objectUrls.add(url);
        const name = fileName(meta, result.blob);
        const media =
          result.kind === 'image'
            ? el('img', { class: 'media-out', src: url, alt: meta.input || 'Generated image', title: 'Open full size' })
            : el('video', { class: 'media-out', src: url, controls: true, playsinline: true });
        if (result.kind === 'image') media.addEventListener('click', () => chrome.tabs.create({ url }));
        body.replaceChildren(media, result.caption ? el('p', { class: 'caption' }, result.caption) : null);
        actions.append(
          actionBtn('copy', `Copy ${result.kind}`, () => (result.kind === 'image' ? copyImage(result.blob) : copyVideo(result))),
          actionBtn('download', `Download ${result.kind}`, () => downloadBlob(url, name)),
        );
      }
      actions.append(removeBtn);
    },

    fail(message, cancelled = false) {
      clearInterval(timer);
      body.replaceChildren(el('div', { class: cancelled ? 'cancelled-out' : 'error-out' }, message));
      actions.append(removeBtn);
    },
  };
}

function clearResults() {
  if (running) running.abort();
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls.clear();
  resultsEl.replaceChildren();
  syncEmptyState();
}

/* ------------------------------------------------------------------ */
/* Prompts tab                                                         */
/* ------------------------------------------------------------------ */

let editingPromptId = null;

function renderPromptList() {
  const list = $('#promptList');
  list.replaceChildren();
  if (!prompts.length) {
    list.append(el('li', { class: 'empty-row' }, 'No saved prompts yet.'));
    return;
  }
  for (const pr of prompts) {
    list.append(
      el(
        'li',
        {},
        el('div', { class: 'item-main' }, el('div', { class: 'item-title' }, pr.name), el('div', { class: 'item-sub preview' }, pr.text)),
        el(
          'div',
          { class: 'item-actions' },
          el('button', { type: 'button', class: 'icon-btn', title: 'Edit', 'aria-label': `Edit ${pr.name}`, html: ICONS.edit, onclick: () => startEditPrompt(pr) }),
          deleteBtn(`Delete ${pr.name}`, () => {
            prompts = prompts.filter((x) => x.id !== pr.id);
            persist({ prompts });
            if (editingPromptId === pr.id) resetPromptForm();
            renderPromptList();
            renderPromptSelect();
          }),
        ),
      ),
    );
  }
}

function startEditPrompt(pr) {
  editingPromptId = pr.id;
  $('#promptName').value = pr.name;
  $('#promptText').value = pr.text;
  $('#promptFormTitle').textContent = 'Edit system prompt';
  $('#promptSubmit').textContent = 'Update prompt';
  $('#promptCancel').hidden = false;
  $('#promptName').focus();
}

function resetPromptForm() {
  editingPromptId = null;
  $('#promptForm').reset();
  $('#promptFormTitle').textContent = 'New system prompt';
  $('#promptSubmit').textContent = 'Save prompt';
  $('#promptCancel').hidden = true;
}

function onPromptSubmit(e) {
  e.preventDefault();
  const name = $('#promptName').value.trim();
  const text = $('#promptText').value.trim();
  if (!name || !text) return toast('Give the prompt a name and some text.', 'error');
  if (editingPromptId) {
    const pr = prompts.find((x) => x.id === editingPromptId);
    if (pr) Object.assign(pr, { name, text });
    toast('Prompt updated.');
  } else {
    prompts.push({ id: crypto.randomUUID(), name, text });
    toast('Prompt saved.');
  }
  persist({ prompts });
  resetPromptForm();
  renderPromptList();
  renderPromptSelect();
}

/* ------------------------------------------------------------------ */
/* API keys tab                                                        */
/* ------------------------------------------------------------------ */

function renderKeyList() {
  const list = $('#keyList');
  list.replaceChildren();
  if (!apiKeys.length) {
    list.append(el('li', { class: 'empty-row' }, 'No saved keys yet.'));
    return;
  }
  for (const k of apiKeys) {
    list.append(
      el(
        'li',
        {},
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, k.label),
          el('div', { class: 'item-sub' }, `${PROVIDERS[k.provider]?.name || k.provider} · `, el('span', { class: 'mono' }, maskKey(k.key))),
        ),
        el(
          'div',
          { class: 'item-actions' },
          deleteBtn(`Delete ${k.label}`, () => {
            apiKeys = apiKeys.filter((x) => x.id !== k.id);
            persist({ apiKeys });
            renderKeyList();
            renderKeySelect();
          }),
        ),
      ),
    );
  }
}

function onKeySubmit(e) {
  e.preventDefault();
  const provider = $('#keyProvider').value;
  const key = $('#keyValue').value.trim();
  if (!key) return toast('Paste the API key.', 'error');
  const count = apiKeys.filter((k) => k.provider === provider).length;
  const label = $('#keyLabel').value.trim() || (count ? `Key ${count + 1}` : 'Default');
  const entry = { id: crypto.randomUUID(), provider, label, key };
  apiKeys.push(entry);
  persist({ apiKeys });
  if (provider === prefs.provider && (!prefs.keyId[provider] || prefs.keyId[provider] === MANUAL)) {
    prefs.keyId[provider] = entry.id;
    savePrefs();
  }
  $('#keyLabel').value = '';
  $('#keyValue').value = '';
  renderKeyList();
  renderKeySelect();
  toast(`${PROVIDERS[provider].name} key saved.`);
}

/* ------------------------------------------------------------------ */
/* Tabs + wiring                                                       */
/* ------------------------------------------------------------------ */

function showView(name) {
  for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  for (const v of ['generate', 'prompts', 'keys']) $(`#view-${v}`).hidden = v !== name;
  if (name === 'keys') $('#keyProvider').value = prefs.provider;
}

function wire() {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    ui.provider.append(new Option(p.name, id));
    $('#keyProvider').append(new Option(p.name, id));
  }
  ui.refresh.innerHTML = ICONS.refresh;

  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showView(tab.dataset.view));
  for (const link of document.querySelectorAll('[data-goto]')) link.addEventListener('click', () => showView(link.dataset.goto));

  ui.provider.addEventListener('change', () => {
    prefs.provider = ui.provider.value;
    savePrefs();
    renderForm();
  });

  for (const b of ui.typeBtns) {
    b.addEventListener('click', () => {
      prefs.type = b.dataset.type;
      savePrefs();
      renderTypeButtons();
      renderModels();
      updateGenerateButton();
    });
  }

  ui.model.addEventListener('change', () => {
    const custom = ui.model.value === CUSTOM;
    ui.modelCustom.hidden = !custom;
    if (custom) ui.modelCustom.focus();
    else {
      prefs.model[modelPrefKey()] = ui.model.value;
      savePrefs();
    }
    renderAspect();
  });
  ui.modelCustom.addEventListener('input', renderAspect);

  ui.aspect.addEventListener('change', () => {
    prefs.aspect[aspectPrefKey()] = ui.aspect.value;
    savePrefs();
  });

  ui.refresh.addEventListener('click', refreshModels);

  ui.prompt.addEventListener('change', () => {
    prefs.promptId = ui.prompt.value;
    savePrefs();
    renderPromptSelect();
  });

  ui.apiKey.addEventListener('change', () => {
    prefs.keyId[prefs.provider] = ui.apiKey.value;
    savePrefs();
    ui.manualWrap.hidden = ui.apiKey.value !== MANUAL;
    if (ui.apiKey.value === MANUAL) ui.manualKey.focus();
  });
  ui.manualKey.addEventListener('input', () => (manualKeys[prefs.provider] = ui.manualKey.value));

  $('#genForm').addEventListener('submit', (e) => {
    e.preventDefault();
    onGenerate();
  });
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!running) onGenerate();
    }
  });
  $('#clearResults').addEventListener('click', clearResults);

  $('#promptForm').addEventListener('submit', onPromptSubmit);
  $('#promptCancel').addEventListener('click', resetPromptForm);
  $('#keyForm').addEventListener('submit', onKeySubmit);
}

(async function init() {
  await loadState();
  wire();
  renderForm();
  renderPromptList();
  renderKeyList();
  syncEmptyState();
})();
