// Offscreen document: holds the tab capture stream, crops each frame to the
// selected area, draws the label, mixes tab audio + mic, and records.

let tabStream = null;
let micStream = null;
let audioCtx = null;
let mixDest = null;
let options = null;
let recorder = null;
let chunks = [];
let pipelineAbort = null;
let startedAt = 0;
let outSize = { w: 0, h: 0 };
let mimeType = '';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;
  const handlers = { prepare, start, stop, cancel };
  const fn = handlers[msg.type];
  if (!fn) return false;
  Promise.resolve(fn(msg))
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

// 1) Acquire streams as soon as the user clicks "Select area" (stream id expires quickly).
async function prepare({ streamId, options: opts }) {
  await cleanup();
  options = opts || {};
  let warning = '';

  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: options.fps || 30,
      },
    },
  });

  audioCtx = new AudioContext();
  mixDest = audioCtx.createMediaStreamDestination();

  // Tab capture mutes the tab for the user; route it back to the speakers.
  if (tabStream.getAudioTracks().length) {
    const tabSrc = audioCtx.createMediaStreamSource(tabStream);
    tabSrc.connect(audioCtx.destination);
    if (options.tabAudio !== false) tabSrc.connect(mixDest);
  }

  if (options.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      audioCtx.createMediaStreamSource(micStream).connect(mixDest);
    } catch (e) {
      warning = 'Microphone unavailable (' + e.name + '). Use "Grant mic access" in the popup. Recording without mic.';
    }
  }

  tabStream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder && recorder.state === 'recording') {
      chrome.runtime.sendMessage({ type: 'vr-capture-ended' });
    }
  });

  return { ok: true, warning };
}

function pickMime(format) {
  const mp4 = ['video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const list = format === 'mp4' ? [...mp4, ...webm] : [...webm, ...mp4];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// 2) User finished selecting: build crop pipeline and start MediaRecorder.
async function start({ rect, viewport, label }) {
  if (!tabStream) throw new Error('Capture not prepared.');
  const videoTrack = tabStream.getVideoTracks()[0];
  const settings = videoTrack.getSettings();
  const scale0 = (settings.width || viewport.w) / viewport.w;
  outSize = { w: even(rect.w * scale0), h: even(rect.h * scale0) };

  const canvas = new OffscreenCanvas(outSize.w, outSize.h);
  const ctx = canvas.getContext('2d');

  const processor = new MediaStreamTrackProcessor({ track: videoTrack });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const reader = processor.readable.getReader();
  const writer = generator.writable.getWriter();
  pipelineAbort = { stopped: false, reader, writer };

  (async () => {
    while (!pipelineAbort.stopped) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      try {
        const fw = frame.displayWidth, fh = frame.displayHeight;
        const sx = fw / viewport.w, sy = fh / viewport.h;
        ctx.drawImage(frame, rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy, 0, 0, outSize.w, outSize.h);
        drawLabel(ctx, label, outSize.w, outSize.h, outSize.w / rect.w);
        const out = new VideoFrame(canvas, { timestamp: frame.timestamp });
        frame.close();
        await writer.write(out);
        out.close();
      } catch (e) {
        try { frame.close(); } catch (_) {}
        if (pipelineAbort.stopped) break;
        console.warn('frame error', e);
      }
    }
  })();

  const tracks = [generator];
  if (mixDest && (options.tabAudio !== false || micStream)) {
    tracks.push(...mixDest.stream.getAudioTracks());
  }
  const recStream = new MediaStream(tracks);

  mimeType = pickMime(options.format);
  recorder = new MediaRecorder(recStream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: options.bitrate || 6_000_000,
    audioBitsPerSecond: 128_000,
  });
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start(1000);
  startedAt = Date.now();
  return { ok: true };
}

function drawLabel(ctx, label, W, H, scale) {
  if (!label || !label.text || !label.text.trim()) return;
  const size = Math.max(4, (Number(label.size) || 24) * scale);
  const lines = label.text.split('\n');
  ctx.save();
  ctx.font = `${label.bold ? 'bold ' : ''}${size}px ${label.font || 'Arial, sans-serif'}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const lineH = size * 1.2;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const pad = label.background ? size * 0.35 : 0;
  const boxW = textW + pad * 2;
  const boxH = lines.length * lineH + pad * 2;
  const margin = size * 0.6;

  const [v, h] = (label.position || 'top-left').split('-'); // e.g. "middle-center"
  let cx, cy;
  if (h === 'left') cx = margin + boxW / 2;
  else if (h === 'right') cx = W - margin - boxW / 2;
  else cx = W / 2;
  if (v === 'top') cy = margin + boxH / 2;
  else if (v === 'bottom') cy = H - margin - boxH / 2;
  else cy = H / 2;

  ctx.translate(cx, cy);
  ctx.rotate(((Number(label.rotation) || 0) * Math.PI) / 180);

  if (label.background) {
    ctx.globalAlpha = label.bgOpacity ?? 0.6;
    ctx.fillStyle = label.bgColor || '#000000';
    ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = label.color || '#ffffff';
  if (!label.background) {
    ctx.lineWidth = Math.max(1, size / 10);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  }
  lines.forEach((line, i) => {
    const y = -boxH / 2 + pad + lineH * (i + 0.5);
    if (!label.background) ctx.strokeText(line, 0, y);
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

// 3) Stop and save to IndexedDB.
async function stop() {
  if (!recorder || recorder.state === 'inactive') {
    await cleanup();
    return { ok: false, error: 'Nothing was recorded.' };
  }
  const done = new Promise((r) => { recorder.onstop = r; });
  recorder.stop();
  await done;

  const duration = Date.now() - startedAt;
  const type = (mimeType || 'video/webm').split(';')[0];
  const blob = new Blob(chunks, { type });
  const id = 'rec_' + Date.now();
  let error;
  try {
    await RecDB.add({
      id,
      name: '',
      createdAt: Date.now(),
      duration,
      size: blob.size,
      mime: type,
      ext: type === 'video/mp4' ? 'mp4' : 'webm',
      width: outSize.w,
      height: outSize.h,
      blob,
    });
  } catch (e) {
    error = 'Failed to save recording: ' + e.message;
  }
  await cleanup();
  return error ? { ok: false, error } : { ok: true, id };
}

async function cancel() {
  await cleanup();
  return { ok: true };
}

async function cleanup() {
  if (pipelineAbort) {
    pipelineAbort.stopped = true;
    try { pipelineAbort.reader.cancel(); } catch (_) {}
    try { pipelineAbort.writer.close(); } catch (_) {}
    pipelineAbort = null;
  }
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch (_) {}
  }
  recorder = null;
  chunks = [];
  [tabStream, micStream].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
  tabStream = micStream = null;
  if (audioCtx) { try { await audioCtx.close(); } catch (_) {} }
  audioCtx = mixDest = null;
}
