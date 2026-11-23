const status = document.getElementById('status');

async function request() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.className = 'ok';
    status.textContent = '✔ Microphone allowed. This tab will close — click the extension icon and start recording.';
    setTimeout(() => window.close(), 2000);
  } catch (e) {
    status.className = 'err';
    status.textContent =
      e.name === 'NotAllowedError'
        ? '✖ Permission denied. Click the camera/mic icon in the address bar (or chrome://settings/content/microphone) to allow it, then try again.'
        : '✖ ' + (e.message || e.name) + ' — is a microphone connected?';
  }
}

document.getElementById('allow').addEventListener('click', request);
request();
