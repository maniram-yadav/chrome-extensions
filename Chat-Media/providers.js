// Provider adapters for OpenAI, Google Gemini and xAI Grok.
// Every generator resolves to one of:
//   { kind: 'text',  text }
//   { kind: 'image', blob, caption?, sourceUrl? }
//   { kind: 'video', blob, sourceUrl? }

const OPENAI = 'https://api.openai.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const XAI = 'https://api.x.ai/v1';

export const MEDIA_TYPES = ['text', 'image', 'video'];

// Default model lists. Model IDs change often, so the panel also has a
// "refresh" button that loads the live list from the provider, plus a
// "Custom model ID" option.
export const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    models: {
      text: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o-mini'],
      image: ['gpt-image-1', 'gpt-image-1-mini', 'dall-e-3'],
      video: [],
    },
    unsupported: {
      video: 'OpenAI shut down its Sora video API on 24 Sep 2026, so OpenAI can no longer generate video. Choose Gemini or Grok for video.',
    },
  },
  gemini: {
    name: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    models: {
      text: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
      image: ['gemini-2.5-flash-image', 'imagen-4.0-generate-001', 'imagen-4.0-fast-generate-001'],
      video: ['veo-3.0-generate-001', 'veo-3.0-fast-generate-001'],
    },
  },
  xai: {
    name: 'Grok (xAI)',
    keyPlaceholder: 'xai-...',
    models: {
      text: ['grok-4', 'grok-4-fast-reasoning', 'grok-3-mini'],
      image: ['grok-imagine-image-2.0', 'grok-imagine-image-quality'],
      video: ['grok-imagine-video-1.5', 'grok-imagine-video'],
    },
  },
};

/* ------------------------------------------------------------------ */
/* Aspect ratios                                                       */
/* ------------------------------------------------------------------ */

function ratioLabel(r) {
  const [w, h] = r.split(':').map(Number);
  return `${r} · ${w === h ? 'Square' : w > h ? 'Landscape' : 'Portrait'}`;
}
const ratios = (...list) => list.map((r) => ({ value: r, label: ratioLabel(r) }));

