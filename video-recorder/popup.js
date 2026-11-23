const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = {
  tabAudio: true,
  mic: true,
  format: 'webm',
  bitrate: 6000000,
  fps: 30,
  label: {
    text: '',
    position: 'top-left',
    size: 28,
    rotation: 0,
    color: '#ffffff',
    bold: true,
    background: true,
    bgColor: '#000000',
    bgOpacity: 0.6,
  },
  effects: { ...VREffects.DEFAULTS },
};

// Preview is drawn at roughly this fraction of real CSS size (popup is small).
const PREVIEW_SCALE = 0.45;
const FX_FIELDS = ['brightness', 'contrast', 'saturation', 'hue', 'blur', 'pixelate', 'vignette', 'grain'];
const FX_FMT = {
  brightness: (v) => v + '%', contrast: (v) => v + '%', saturation: (v) => v + '%',
  hue: (v) => v + '°', blur: (v) => v + 'px', pixelate: (v) => (+v ? v + 'px' : 'off'),
  vignette: (v) => v, grain: (v) => v,
};
const fxId = (k) => 'fx' + k[0].toUpperCase() + k.slice(1);

let settings = structuredClone(DEFAULT_SETTINGS);
let micGranted = false;
let activeTimer = null;
const objectUrls = [];

// ---------------- Settings ----------------

async function loadSettings() {
  const { vrSettings } = await chrome.storage.local.get('vrSettings');
  if (vrSettings) {
    settings = { ...DEFAULT_SETTINGS, ...vrSettings, label: { ...DEFAULT_SETTINGS.label, ...(vrSettings.label || {}) },
      effects: { ...DEFAULT_SETTINGS.effects, ...(vrSettings.effects || {}) } };
  }
  $('optTabAudio').checked = settings.tabAudio;
  $('optMic').checked = settings.mic;
  $('optFormat').value = settings.format;
  $('optBitrate').value = String(settings.bitrate);
  $('optFps').value = String(settings.fps);
  const l = settings.label;
  $('lblText').value = l.text;
  $('lblSize').value = $('lblSizeNum').value = l.size;
  $('lblRot').value = $('lblRotNum').value = l.rotation;
  $('lblColor').value = l.color;
  $('lblBold').checked = l.bold;
  $('lblBg').checked = l.background;
  $('lblBgColor').value = l.bgColor;
  setPosition(l.position, false);
  writeEffectControls();
  updatePreview();
}

function writeEffectControls() {
  const fx = settings.effects;
  $('fxPreset').value = VREffects.PRESETS[fx.preset] ? fx.preset : 'none';
  FX_FIELDS.forEach((k) => { $(fxId(k)).value = fx[k]; });
  updateEffectOutputs();
}

function updateEffectOutputs() {
  FX_FIELDS.forEach((k) => { $(fxId(k) + 'Out').textContent = FX_FMT[k](settings.effects[k]); });
  const on = VREffects.isActive(settings.effects);
  $('fxState').textContent = on ? '● on — applied automatically' : '(none — off)';
  $('fxState').classList.toggle('on', on);
}

function readSettings() {
  settings.tabAudio = $('optTabAudio').checked;
  settings.mic = $('optMic').checked;
  settings.format = $('optFormat').value;
  settings.bitrate = Number($('optBitrate').value);
  settings.fps = Number($('optFps').value);
  Object.assign(settings.label, {
    text: $('lblText').value,
    size: clamp(Number($('lblSizeNum').value) || 28, 4, 400),
    rotation: clamp(Number($('lblRotNum').value) || 0, -360, 360),
    color: $('lblColor').value,
    bold: $('lblBold').checked,
    background: $('lblBg').checked,
    bgColor: $('lblBgColor').value,
  });
  settings.effects.preset = $('fxPreset').value;
  FX_FIELDS.forEach((k) => { settings.effects[k] = Number($(fxId(k)).value); });
}

function saveSettings() {
  readSettings();
  updateEffectOutputs();
  updatePreview();
  updateMicHint();
  chrome.storage.local.set({ vrSettings: settings });
}

function setPosition(pos, save = true) {
  settings.label.position = pos;
  document.querySelectorAll('#posGrid button').forEach((b) => b.classList.toggle('on', b.dataset.pos === pos));
  $('posName').textContent = pos;
  if (save) saveSettings();
}

// Sample scene the effects are previewed on.
let sceneCanvas = null;
function getScene(W, H) {
  if (sceneCanvas && sceneCanvas.width === W && sceneCanvas.height === H) return sceneCanvas;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#38bdf8'); sky.addColorStop(1, '#fde68a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f97316'; g.beginPath(); g.arc(W * 0.78, H * 0.3, H * 0.16, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#16a34a'; g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.65);
  g.quadraticCurveTo(W * 0.3, H * 0.4, W * 0.6, H * 0.7); g.quadraticCurveTo(W * 0.8, H * 0.8, W, H * 0.6);
  g.lineTo(W, H); g.fill();
  ['#e11d48', '#7c3aed', '#2563eb', '#facc15'].forEach((col, i) => {
    g.fillStyle = col; g.fillRect(W * 0.06 + i * W * 0.09, H * 0.12, W * 0.07, H * 0.25);
  });
  g.fillStyle = '#111827'; g.font = `bold ${Math.round(H * 0.11)}px system-ui, sans-serif`;
  g.fillText('Sample page', W * 0.06, H * 0.55);
  sceneCanvas = c;
  return c;
}

