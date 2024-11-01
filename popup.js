document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const warning = document.getElementById('warning');
  const topicSelect = document.getElementById('topic-select');
  const allStorageItems = ['topics', 'apiUrl', 'accessToken', 'prefillEnabled'];

  let config = {
    topics: [],
    apiUrl: '',
    accessToken: '',
    prefillEnabled: true,
    pageUrl: ''
  };

  // Initialize the extension on load
  init();

  // Initializes the extension by loading the configuration and adding event listeners.
  function init() {
    loadConfig();
    addEventListeners();
  }

  // Loads the configuration from Chrome storage and applies settings to the UI.
  async function loadConfig() {
    try {
      const items = await getConfigs(allStorageItems);
      config.pageUrl = await getPageUrl();
      config = {
        ...config,
        topics: items.topics ? items.topics.split(',') : [],
        apiUrl: items.apiUrl || '',
        accessToken: items.accessToken || '',
        prefillEnabled: !!items.prefillEnabled
      };
      
      updateUI();
    } catch (error) {
      console.error('Error retrieving settings:', error);
    }
  }

  // Adds necessary event listeners for UI interactions.
  function addEventListeners() {
    document.querySelector('.settings').addEventListener('click', () => toggleVisibility('settings'));
    document.getElementById('save').addEventListener('click', saveConfig);
    document.querySelector('.open-url').addEventListener('click', openNtfyUrl);
    document.getElementById('send').addEventListener('click', sendMessage);
  }

  // Configuration Management

  // Retrieves configuration items from Chrome storage.
  async function getConfigs(storageItems) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(storageItems, items => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(items));
    });
  }

  // Saves the updated configuration to Chrome storage and updates the UI.
  async function saveConfig() {
    const updatedConfig = {
      topics: document.getElementById('topics').value,
      apiUrl: document.getElementById('url').value,
      accessToken: document.getElementById('token').value,
      prefillEnabled: document.getElementById('prefill').checked,
    };

    try {
      await new Promise((resolve, reject) => {
        chrome.storage.sync.set(updatedConfig, () => {
          chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve();
        });
      });

      config = { ...config, ...updatedConfig, topics: updatedConfig.topics.split(',') };
      showStatus('Configuration saved.', 'green');
      updateTopicDropdown();
      prefillMessage();
    } catch (error) {
      showStatus('Error saving configuration.', 'red');
    }
  }

  // Styling and UI Functions

  // Updates UI elements with loaded configuration values.
  function updateUI() {
    setElementValue('url', config.apiUrl);
    setElementValue('token', config.accessToken);
    setElementValue('topics', config.topics.join(','));
    setElementChecked('prefill', config.prefillEnabled);
    updateTopicDropdown();
    prefillMessage();
  }

  // Shows a temporary status message to the user.
  function showStatus(message, color) {
    status.textContent = message;
    status.style.color = color;
    setTimeout(() => (status.textContent = ''), 3000);
  }

  // Shows a temporary warning message.
  function showWarning(message) {
    warning.textContent = message;
    warning.style.color = 'red';
    warning.classList.remove('hidden');
    setTimeout(() => warning.classList.add('hidden'), 3000);
  }

  // Sets a text input field's value by element ID.
  function setElementValue(id, value) {
    document.getElementById(id).value = value || '';
  }

  // Sets a checkbox's checked state by element ID.
  function setElementChecked(id, value) {
    document.getElementById(id).checked = !!value;
  }

  // Updates the dropdown menu with the topics from the configuration.
  function updateTopicDropdown() {
    topicSelect.innerHTML = '';
    config.topics.forEach(topic => {
      const option = document.createElement('option');
      option.value = topic.trim();
      option.textContent = topic.trim();
      topicSelect.appendChild(option);
    });
  }

  // Prefills the message input with the current page URL if enabled.
  function prefillMessage() {
    const message = document.getElementById('message');
    const urlMessage = `${config.pageUrl}\n`;
    message.value = config.prefillEnabled
      ? urlMessage + message.value.replace(urlMessage, '')
      : message.value.replace(urlMessage, '');
  }

  // Toggles visibility of an element by ID.
  function toggleVisibility(id) {
    document.getElementById(id).classList.toggle('hidden');
  }

  // URL and Messaging Functions

  // Gets the URL of the current active tab.
  async function getPageUrl() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => 
        chrome.runtime.lastError 
          ? reject(chrome.runtime.lastError)
          : resolve(tabs[0].url));
    });
  }

  // Opens the configured API URL in a new tab, or shows a warning if not set.
  function openNtfyUrl() {
    if (config.apiUrl) {
      chrome.tabs.create({ url: config.apiUrl });
    } else {
      showWarning('Please configure ntfy URL first.');
    }
  }

  // Sends a message to the configured API endpoint.
  function sendMessage() {
    const { fullUrl, headers, message } = createRequest();
    if (!fullUrl) return;

    fetch(fullUrl, { method: 'POST', headers, body: message })
      .then(response => response.ok 
        ? showStatus('Message sent successfully.', 'green') 
        : showStatus('Failed to send message.', 'red'))
      .catch(error => showStatus(`Error: ${error}`, 'red'));
  }

  // Prepares the request URL, headers, and body for sending a message.
  function createRequest() {
    if (!topicSelect.value || !config.apiUrl) {
      showWarning('Please configure topics and API URL.');
      return {};
    }

    const urlObj = new URL(config.apiUrl);
    const headers = new Headers();

    if (urlObj.username && urlObj.password) {
      headers.set('Authorization', `Basic ${btoa(`${urlObj.username}:${urlObj.password}`)}`);
    }
    if (config.accessToken) {
      headers.set('Authorization', `Bearer ${config.accessToken}`);
    }

    return { fullUrl: `${urlObj.origin}/${topicSelect.value}`, headers, message: document.getElementById('message').value };
  }
});
