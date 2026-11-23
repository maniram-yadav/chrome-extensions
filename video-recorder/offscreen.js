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

  if (options.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // AGC pumps the voice up and makes it too loud
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    } catch (e) {
      warning = 'Microphone unavailable (' + e.name + '). Use "Grant mic access" in the popup. Recording without mic.';
    }
  }

  buildAudioGraph();

  tabStream.getVideoTracks()[0].addEventListener('ended', () => {
    if (recorder && recorder.state === 'recording') {
      chrome.runtime.sendMessage({ type: 'vr-capture-ended' });
    }
  });

  return { ok: true, warning };
}

// Audio: decides which audio track goes into the recording.
//  - single source at 100% volume → the raw track is recorded directly (no resampling/mixing).
//  - otherwise → AudioContext mix with per-source gain + high-pass on mic + limiter.
// The tab is always played back to the speakers (tab capture mutes it otherwise).
let recordAudioTracks = [];
function buildAudioGraph() {
  recordAudioTracks = [];
  const tabTrack = tabStream.getAudioTracks()[0] || null;
  const micTrack = micStream ? micStream.getAudioTracks()[0] : null;
  const useTab = !!tabTrack && options.tabAudio !== false;
  const useMic = !!micTrack;
  const tabVol = (options.tabVolume ?? 100) / 100;
  const micVol = (options.micVolume ?? 100) / 100;

  audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'balanced' });

  if (tabTrack) {
    // Monitoring only (what the user hears) — not part of the recorded mix path.
    audioCtx.createMediaStreamSource(new MediaStream([tabTrack])).connect(audioCtx.destination);
  }

  if (useTab && !useMic && tabVol === 1) { recordAudioTracks = [tabTrack]; return; }
  if (useMic && !useTab && micVol === 1) { recordAudioTracks = [micTrack]; return; }
  if (!useTab && !useMic) return;

  mixDest = audioCtx.createMediaStreamDestination();
  // Limiter so summed sources never clip (clipping = crackle/distortion).
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(mixDest);

  if (useTab) {
    const g = audioCtx.createGain();
    g.gain.value = tabVol;
    audioCtx.createMediaStreamSource(new MediaStream([tabTrack])).connect(g);
    g.connect(limiter);
  }
  if (useMic) {
    const hp = audioCtx.createBiquadFilter(); // cut rumble/hum below 80 Hz
    hp.type = 'highpass';
    hp.frequency.value = 80;
    const g = audioCtx.createGain();
    g.gain.value = micVol;
    audioCtx.createMediaStreamSource(micStream).connect(hp);
    hp.connect(g);
    g.connect(limiter);
  }
  recordAudioTracks = mixDest.stream.getAudioTracks();
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
  const ticker = new Worker('ticker.js');
  const pipe = { stopped: false, reader, writer, ticker, latest: null };
  pipelineAbort = pipe;

  const pxScale = outSize.w / rect.w; // CSS px → video px
  const fx = VREffects.create(options.effects, outSize.w, outSize.h, pxScale);

  // Reader: just keep the newest captured frame (tab capture only delivers frames
  // when the page changes, so they arrive irregularly).
  (async () => {
    while (!pipe.stopped) {
      const { value: frame, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      if (pipe.stopped) { frame.close(); break; }
      if (pipe.latest) pipe.latest.close();
      pipe.latest = frame;
    }
  })();

  // Ticker: emit frames at a CONSTANT rate with timestamps from one monotonic clock.
  // Irregular / foreign-clock video timestamps make MediaRecorder glitch the audio.
  const t0 = performance.now();
  let hasImage = false;
  let busy = false;
  ticker.onmessage = async () => {
    if (pipe.stopped || busy) return;
    busy = true;
    try {
      const frame = pipe.latest;
      if (frame) {
        pipe.latest = null;
        const sx = frame.displayWidth / viewport.w, sy = frame.displayHeight / viewport.h;
        fx.drawFrame(ctx, frame, [rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy]);
        frame.close();
        drawLabel(ctx, label, outSize.w, outSize.h, pxScale);
        hasImage = true;
      }
      if (hasImage) {
        const out = new VideoFrame(canvas, { timestamp: Math.round((performance.now() - t0) * 1000) });
        await writer.write(out);
        out.close();
      }
    } catch (e) {
      if (!pipe.stopped) console.warn('frame error', e);
    } finally {
      busy = false;
    }
  };
  ticker.postMessage({ fps: options.fps || 30 });

  const recStream = new MediaStream([generator, ...recordAudioTracks]);

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
    const p = pipelineAbort;
    p.stopped = true;
    p.ticker.terminate();
    if (p.latest) { try { p.latest.close(); } catch (_) {} p.latest = null; }
    p.reader.cancel().catch(() => {});
    p.writer.close().catch(() => {});
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
  recordAudioTracks = [];
}
