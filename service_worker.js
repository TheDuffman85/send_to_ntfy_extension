chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.get(['topic', 'apiUrl', 'accessToken', 'prefillEnabled'], function(items) {
    if (!items.topic && !items.apiUrl && !items.accessToken) {
      chrome.storage.sync.set({ topic: '', apiUrl: '', accessToken: '', prefillEnabled: true }, function() {
        console.log("The ntfy configuration is set to empty.");
      });
    }
  });
});
