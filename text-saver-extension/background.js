chrome.commands.onCommand.addListener(async (command) => {
  if (command === "save-selection") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Send message to content script to get selection
    chrome.tabs.sendMessage(tab.id, { action: "getSelection" }, async (response) => {
      if (response && response.selection) {
        const settings = await chrome.storage.local.get({
          fileName: 'saved_text.txt',
          appendTimestamp: true,
          format: '[{timestamp}] {text}'
        });

        // Format the entry
        let entry = settings.format.replace('{text}', response.selection);
        
        if (settings.appendTimestamp) {
          const timestamp = new Date().toISOString();
          entry = entry.replace('{timestamp}', timestamp);
        }

        // Save to file
        const fileKey = `file_${settings.fileName}`;
        const result = await chrome.storage.local.get([fileKey]);
        const currentContent = result[fileKey] || '';
        const newContent = currentContent + entry + '\n';
        
        await chrome.storage.local.set({ [fileKey]: newContent });
        
        // Copy to clipboard
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (text) => navigator.clipboard.writeText(text),
          args: [response.selection]
        });

        // Show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Text Saver',
          message: `Text saved to ${settings.fileName}`,
          priority: 1
        });
      }
    });
  }
});