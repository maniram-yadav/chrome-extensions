// Service worker: orchestrates selection (content script), capture (offscreen doc) and state.

const OFFSCREEN_URL = 'offscreen.html';

async function getState() {
  const { recState } = await chrome.storage.session.get('recState');
  return recState || { status: 'idle' };
}

async function setState(state) {
  await chrome.storage.session.set({ recState: state });
  if (state.status === 'recording') {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Capture tab video/audio and microphone, and record them with MediaRecorder.',
  });
}

async function closeOffscreen() {
  if (await hasOffscreen()) {
    try { await chrome.offscreen.closeDocument(); } catch (_) {}
  }
}

function toOffscreen(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
}

async function injectContent(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

function sendToTab(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

// ---- Flow ---------------------------------------------------------------

async function startSelection({ mode, options }) {
  const state = await getState();
  if (state.status !== 'idle') throw new Error('A recording is already in progress.');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('No active tab.');
  if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || '') ||
      (tab.url || '').startsWith('https://chromewebstore.google.com')) {
    throw new Error('This page cannot be recorded (browser internal page).');
  }

  await ensureOffscreen();
  // Must be called while the extension is "invoked" on the tab (popup is open).
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const prep = await toOffscreen({ type: 'prepare', streamId, options });
  if (!prep || !prep.ok) {
    await closeOffscreen();
    throw new Error((prep && prep.error) || 'Could not start tab capture.');
  }

  await setState({ status: 'selecting', tabId: tab.id, options });
  try {
    await injectContent(tab.id);
  } catch (e) {
    await cancel();
    throw new Error('Cannot access this page: ' + e.message);
  }
  await sendToTab(tab.id, { type: 'vr-select', mode });
  return { ok: true, warning: prep.warning };
}

async function onAreaSelected(tabId, { rect, viewport }) {
  const state = await getState();
  if (state.status !== 'selecting' || state.tabId !== tabId) return;
  const res = await toOffscreen({ type: 'start', rect, viewport, label: state.options.label });
  if (!res || !res.ok) {
    await cancel();
    sendToTab(tabId, { type: 'vr-error', error: (res && res.error) || 'Failed to start recording.' });
    return;
  }
  const startedAt = Date.now();
  await setState({ ...state, status: 'recording', rect, viewport, startedAt });
  sendToTab(tabId, { type: 'vr-recording-started', rect, startedAt });
}

async function stop() {
  const state = await getState();
  if (state.status !== 'recording') return;
  await setState({ ...state, status: 'saving' });
  let res;
  try { res = await toOffscreen({ type: 'stop' }); } catch (e) { res = { ok: false, error: e.message }; }
  await onSaved(res || {});
}

async function cancel() {
  const state = await getState();
  if (state.tabId) sendToTab(state.tabId, { type: 'vr-cleanup' });
  try { await toOffscreen({ type: 'cancel' }); } catch (_) {}
  await closeOffscreen();
  await setState({ status: 'idle' });
}

async function onSaved(msg) {
  const state = await getState();
  if (state.tabId) sendToTab(state.tabId, { type: 'vr-cleanup' });
  await closeOffscreen();
  await setState({ status: 'idle' });
  chrome.runtime.sendMessage({ type: 'vr-recordings-updated', id: msg.id, error: msg.error }).catch(() => {});
}

// ---- Messaging ------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return false; // not for us

  const reply = (p) => {
    p.then((r) => sendResponse(r ?? { ok: true }))
     .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  };

  switch (msg.type) {
    case 'vr-start-selection': return reply(startSelection(msg));
    case 'vr-area-selected': return reply(onAreaSelected(sender.tab && sender.tab.id, msg));
    case 'vr-selection-cancelled': return reply(cancel());
    case 'vr-stop': return reply(stop());
    case 'vr-cancel': return reply(cancel());
    case 'vr-get-state': return reply(getState());
    case 'vr-capture-ended': return reply(stop()); // tab closed / capture ended
    default: return false;
  }
});

// Re-inject the recording toolbar if the recorded tab navigates.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const state = await getState();
  if (state.status === 'recording' && state.tabId === tabId) {
    try {
      await injectContent(tabId);
      sendToTab(tabId, { type: 'vr-recording-started', rect: state.rect, startedAt: state.startedAt });
    } catch (_) {}
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.tabId !== tabId) return;
  if (state.status === 'recording') stop();
  else if (state.status === 'selecting') cancel();
});

// Reset stale state when the extension starts.
chrome.runtime.onStartup.addListener(() => setState({ status: 'idle' }));
chrome.runtime.onInstalled.addListener(() => setState({ status: 'idle' }));