function renderEffectsPreview() {
  const cv = $('pvCanvas');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(2, Math.round(cv.clientWidth * dpr));
  const H = Math.max(2, Math.round(cv.clientHeight * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const fx = VREffects.create(settings.effects, W, H, PREVIEW_SCALE * dpr);
  fx.drawFrame(ctx, getScene(W, H), [0, 0, W, H]);
}

function updatePreview() {
  renderEffectsPreview();
  const l = settings.label;
  const span = $('previewLabel');
  span.textContent = l.text || '(no label)';
  span.style.opacity = l.text ? 1 : 0.4;
  const size = Math.max(6, l.size * PREVIEW_SCALE);
  Object.assign(span.style, {
    fontSize: size + 'px',
    fontWeight: l.bold ? '700' : '400',
    color: l.color,
    background: l.background ? hexToRgba(l.bgColor, l.bgOpacity) : 'transparent',
    padding: l.background ? size * 0.35 + 'px' : '0',
    textShadow: l.background ? 'none' : '0 0 2px #000, 0 0 2px #000',
    left: '', right: '', top: '', bottom: '',
  });
  const [v, h] = l.position.split('-');
  const m = size * 0.6 + 'px';
  let tx = '0', ty = '0';
  if (h === 'left') span.style.left = m;
  else if (h === 'right') span.style.right = m;
  else { span.style.left = '50%'; tx = '-50%'; }
  if (v === 'top') span.style.top = m;
  else if (v === 'bottom') span.style.bottom = m;
  else { span.style.top = '50%'; ty = '-50%'; }
  span.style.transform = `translate(${tx}, ${ty}) rotate(${l.rotation}deg)`;
}

// ---------------- Mic permission ----------------

async function checkMic() {
  try {
    const st = await navigator.permissions.query({ name: 'microphone' });
    micGranted = st.state === 'granted';
  } catch (_) {
    micGranted = false;
  }
  updateMicHint();
}

function updateMicHint() {
  $('grantMic').classList.toggle('hidden', micGranted || !$('optMic').checked);
}

function openMicPermission() {
  chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
}

// ---------------- Recording control ----------------

function showMsg(text, isError = false) {
  const m = $('msg');
  if (!text) { m.classList.add('hidden'); return; }
  m.textContent = text;
  m.classList.toggle('error', isError);
  m.classList.remove('hidden');
}

async function start(mode) {
  saveSettings();
  if (settings.mic && !micGranted) {
    showMsg('Microphone access is needed once. A tab will open — click Allow, then come back and start again. (Or untick "Microphone".)');
    openMicPermission();
    return;
  }
  setButtonsDisabled(true);
  showMsg('');
  const res = await chrome.runtime.sendMessage({
    type: 'vr-start-selection',
    mode,
    options: {
      tabAudio: settings.tabAudio,
      mic: settings.mic,
      format: settings.format,
      bitrate: settings.bitrate,
      fps: settings.fps,
      label: settings.label,
      effects: settings.effects,
    },
  });
  setButtonsDisabled(false);
  if (!res || !res.ok) {
    showMsg((res && res.error) || 'Failed to start.', true);
    return;
  }
  if (res.warning) {
    showMsg(res.warning);
    setTimeout(() => window.close(), 2500);
  } else {
    window.close(); // let the user draw the area on the page
  }
}

function setButtonsDisabled(d) {
  $('selectBtn').disabled = d;
  $('fullBtn').disabled = d;
}

async function refreshState() {
  const state = await chrome.runtime.sendMessage({ type: 'vr-get-state' });
  const recording = state && (state.status === 'recording' || state.status === 'saving');
  $('activePanel').classList.toggle('hidden', !recording && state.status !== 'selecting');
  $('setupPanel').classList.toggle('hidden', !!recording || state.status === 'selecting');
  clearInterval(activeTimer);
  if (state.status === 'recording') {
    $('activeText').textContent = 'Recording…';
    $('stopBtn').disabled = false;
    $('stopBtn').textContent = '■ Stop & save';
    const tick = () => ($('activeTime').textContent = fmtDur(Date.now() - state.startedAt));
    tick();
    activeTimer = setInterval(tick, 500);
  } else if (state.status === 'saving') {
    $('activeText').textContent = 'Saving…';
    $('stopBtn').disabled = true;
  } else if (state.status === 'selecting') {
    $('activeText').textContent = 'Waiting for area selection on the page…';
    $('activeTime').textContent = '';
    $('stopBtn').disabled = false;
    $('stopBtn').textContent = 'Cancel';
  }
  $('stopBtn').dataset.mode = state.status;
}

// ---------------- Recordings list ----------------

async function renderList() {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const list = $('list');
  list.innerHTML = '';
  const recs = await RecDB.all();
  $('count').textContent = recs.length ? `(${recs.length})` : '';
  $('empty').classList.toggle('hidden', recs.length > 0);
  $('clearAll').disabled = recs.length === 0;

  const tpl = $('itemTpl');
  for (const rec of recs) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const url = URL.createObjectURL(rec.blob);
    objectUrls.push(url);

    const video = node.querySelector('.thumb');
    video.src = url;

    const name = node.querySelector('.name');
    name.value = rec.name || '';
    name.placeholder = defaultName(rec);
    name.addEventListener('change', () => RecDB.rename(rec.id, name.value.trim()));

    node.querySelector('.info').textContent =
      `${new Date(rec.createdAt).toLocaleString()} · ${fmtDur(rec.duration)} · ${fmtSize(rec.size)} · ${rec.width}×${rec.height} · ${rec.ext.toUpperCase()}`;

    node.querySelector('.dl').addEventListener('click', async () => {
      const finalName = sanitize(name.value.trim() || defaultName(rec));
      if (name.value.trim() !== (rec.name || '')) await RecDB.rename(rec.id, name.value.trim());
      chrome.downloads.download({ url, filename: `${finalName}.${rec.ext}`, saveAs: false });
    });

    const playBtn = node.querySelector('.play');
    playBtn.addEventListener('click', () => {
      const expanded = node.classList.toggle('expanded');
      video.classList.toggle('playing', expanded);
      video.controls = expanded;
      video.muted = !expanded;
      if (expanded) video.play(); else video.pause();
      playBtn.textContent = expanded ? '▣ Close' : '▶ Play';
    });

    node.querySelector('.del').addEventListener('click', async () => {
      await RecDB.remove(rec.id);
      renderList();
    });

    list.appendChild(node);
  }
}

async function clearAll() {
  if (!confirm('Delete ALL recordings? This cannot be undone.')) return;
  await RecDB.clear();
  renderList();
}

// ---------------- Helpers ----------------

function defaultName(rec) {
  const d = new Date(rec.createdAt);
  const p = (n) => String(n).padStart(2, '0');
  return `recording-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function sanitize(s) { return s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'recording'; }
function fmtDur(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------- Wiring ----------------

document.addEventListener('DOMContentLoaded', async () => {
  // Disable MP4 if this Chrome can't record it.
  const mp4ok = ['video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
    .some((t) => MediaRecorder.isTypeSupported(t));
  if (!mp4ok) {
    const o = $('optFormat').querySelector('option[value=mp4]');
    o.disabled = true;
    o.textContent = 'MP4 (not supported)';
  }

  const presetSel = $('fxPreset');
  Object.entries(VREffects.PRESETS).forEach(([key, p]) => presetSel.add(new Option(p.name, key)));

  await loadSettings();
  if (!mp4ok && settings.format === 'mp4') $('optFormat').value = 'webm';
  await checkMic();
  await refreshState();
  await renderList();

  $('selectBtn').addEventListener('click', () => start('area'));
  $('fullBtn').addEventListener('click', () => start('full'));
  $('stopBtn').addEventListener('click', async () => {
    const mode = $('stopBtn').dataset.mode;
    $('stopBtn').disabled = true;
    await chrome.runtime.sendMessage({ type: mode === 'selecting' ? 'vr-cancel' : 'vr-stop' });
    await refreshState();
    await renderList();
  });
  $('grantMic').addEventListener('click', (e) => { e.preventDefault(); openMicPermission(); });
  $('clearAll').addEventListener('click', clearAll);

  ['optTabAudio', 'optMic', 'optFormat', 'optBitrate', 'optFps', 'lblColor', 'lblBold', 'lblBg', 'lblBgColor']
    .forEach((id) => $(id).addEventListener('change', saveSettings));
  $('lblText').addEventListener('input', saveSettings);

  $('fxPreset').addEventListener('change', saveSettings);
  FX_FIELDS.forEach((k) => $(fxId(k)).addEventListener('input', saveSettings));
  $('fxReset').addEventListener('click', () => {
    settings.effects = { ...VREffects.DEFAULTS };
    writeEffectControls();
    saveSettings();
  });

  const link = (a, b) => {
    $(a).addEventListener('input', () => { $(b).value = $(a).value; saveSettings(); });
    $(b).addEventListener('input', () => { $(a).value = $(b).value; saveSettings(); });
  };
  link('lblSize', 'lblSizeNum');
  link('lblRot', 'lblRotNum');

  document.querySelectorAll('#posGrid button').forEach((b) =>
    b.addEventListener('click', () => setPosition(b.dataset.pos)));
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'vr-recordings-updated') {
    refreshState();
    renderList();
    if (msg.error) showMsg(msg.error, true);
  }
  return false;
});
