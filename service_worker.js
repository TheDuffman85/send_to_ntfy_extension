chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.sync.get(['topic', 'apiUrl', 'accessToken'], function(items) {
    if (!items.topic && !items.apiUrl && !items.accessToken) {
      chrome.storage.sync.set({ topic: '', apiUrl: '', accessToken: '' }, function() {
        console.log("The ntfy configuration is set to empty.");
      });
    }
  });
});
