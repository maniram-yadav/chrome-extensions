// Image Downloader - popup: on/off switch and the effect applied to downloads.

const { DEFAULT_EFFECT, PRESETS, normalizeEffect, isEffectActive, filterString, transformString, loadSettings } = IDL;

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

const PRESET_LABELS = {
  none: 'None', bw: 'B&W', sepia: 'Sepia', vintage: 'Vintage', vivid: 'Vivid',
  warm: 'Warm', cool: 'Cool', dramatic: 'Dramatic', invert: 'Invert', soft: 'Soft',
};

// A small built-in sample picture so the effect can be previewed in the popup.
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

const $ = (id) => document.getElementById(id);
const enabledEl = $('enabled');
const panel = $('effectPanel');
const previewImg = $('previewImg');
previewImg.src = SAMPLE;

let effect = { ...DEFAULT_EFFECT };
const sliderEls = {};

// ---- Build UI ------------------------------------------------------------------
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
  input.addEventListener('change', flushSave); // slider released
  // double-click a slider to reset just that value
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

enabledEl.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
  renderEnabled();
});

// ---- Render ----------------------------------------------------------------------
function renderEnabled() {
  const on = enabledEl.checked;
  $('stateText').textContent = on ? 'On: buttons shown on images' : 'Off: no buttons on pages';
  $('stateText').classList.toggle('off', !on);
  panel.classList.toggle('disabled', !on);
}

function render(updateSliders) {
  if (updateSliders) {
    for (const s of SLIDERS) {
      const el = sliderEls[s.key];
      el.input.value = effect[s.key];
      el.value.textContent = fmt(effect[s.key], el.unit);
    }
  }
  previewImg.style.filter = filterString(effect, 0.5);
  // a sideways picture would overflow the preview box: shrink it to fit
  const sideways = effect.rotate === 90 || effect.rotate === 270;
  const t = transformString(effect);
  previewImg.style.transform = sideways ? `${t === 'none' ? '' : t} scale(0.58)` : t;
  $('rotVal').textContent = `${effect.rotate}°`;
  $('flipH').classList.toggle('active', effect.flipH);
  $('flipV').classList.toggle('active', effect.flipV);

  // highlight the preset that matches the current colour settings, if any
  for (const b of $('presets').children) {
    const p = normalizeEffect({ ...DEFAULT_EFFECT, ...PRESETS[b.dataset.preset] });
    const match = SLIDERS.every((s) => p[s.key] === effect[s.key]);
    b.classList.toggle('active', match);
  }

  const active = isEffectActive(effect);
  const status = $('effectStatus');
  status.classList.toggle('on', active);
  status.textContent = active
    ? 'Effect on: images are edited before saving. JPG, PNG and WebP keep their format; other formats are saved as PNG.'
    : 'No effect: the original image file is downloaded.';
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
  render(updateSliders);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 120);
}
window.addEventListener('pagehide', flushSave);

// ---- Init --------------------------------------------------------------------------
loadSettings().then((s) => {
  enabledEl.checked = s.enabled;
  effect = s.effect;
  renderEnabled();
  render(true);
});
