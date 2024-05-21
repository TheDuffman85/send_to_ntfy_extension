document.addEventListener('DOMContentLoaded', function() {
  const status = document.getElementById('status');
  const warning = document.getElementById('warning');
  const topicSelect = document.getElementById('topic-select');

  // Load saved configuration
  chrome.storage.sync.get(['topics', 'apiUrl', 'accessToken'], function(items) {
    if (chrome.runtime.lastError) {
      console.error('Error retrieving settings:', chrome.runtime.lastError);
    } else {
      const topics = items.topics ? items.topics.split(',') : [];
      document.getElementById('url').value = items.apiUrl || '';
      document.getElementById('token').value = items.accessToken || '';
      document.getElementById('topics').value = topics.join(',');

      // Populate the topic dropdown
      topicSelect.innerHTML = '';
      topics.forEach(topic => {
        const option = document.createElement('option');
        option.value = topic.trim();
        option.textContent = topic.trim();
        topicSelect.appendChild(option);
      });
    }
  });

  // Toggle settings visibility
  document.querySelector('.settings').addEventListener('click', function() {
    const settingsDiv = document.getElementById('settings');
    settingsDiv.classList.toggle('hidden');
  });

  // Save configuration
  document.getElementById('save').addEventListener('click', function() {
    const topics = document.getElementById('topics').value;
    const apiUrl = document.getElementById('url').value;
    const accessToken = document.getElementById('token').value;

    chrome.storage.sync.set({ topics, apiUrl, accessToken }, function() {
      if (chrome.runtime.lastError) {
        console.error('Error saving settings:', chrome.runtime.lastError);
        status.textContent = 'Error saving configuration.';
        status.style.color = 'red';
      } else {
        console.log('Configuration saved.');
        status.textContent = 'Configuration saved.';
        status.style.color = 'green';
        setTimeout(() => { status.textContent = ''; }, 3000);

        // Update the topic dropdown
        const topicsArray = topics ? topics.split(',') : [];
        topicSelect.innerHTML = '';
        topicsArray.forEach(topic => {
          const option = document.createElement('option');
          option.value = topic.trim();
          option.textContent = topic.trim();
          topicSelect.appendChild(option);
        });
      }
    });
  });

  // Open ntfy URL in new tab
  document.querySelector('.open-url').addEventListener('click', function() {
    chrome.storage.sync.get('apiUrl', function(items) {
      const apiUrl = items.apiUrl;
      if (apiUrl) {
        chrome.tabs.create({ url: apiUrl });
      } else {
        warning.textContent = 'Please configure ntfy URL first.';
        warning.style.color = 'red';
        warning.classList.remove('hidden');
        setTimeout(() => { warning.classList.add('hidden'); }, 3000);
      }
    });
  });

  // Prefill the message textarea with the current tab's URL
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const url = tabs[0].url;
    document.getElementById('message').value = url;
  });

  // Send current URL or edited message to ntfy
  document.getElementById('send').addEventListener('click', function() {
    chrome.storage.sync.get(['topics', 'apiUrl', 'accessToken'], function(items) {
      if (chrome.runtime.lastError) {
        console.error('Error retrieving settings:', chrome.runtime.lastError);
        return;
      }

      const topic = topicSelect.value;
      const apiUrl = items.apiUrl;
      const accessToken = items.accessToken;
      const message = document.getElementById('message').value;

      if (!topic || !apiUrl) {
        warning.classList.remove('hidden');
        warning.style.color = 'red';
        setTimeout(() => { warning.classList.add('hidden'); }, 3000);
        return;
      }

      const fullUrl = apiUrl + '/' + topic;

      const headers = new Headers();
      if (accessToken) {
        headers.set('Authorization', 'Bearer ' + accessToken);
      }

      fetch(fullUrl, {
        method: "POST",
        headers: headers,
        body: message
      }).then(response => {
        if (!response.ok) {
          console.error("Failed to send message:", response);
          status.textContent = "Failed to send message.";
          status.style.color = 'red';
        } else {
          status.textContent = "Message sent successfully.";
          status.style.color = 'green';
          setTimeout(() => { status.textContent = ''; }, 3000);
        }
      }).catch(error => {
        console.error("Error:", error);
        status.textContent = "Error: " + error;
        status.style.color = 'red';
      });
    });
  });
});
