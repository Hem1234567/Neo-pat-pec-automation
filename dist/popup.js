document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const inspectBtn = document.getElementById('inspect-btn');
  const statusDiv = document.getElementById('status');

  function sendMessageToContent(action, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.id) {
        // Try sending the message first
        chrome.tabs.sendMessage(tab.id, { action: action }, (response) => {
          if (chrome.runtime.lastError) {
            // The content script isn't loaded (e.g. page wasn't refreshed). Let's inject it programmatically!
            statusDiv.textContent = 'Injecting script...';
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['dist/scripts/examly_content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                statusDiv.textContent = 'Error: Cannot inject script here. Ensure you are on the Examly course page.';
              } else {
                // Try sending the message again after a slight delay
                setTimeout(() => {
                  chrome.tabs.sendMessage(tab.id, { action: action }, (retryResponse) => {
                    if (chrome.runtime.lastError) {
                      statusDiv.textContent = 'Error: Script injection failed.';
                    } else if (retryResponse && retryResponse.status) {
                      statusDiv.textContent = retryResponse.status;
                      if (callback) callback(retryResponse);
                    }
                  });
                }, 500);
              }
            });
          } else if (response && response.status) {
            statusDiv.textContent = response.status;
            if (callback) callback(response);
          }
        });
      }
    });
  }

  startBtn.addEventListener('click', () => {
    statusDiv.textContent = 'Starting automation...';
    sendMessageToContent('start_automation');
  });

  inspectBtn.addEventListener('click', () => {
    statusDiv.textContent = 'Inspecting page...';
    sendMessageToContent('inspect_page', (res) => {
      if (res && res.htmlSnippet) {
        navigator.clipboard.writeText(res.htmlSnippet).then(() => {
          statusDiv.textContent = 'HTML snippet copied to clipboard! Share this with the developer.';
        }).catch(() => {
          statusDiv.textContent = 'Failed to copy to clipboard.';
        });
      }
    });
  });
});