// The aspect ratios a model accepts, as { value, label }. `value` is what gets
// sent to the API: a "W:H" ratio, or a pixel size for OpenAI. An empty list
// means the model has no choice (or the type has no aspect ratio, e.g. text).
export function aspectOptions(provider, type, model = '') {
  const m = model.toLowerCase();
  if (type === 'image') {
    if (provider === 'openai') {
      if (m.startsWith('dall-e-2')) return []; // square only
      if (m.startsWith('dall-e-3')) {
        return [
          { value: '1024x1024', label: '1:1 · Square (1024×1024)' },
          { value: '1792x1024', label: '7:4 · Landscape (1792×1024)' },
          { value: '1024x1792', label: '4:7 · Portrait (1024×1792)' },
        ];
      }
      return [
        { value: '1024x1024', label: '1:1 · Square (1024×1024)' },
        { value: '1536x1024', label: '3:2 · Landscape (1536×1024)' },
        { value: '1024x1536', label: '2:3 · Portrait (1024×1536)' },
      ];
    }
    if (provider === 'gemini') {
      if (m.includes('imagen')) return ratios('1:1', '4:3', '3:4', '16:9', '9:16');
      return ratios('1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9');
    }
    if (provider === 'xai') return ratios('1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16');
  }
  if (type === 'video') {
    if (provider === 'gemini') return ratios('16:9', '9:16');
    if (provider === 'xai') return ratios('16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3');
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const bearer = (key) => ({ Authorization: `Bearer ${key}` });
const googKey = (key) => ({ 'x-goog-api-key': key });

// Image/video prompts have no system role, so the system prompt is prepended.
const mergePrompt = (system, input) => [system, input].filter(Boolean).join('\n\n');

// With only a system prompt (no user input) it is sent as the user message,
// because some APIs reject a request that has no user turn.
function chatMessages(system, input) {
  if (system && input) {
    return [
      { role: 'system', content: system },
      { role: 'user', content: input },
    ];
  }
  return [{ role: 'user', content: system || input }];
}

function errorMessage(data) {
  if (Array.isArray(data)) data = data[0];
  const err = data?.error;
  if (typeof err === 'string') return err;
  return err?.message || data?.message || data?.detail || (data?.raw ? String(data.raw).slice(0, 300) : '');
}

async function call(url, { method = 'POST', headers = {}, body, signal } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Network error: ${e.message}`);
  }
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }
  if (!res.ok) throw new Error(`${res.status} ${errorMessage(data) || res.statusText}`.trim());
  return data;
}

function sniffMime(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return '';
}

function b64ToBlob(b64, fallbackMime) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: sniffMime(bytes) || fallbackMime });
}

async function fetchBlob(url, headers, signal) {
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`Couldn't download the generated file (${res.status}).`);
  const blob = await res.blob();
  const mime = sniffMime(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  return mime && mime !== blob.type ? new Blob([blob], { type: mime }) : blob;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

// Calls check() every `interval` ms until it returns something other than undefined.
async function poll(check, { interval, signal, timeoutMs = 20 * 60 * 1000 }) {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the video to finish.');
    await sleep(interval, signal);
  }
}

function chatText(data) {
  const msg = data?.choices?.[0]?.message;
  let text = '';
  if (typeof msg?.content === 'string') text = msg.content;
  else if (Array.isArray(msg?.content)) text = msg.content.map((p) => p.text || '').join('');
  if (text.trim()) return text;
  if (msg?.refusal) throw new Error(`The model refused: ${msg.refusal}`);
  throw new Error('The model returned an empty response.');
}

// OpenAI and xAI share the same images response shape.
async function imageFromData(data, signal) {
  const item = data?.data?.[0];
  if (item?.b64_json) {
    return { kind: 'image', blob: b64ToBlob(item.b64_json, 'image/png'), caption: item.revised_prompt };
  }
  if (item?.url) {
    return { kind: 'image', blob: await fetchBlob(item.url, {}, signal), sourceUrl: item.url, caption: item.revised_prompt };
  }
  throw new Error('The response contained no image.');
}

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

const openai = {
  async text({ model, apiKey, system, input, signal }) {
    const data = await call(`${OPENAI}/chat/completions`, {
      headers: bearer(apiKey),
      body: { model, messages: chatMessages(system, input) },
      signal,
    });
    return { kind: 'text', text: chatText(data) };
  },

  async image({ model, apiKey, system, input, aspect, signal }) {
    const body = { model, prompt: mergePrompt(system, input), n: 1 };
    if (aspect) body.size = aspect;
    // gpt-image models always return base64 and reject response_format.
    if (/^dall-e/i.test(model)) body.response_format = 'b64_json';
    const data = await call(`${OPENAI}/images/generations`, { headers: bearer(apiKey), body, signal });
    return imageFromData(data, signal);
  },
};

/* ------------------------------------------------------------------ */
/* Google Gemini                                                       */
/* ------------------------------------------------------------------ */

const geminiModel = (model) => `${GEMINI}/models/${encodeURIComponent(model.replace(/^models\//, ''))}`;

function geminiParts(data) {
  const cand = data?.candidates?.[0];
  return { parts: cand?.content?.parts || [], finish: cand?.finishReason, block: data?.promptFeedback?.blockReason };
}

const gemini = {
  async text({ model, apiKey, system, input, signal }) {
    const body = { contents: [{ role: 'user', parts: [{ text: input || system }] }] };
    if (system && input) body.systemInstruction = { parts: [{ text: system }] };
    const data = await call(`${geminiModel(model)}:generateContent`, { headers: googKey(apiKey), body, signal });
    const { parts, finish, block } = geminiParts(data);
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (text.trim()) return { kind: 'text', text };
    throw new Error(block ? `Blocked: ${block}` : `The model returned no text${finish ? ` (${finish})` : ''}.`);
  },

  async image({ model, apiKey, system, input, aspect, signal }) {
    const prompt = mergePrompt(system, input);

    // Imagen models use the :predict endpoint.
    if (/imagen/i.test(model)) {
      const data = await call(`${geminiModel(model)}:predict`, {
        headers: googKey(apiKey),
        body: { instances: [{ prompt }], parameters: { sampleCount: 1, ...(aspect && { aspectRatio: aspect }) } },
        signal,
      });
      const pred = data?.predictions?.[0];
      if (!pred?.bytesBase64Encoded) throw new Error('No image returned. The prompt may have been filtered by safety settings.');
      return { kind: 'image', blob: b64ToBlob(pred.bytesBase64Encoded, pred.mimeType || 'image/png') };
    }

    // Gemini image models (e.g. gemini-2.5-flash-image) use generateContent.
    const data = await call(`${geminiModel(model)}:generateContent`, {
      headers: googKey(apiKey),
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(aspect && { imageConfig: { aspectRatio: aspect } }),
        },
      },
      signal,
    });
    const { parts, finish, block } = geminiParts(data);
    const imgPart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const caption = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (!imgPart) {
      if (block) throw new Error(`Blocked: ${block}`);
      throw new Error(caption ? `No image returned. The model said: ${caption}` : `No image returned${finish ? ` (${finish})` : ''}.`);
    }
    const inline = imgPart.inlineData || imgPart.inline_data;
    return { kind: 'image', blob: b64ToBlob(inline.data, inline.mimeType || inline.mime_type || 'image/png'), caption };
  },

  // Veo: start a long-running operation, poll it, then download the file.
  async video({ model, apiKey, system, input, aspect, signal, onProgress }) {
    const op = await call(`${geminiModel(model)}:predictLongRunning`, {
      headers: googKey(apiKey),
      body: {
        instances: [{ prompt: mergePrompt(system, input) }],
        ...(aspect && { parameters: { aspectRatio: aspect } }),
      },
      signal,
    });
    if (!op?.name) throw new Error('The API did not return an operation to track.');
    onProgress?.('Rendering video. This usually takes 1–5 minutes.');

    const done = await poll(
      async () => {
        const s = await call(`${GEMINI}/${op.name}`, { method: 'GET', headers: googKey(apiKey), signal });
        if (s.error) throw new Error(s.error.message || 'Video generation failed.');
        return s.done ? s : undefined;
      },
      { interval: 10000, signal },
    );

    const resp = done.response?.generateVideoResponse || done.response;
    const video = resp?.generatedSamples?.[0]?.video || resp?.videos?.[0];
    if (video?.bytesBase64Encoded) {
      return { kind: 'video', blob: b64ToBlob(video.bytesBase64Encoded, video.mimeType || 'video/mp4') };
    }
    if (!video?.uri) {
      const reasons = resp?.raiMediaFilteredReasons?.join(' ');
      throw new Error(reasons ? `Blocked: ${reasons}` : 'The operation finished but returned no video.');
    }
    onProgress?.('Downloading video…');
    return { kind: 'video', blob: await fetchBlob(video.uri, googKey(apiKey), signal) };
  },
};

/* ------------------------------------------------------------------ */
/* xAI Grok                                                            */
/* ------------------------------------------------------------------ */

const xai = {
  async text({ model, apiKey, system, input, signal }) {
    const data = await call(`${XAI}/chat/completions`, {
      headers: bearer(apiKey),
      body: { model, messages: chatMessages(system, input) },
      signal,
    });
    return { kind: 'text', text: chatText(data) };
  },

  async image({ model, apiKey, system, input, aspect, signal }) {
    const data = await call(`${XAI}/images/generations`, {
      headers: bearer(apiKey),
      body: {
        model,
        prompt: mergePrompt(system, input),
        n: 1,
        response_format: 'b64_json',
        ...(aspect && { aspect_ratio: aspect }),
      },
      signal,
    });
    return imageFromData(data, signal);
  },

  // Start a job, then poll GET /videos/{request_id} until it has a URL.
  async video({ model, apiKey, system, input, aspect, signal, onProgress }) {
    const start = await call(`${XAI}/videos/generations`, {
      headers: bearer(apiKey),
      body: { model, prompt: mergePrompt(system, input), ...(aspect && { aspect_ratio: aspect }) },
      signal,
    });
    const id = start?.request_id || start?.id;
    if (!id) throw new Error('The API did not return a request ID to track.');
    onProgress?.('Rendering video. This usually takes a minute or two.');

    const url = await poll(
      async () => {
        const s = await call(`${XAI}/videos/${encodeURIComponent(id)}`, { method: 'GET', headers: bearer(apiKey), signal });
        const found = s?.video?.url || s?.url || s?.data?.[0]?.url;
        if (found) return found;
        const status = String(s?.status || '').toLowerCase();
        if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status)) {
          throw new Error(errorMessage(s) || `Video generation ${status}.`);
        }
        if (status === 'done' || status === 'completed') throw new Error('The job finished but returned no video URL.');
        if (status) onProgress?.(`Rendering video (${status})…`);
        return undefined;
      },
      { interval: 5000, signal },
    );

    onProgress?.('Downloading video…');
    return { kind: 'video', blob: await fetchBlob(url, {}, signal), sourceUrl: url };
  },
};

