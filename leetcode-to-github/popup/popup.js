document.addEventListener('DOMContentLoaded', () => {
    // Load saved configuration
    chrome.storage.sync.get([
      'githubToken',
      'repoOwner',
      'repoName',
      'branchName'
    ], (data) => {
      document.getElementById('githubToken').value = data.githubToken || '';
      document.getElementById('repoOwner').value = data.repoOwner || '';
      document.getElementById('repoName').value = data.repoName || '';
      document.getElementById('branchName').value = data.branchName || 'main';
      document.getElementById('directory').value = data.directory || '';
    });
  
    // Save configuration
    document.getElementById('saveConfig').addEventListener('click', () => {
      const githubToken = document.getElementById('githubToken').value;
      const repoOwner = document.getElementById('repoOwner').value;
      const repoName = document.getElementById('repoName').value;
      const branchName = document.getElementById('branchName').value;
      const directory = document.getElementById('directory').value;
  
      chrome.storage.sync.set({
        // repoOwner,
        // repoName,
        // branchName
        directory,
        repoOwner:"maniram-yadav",
        repoName:"leetcode-solutions",
        branchName:"main"
      }, () => {
        document.getElementById('status').textContent = 'Configuration saved!';
        setTimeout(() => {
          document.getElementById('status').textContent = '';

        }, 2500);
      });
    });
  });