document.addEventListener('DOMContentLoaded', () => {
  // Load settings
  chrome.storage.local.get({
    fileName: 'saved_text.txt',
    appendTimestamp: true,
    format: '[{timestamp}] {text}'
  }, (settings) => {
    document.getElementById('fileName').value = settings.fileName;
    document.getElementById('appendTimestamp').checked = settings.appendTimestamp;
    document.getElementById('format').value = settings.format;
    updateFileContent(settings.fileName);
  });

  // Load shortcut
  chrome.commands.getAll(commands => {
    const cmd = commands.find(c => c.name === 'save-selection');
    if (cmd) document.getElementById('shortcut').textContent = cmd.shortcut;
  });

  // Event listeners
  document.getElementById('save').addEventListener('click', saveSettings);
  document.getElementById('download').addEventListener('click', downloadFile);
  document.getElementById('clear').addEventListener('click', clearFile);
  document.getElementById('changeShortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  document.getElementById('fileName').addEventListener('input', function() {
    updateFileContent(this.value);
  });

  function saveSettings() {
    const settings = {
      fileName: document.getElementById('fileName').value,
      appendTimestamp: document.getElementById('appendTimestamp').checked,
      format: document.getElementById('format').value
    };
    
    chrome.storage.local.set(settings, () => {
      alert('Settings saved!');
      updateFileContent(settings.fileName);
    });
  }

  function updateFileContent(fileName) {
    const fileKey = `file_${fileName}`;
    chrome.storage.local.get([fileKey], result => {
      document.getElementById('fileContent').value = result[fileKey] || '';
    });
  }

  function downloadFile() {
    const fileName = document.getElementById('fileName').value;
    const fileKey = `file_${fileName}`;
    
    chrome.storage.local.get([fileKey], result => {
      const content = result[fileKey] || '';
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function clearFile() {
    if (confirm('Clear all saved text?')) {
      const fileName = document.getElementById('fileName').value;
      const fileKey = `file_${fileName}`;
      
      chrome.storage.local.set({ [fileKey]: '' }, () => {
        updateFileContent(fileName);
      });
    }
  }
});