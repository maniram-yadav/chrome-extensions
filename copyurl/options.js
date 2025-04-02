document.addEventListener('DOMContentLoaded', function() {
    // Load current settings
    chrome.storage.local.get({
      fileName: 'urls.txt',
      appendTimestamp: true,
      format: '[{timestamp}] {url}'
    }, function(settings) {
      document.getElementById('fileName').value = settings.fileName;
      document.getElementById('appendTimestamp').checked = settings.appendTimestamp;
      document.getElementById('format').value = settings.format;
      updateFileContent(settings.fileName);
    });
  
    // Display current shortcut
    chrome.commands.getAll((commands) => {
      const copyCommand = commands.find(cmd => cmd.name === 'append-url');
      if (copyCommand) {
        document.getElementById('current-shortcut').textContent = 
          copyCommand.shortcut || 'Not set';
      }
    });
  
    // Save settings
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
  
    // Change shortcut button
    document.getElementById('change-shortcut').addEventListener('click', () => {
      chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
    });
  
    // Download file button
    document.getElementById('downloadFile').addEventListener('click', downloadFile);
  
    // Clear file button
    document.getElementById('clearFile').addEventListener('click', clearFile);
  
    // Update file content when filename changes
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
      chrome.storage.local.get([fileKey], function(result) {
        document.getElementById('fileContent').value = result[fileKey] || '';
      });
    }
  
    function downloadFile() {
      const fileName = document.getElementById('fileName').value;
      const fileKey = `file_${fileName}`;
      
      chrome.storage.local.get([fileKey], function(result) {
        const content = result[fileKey] || '';
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }
  
    function clearFile() {
      if (confirm('Are you sure you want to clear the file?')) {
        const fileName = document.getElementById('fileName').value;
        const fileKey = `file_${fileName}`;
        
        chrome.storage.local.set({ [fileKey]: '' }, () => {
          updateFileContent(fileName);
        });
      }
    }
  });