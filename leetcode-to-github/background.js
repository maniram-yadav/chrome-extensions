// In background.js
chrome.commands.onCommand.addListener((command) => {
  console.log("Comand received");
  if (command === 'save-to-github') {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      console.log("Checking for leetcode");
      if (!tabs[0].url.includes('leetcode.com/problems/')) {
        
        console.log("Not on Leetcode page");
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'LeetCode to GitHub',
          message: 'Please navigate to a LeetCode problem page first'
        });
        return;
      }
      
      
      chrome.scripting.executeScript({
        target: {tabId: tabs[0].id},
        files: ['content.js']
      }, () => {

        if (chrome.runtime.lastError) {
          console.error('Injection failed:', chrome.runtime.lastError);
          return;
        }
        console.log("Sending message to github");
        chrome.tabs.sendMessage(tabs[0].id, {action: "saveToGitHub"}, (response) => {
          console.log('Content script response:', response); // Debug log
        });
      });
    });
  }
});