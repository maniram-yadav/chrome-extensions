// Listen for messages from background or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(request.action);
  if (request.action === "saveToGitHub") {
   
    saveToGitHub().then(() => {
      sendResponse({status: 'success'});
    
    }).catch(error => {
      sendResponse({status: 'error', message: error.message});
    
    });
    
    return true;
  }

});

async function saveToGitHub() {
  // Get configuration
  console.log("Hello");
  const config = await new Promise((resolve) => {
    chrome.storage.sync.get([
      'githubToken',
      'repoOwner',
      'repoName',
      'branchName'
    ], resolve);
  });

  if (!config.githubToken || !config.repoOwner || !config.repoName) {
    alert('Please configure the extension first by clicking on the extension icon.');
    return;
  }

  // Extract problem information
  const problemUrl = window.location.href;
  console.log(problemUrl);
  // const problemTitle = document.querySelector('[data-cy="question-title"]').textContent;
  const titleElement = document.querySelector('title');
  const problemTitle = titleElement ? titleElement.textContent : 'No title found';
  const problemSlug = problemUrl.split('/').filter(Boolean).pop();
  console.log(problemSlug);
  // Get code and language
  const codeEditor = document.querySelector('.monaco-editor');
  if (!codeEditor) {
    alert('No code editor found. Are you on a LeetCode problem page?');
    return;
  }
  
  // const language = document.querySelector('button[data-cy="lang-select"]').textContent.trim();
  const language = document.querySelector('#editor div div div button button').textContent;
  console.log(language);

  const code = await getEditorContent();
  console.log(code);
  if (!code) {
    alert('No code found in the editor.');
    return;
  }
  
  // Get problem description
  const description = document.querySelector('[data-track-load="description_content"]').innerText;
  
  // Prepare file content with metadata
  const fileContent = generateFileContent(code, language, problemUrl, problemTitle, description);
  console.log(fileContent);
  // Determine file path
  const filePath = generateFilePath(problemTitle, language, problemSlug);
  
  // Push to GitHub
  await pushToGitHub(config, filePath, fileContent, problemTitle);
}

async function getEditorContent() {
  return new Promise((resolve) => {
    const editor = document.querySelector('.monaco-editor');
    if (editor && editor.__monaco__) {
      const model = editor.__monaco__.getModel();
      resolve(model.getValue());
    } else {
      // Fallback for cases where Monaco editor API isn't accessible
      const codeLines = Array.from(document.querySelectorAll('.view-line'))
        .map(line => line.textContent)
        .join('\n');
      resolve(codeLines);
    }
  });
}

function generateFileContent(code, language, problemUrl, problemTitle, description) {
  const commentSymbol = getCommentSymbol(language);
  const formattedDescription = description.split('\n')
    .map(line => line.trim() ? `${commentSymbol} ${line.trim()}` : commentSymbol)
    .join('\n');
  
  return `${commentSymbol} LeetCode Problem: ${problemTitle}
${commentSymbol} Problem URL: ${problemUrl}
${commentSymbol}
${formattedDescription}
${commentSymbol}
${commentSymbol} Solution:

${code}`;
}

function getCommentSymbol(language) {
  const languageComments = {
    'Java': '//',
    'JavaScript': '//',
    'Python': '#',
    'C++': '//',
    'C': '//',
    'C#': '//',
    'Ruby': '#',
    'Swift': '//',
    'Go': '//',
    'TypeScript': '//',
    'PHP': '//',
    'Rust': '//',
    'Kotlin': '//',
    'Scala': '//',
    'Dart': '//',
    'Elixir': '#',
    'Clojure': ';;',
    'Haskell': '--',
    'Erlang': '%',
    'Racket': ';',
    'Scheme': ';',
    'OCaml': '(*',
    'F#': '//',
    'VB.NET': "'",
    'Bash': '#',
    'SQL': '--',
    'MySQL': '--',
    'PostgreSQL': '--',
    'Oracle': '--'
  };
  
  return languageComments[language] || '//';
}

function generateFilePath(problemTitle, language, problemSlug) {
  const languageFolders = {
    'Java': 'Java',
    'JavaScript': 'JavaScript',
    'Python': 'Python',
    'C++': 'C++',
    'C': 'C',
    'C#': 'CSharp',
    'Ruby': 'Ruby',
    'Swift': 'Swift',
    'Go': 'Go',
    'TypeScript': 'TypeScript',
    'PHP': 'PHP',
    'Rust': 'Rust',
    'Kotlin': 'Kotlin',
    'Scala': 'Scala',
    'Dart': 'Dart',
    'Elixir': 'Elixir',
    'Clojure': 'Clojure',
    'Haskell': 'Haskell',
    'Erlang': 'Erlang',
    'Racket': 'Racket',
    'Scheme': 'Scheme',
    'OCaml': 'OCaml',
    'F#': 'FSharp',
    'VB.NET': 'VBNet',
    'Bash': 'Bash',
    'SQL': 'SQL',
    'MySQL': 'SQL',
    'PostgreSQL': 'SQL',
    'Oracle': 'SQL'
  };
  
  const folder = languageFolders[language] || 'Other';
  const fileName = problemSlug || problemTitle.toLowerCase().replace(/ /g, '-');
  
  return `${folder}/${fileName}.${getFileExtension(language)}`;
}

function getFileExtension(language) {
  const extensions = {
    'Java': 'java',
    'JavaScript': 'js',
    'Python': 'py',
    'C++': 'cpp',
    'C': 'c',
    'C#': 'cs',
    'Ruby': 'rb',
    'Swift': 'swift',
    'Go': 'go',
    'TypeScript': 'ts',
    'PHP': 'php',
    'Rust': 'rs',
    'Kotlin': 'kt',
    'Scala': 'scala',
    'Dart': 'dart',
    'Elixir': 'ex',
    'Clojure': 'clj',
    'Haskell': 'hs',
    'Erlang': 'erl',
    'Racket': 'rkt',
    'Scheme': 'scm',
    'OCaml': 'ml',
    'F#': 'fs',
    'VB.NET': 'vb',
    'Bash': 'sh',
    'SQL': 'sql',
    'MySQL': 'sql',
    'PostgreSQL': 'sql',
    'Oracle': 'sql'
  };
  
  return extensions[language] || 'txt';
}

async function pushToGitHub(config, filePath, content, problemTitle) {
  const apiUrl = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/contents/${filePath}`;
  
  try {
    // Check if file exists to handle duplicates
    const existingFile = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    let newFilePath = filePath;
    if (existingFile.ok) {
      const fileData = await existingFile.json();
      const existingSha = fileData.sha;
      
      // Handle duplicate by adding sequence number
      const baseName = filePath.split('.').slice(0, -1).join('.');
      const ext = filePath.split('.').pop();
      let counter = 1;
      
      do {
        newFilePath = `${baseName}-${counter}.${ext}`;
        counter++;
      } while (await checkFileExists(config, newFilePath));
    }
    
    // Create or update file
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${config.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Add solution for ${problemTitle}`,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: config.branchName || 'main'
      })
    });
    
    if (response.ok) {
      alert(`Successfully saved solution to GitHub: ${newFilePath}`);
    } else {
      const error = await response.json();
      alert(`Failed to save solution: ${error.message}`);
    }
  } catch (error) {
    alert(`Error saving solution: ${error.message}`);
  }
}

async function checkFileExists(config, filePath) {
  const apiUrl = `https://api.github.com/repos/${config.repoOwner}/${config.repoName}/contents/${filePath}`;
  
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Authorization': `token ${config.githubToken}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  return response.ok;
}