const IMPL = { openai, gemini, xai };

export async function generate({ provider, type, ...args }) {
  const fn = IMPL[provider]?.[type];
  if (!fn) {
    throw new Error(PROVIDERS[provider]?.unsupported?.[type] || `${PROVIDERS[provider]?.name || provider} can't generate ${type}.`);
  }
  return fn(args);
}

/* ------------------------------------------------------------------ */
/* Live model lists                                                    */
/* ------------------------------------------------------------------ */

const sortUnique = (arr) => [...new Set(arr)].sort();

export async function listModels(provider, apiKey, signal) {
  const out = { text: [], image: [], video: [] };

  if (provider === 'openai') {
    const data = await call(`${OPENAI}/models`, { method: 'GET', headers: bearer(apiKey), signal });
    for (const { id } of data.data || []) {
      if (/^(gpt-image|dall-e|chatgpt-image)/.test(id)) out.image.push(id);
      else if (/^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct|codex)/.test(id)) out.text.push(id);
    }
  } else if (provider === 'gemini') {
    let pageToken = '';
    do {
      const qs = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const data = await call(`${GEMINI}/models?${qs}`, { method: 'GET', headers: googKey(apiKey), signal });
      for (const m of data.models || []) {
        const id = m.name.replace(/^models\//, '');
        const methods = m.supportedGenerationMethods || [];
        if (methods.includes('predictLongRunning')) out.video.push(id);
        else if (methods.includes('predict') && /imagen/.test(id)) out.image.push(id);
        else if (methods.includes('generateContent') && /image/.test(id)) out.image.push(id);
        else if (methods.includes('generateContent') && !/(tts|embedding|audio|live|veo|imagen)/.test(id)) out.text.push(id);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
  } else if (provider === 'xai') {
    const data = await call(`${XAI}/models`, { method: 'GET', headers: bearer(apiKey), signal });
    for (const { id } of data.data || []) {
      if (/video/.test(id)) out.video.push(id);
      else if (/image/.test(id)) out.image.push(id);
      else if (!/embed/.test(id)) out.text.push(id);
    }
  }

  return { text: sortUnique(out.text), image: sortUnique(out.image), video: sortUnique(out.video) };
}
