// Handle the keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
    if (command === "append-url") {
      appendCurrentUrl();
    }
  });
  
  // Function to append the current URL
  async function appendCurrentUrl() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab && tab.url) {
      try {
        // Get current settings
        const settings = await chrome.storage.local.get({
          fileName: 'urls.txt',
          appendTimestamp: true,
          format: '[{timestamp}] {url}'
        });
  
        // Prepare the entry
        let entry = settings.format.replace('{url}', tab.url);
        
        if (settings.appendTimestamp) {
          const now = new Date();
          const timestamp = now.toISOString();
          entry = entry.replace('{timestamp}', timestamp);
        }
  
        // Get existing content
        const fileKey = `file_${settings.fileName}`;
        const result = await chrome.storage.local.get([fileKey]);
        const currentContent = result[fileKey] || '';
  
        // Append new entry
        const newContent = currentContent + entry + '\n';
        await chrome.storage.local.set({ [fileKey]: newContent });
  
        showNotification(`URL appended to ${settings.fileName}`);
      } catch (err) {
        console.error('Failed to append URL: ', err);
        showNotification('Failed to append URL');
      }
    }
  }
  
  // Show notification to user
  function showNotification(message) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'URL Collector',
      message: message,
      priority: 1
    });
  }