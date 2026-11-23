// Content script: area selection overlay + recording frame + floating stop toolbar.
(() => {
  if (window.__areaVideoRecorder) return;
  window.__areaVideoRecorder = true;

  const Z = 2147483647;
  let host = null;
  let root = null;
  let timerId = null;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = 'area-video-recorder-host';
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};pointer-events:none;`;
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .overlay { position: fixed; inset: 0; cursor: crosshair; pointer-events: auto; background: rgba(0,0,0,.35); }
        .sel { position: fixed; border: 2px dashed #fff; outline: 1px solid rgba(0,0,0,.6);
               background: transparent; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); display: none; }
        .overlay.dragging { background: transparent; }
        .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
                background: #111827; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px;
                box-shadow: 0 4px 16px rgba(0,0,0,.3); pointer-events: none; white-space: nowrap; }
        .hint b { color: #fca5a5; }
        .size { position: fixed; background: #111827; color: #fff; font-size: 11px; padding: 2px 6px;
                border-radius: 4px; pointer-events: none; display: none; }
        .edge { position: fixed; background: #e11d48; pointer-events: none; }
        .bar { position: fixed; display: flex; align-items: center; gap: 8px; pointer-events: auto;
               background: #111827; color: #fff; padding: 6px 8px 6px 10px; border-radius: 999px;
               font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.35); user-select: none; cursor: move; }
        .dot { width: 10px; height: 10px; border-radius: 50%; background: #e11d48; animation: blink 1s infinite; }
        @keyframes blink { 50% { opacity: .25; } }
        .time { font-variant-numeric: tabular-nums; min-width: 42px; }
        button { all: unset; cursor: pointer; background: #e11d48; color: #fff; padding: 4px 12px;
                 border-radius: 999px; font-size: 12px; font-weight: 600; }
        button:hover { background: #be123c; }
        .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #b91c1c;
                 color: #fff; padding: 10px 14px; border-radius: 8px; font-size: 13px; pointer-events: auto; }
      </style>`;
    document.documentElement.appendChild(host);
  }

  function removeHost() {
    clearInterval(timerId);
    timerId = null;
    if (host) host.remove();
    host = root = null;
  }

  // ---- Selection ----------------------------------------------------------

  function startSelection(mode) {
    removeHost();
    if (mode === 'full') {
      // Whole visible tab.
      finishSelection({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      return;
    }
    ensureHost();
    const overlay = el('div', 'overlay');
    const sel = el('div', 'sel');
    const hint = el('div', 'hint');
    hint.innerHTML = 'Drag to select the area to record &nbsp;·&nbsp; <b>Enter</b> = whole tab &nbsp;·&nbsp; <b>Esc</b> = cancel';
    const size = el('div', 'size');
    root.append(overlay, sel, hint, size);

    let start = null, rect = null;

    const onDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start = { x: e.clientX, y: e.clientY };
      overlay.classList.add('dragging');
      hint.style.display = 'none';
    };
    const onMove = (e) => {
      if (!start) return;
      const x = Math.max(0, Math.min(start.x, e.clientX));
      const y = Math.max(0, Math.min(start.y, e.clientY));
      const x2 = Math.min(window.innerWidth, Math.max(start.x, e.clientX));
      const y2 = Math.min(window.innerHeight, Math.max(start.y, e.clientY));
      rect = { x, y, w: x2 - x, h: y2 - y };
      Object.assign(sel.style, { display: 'block', left: x + 'px', top: y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
      size.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
      Object.assign(size.style, { display: 'block', left: x + 'px', top: Math.max(0, y - 22) + 'px' });
    };
    const onUp = () => {
      if (!start) return;
      start = null;
      if (!rect || rect.w < 20 || rect.h < 20) {
        // Too small: reset and let the user try again.
        sel.style.display = size.style.display = 'none';
        overlay.classList.remove('dragging');
        hint.style.display = 'block';
        rect = null;
        return;
      }
      teardown();
      finishSelection(rect);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        teardown();
        removeHost();
        chrome.runtime.sendMessage({ type: 'vr-selection-cancelled' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        teardown();
        finishSelection({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
      }
    };
    function teardown() {
      overlay.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
    }
    overlay.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('keydown', onKey, true);
  }

  function finishSelection(rect) {
    removeHost();
    const r = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.w), h: Math.round(rect.h),
    };
    // Give the page a moment to repaint without the overlay before recording starts.
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'vr-area-selected',
        rect: r,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      });
    }, 200);
  }

  // ---- Recording UI -----------------------------------------------------

  function showRecordingUI(rect, startedAt) {
    removeHost();
    ensureHost();
    const vw = window.innerWidth, vh = window.innerHeight;
    const t = 2; // border thickness, drawn just OUTSIDE the recorded area
    const edges = [
      { left: rect.x - t, top: rect.y - t, width: rect.w + 2 * t, height: t },
      { left: rect.x - t, top: rect.y + rect.h, width: rect.w + 2 * t, height: t },
      { left: rect.x - t, top: rect.y, width: t, height: rect.h },
      { left: rect.x + rect.w, top: rect.y, width: t, height: rect.h },
    ];
    edges.forEach((e) => {
      const d = el('div', 'edge');
      Object.keys(e).forEach((k) => (d.style[k] = e[k] + 'px'));
      root.appendChild(d);
    });

    const bar = el('div', 'bar');
    bar.title = 'Drag to move';
    bar.innerHTML = '<span class="dot"></span><span class="time">00:00</span><button type="button">Stop</button>';
    root.appendChild(bar);

    // Place the toolbar outside the recorded area when possible.
    const BW = 150, BH = 36, gap = 8;
    let pos;
    if (rect.y + rect.h + gap + BH <= vh) pos = { left: rect.x, top: rect.y + rect.h + gap };
    else if (rect.y - gap - BH >= 0) pos = { left: rect.x, top: rect.y - gap - BH };
    else if (rect.x + rect.w + gap + BW <= vw) pos = { left: rect.x + rect.w + gap, top: rect.y };
    else if (rect.x - gap - BW >= 0) pos = { left: rect.x - gap - BW, top: rect.y };
    else pos = { left: vw - BW - 12, top: vh - BH - 12 }; // covers area — user can drag it away
    pos.left = Math.max(4, Math.min(vw - BW - 4, pos.left));
    bar.style.left = pos.left + 'px';
    bar.style.top = pos.top + 'px';

    const timeEl = bar.querySelector('.time');
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    timerId = setInterval(tick, 500);

    const btn = bar.querySelector('button');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.textContent = 'Saving…';
      chrome.runtime.sendMessage({ type: 'vr-stop' });
    });

    // Draggable toolbar.
    let drag = null;
    bar.addEventListener('mousedown', (e) => {
      if (e.target === btn) return;
      drag = { dx: e.clientX - bar.offsetLeft, dy: e.clientY - bar.offsetTop };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      bar.style.left = e.clientX - drag.dx + 'px';
      bar.style.top = e.clientY - drag.dy + 'px';
    }, true);
    window.addEventListener('mouseup', () => (drag = null), true);
  }

  function toast(text) {
    ensureHost();
    const d = el('div', 'toast');
    d.textContent = text;
    root.appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    e.className = cls;
    return e;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'vr-select': startSelection(msg.mode); break;
      case 'vr-recording-started': showRecordingUI(msg.rect, msg.startedAt); break;
      case 'vr-cleanup': removeHost(); break;
      case 'vr-error': removeHost(); toast(msg.error); break;
    }
  });
})();
