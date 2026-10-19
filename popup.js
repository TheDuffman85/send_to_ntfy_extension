document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const elements = {
    // Views
    mainView: document.getElementById('main-view'),
    mainContent: document.getElementById('main-content'), // Send tab form
    settingsView: document.getElementById('settings-view'),

    // Header
    backBtn: document.getElementById('back-btn'),
    headerText: document.getElementById('header-text'),
    openUrlBtn: document.getElementById('open-url-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    popoutBtn: document.getElementById('popout-btn'),

    // Main form
    topicSelect: document.getElementById('topic-select'),
    topicDropdown: document.getElementById('topic-dropdown'),
    topicDropdownSelected: document.getElementById('topic-dropdown-selected'),
    topicDropdownText: document.getElementById('topic-dropdown-text'),
    topicDropdownOptions: document.getElementById('topic-dropdown-options'),
    titleInput: document.getElementById('title-input'),
    tabUrlBtn: document.getElementById('tab-url-btn'),
    messageInput: document.getElementById('message-input'),
    tagsContainer: document.getElementById('tags-container'),
    newTagInput: document.getElementById('new-tag-input'),
    tagInputHint: document.getElementById('tag-input-hint'),


    // File handling
    fileInput: document.getElementById('file-input'),
    fileBtn: document.getElementById('file-btn'),
    filePreview: document.getElementById('file-preview'),
    zipToggle: document.getElementById('zip-toggle'),
    zipCheckbox: document.getElementById('zip-checkbox'),

    // Priority & Theme chips
    priorityChips: document.getElementById('priority-chips'),
    themeChips: document.getElementById('theme-chips'),
    defaultTabChips: document.getElementById('default-tab-chips'),

    // Advanced options
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedOptions: document.getElementById('advanced-options'),

    // Actions
    sendBtn: document.getElementById('send-btn'),
    sendAnotherCheckbox: document.getElementById('send-another-checkbox'),

    // Status
    status: document.getElementById('status'),
    receiveStatus: document.getElementById('receive-status'),
    settingsStatus: document.getElementById('settings-status'),

    // Settings inputs
    urlInput: document.getElementById('url-input'),
    tokenInput: document.getElementById('token-input'),
    serverAccessBtn: document.getElementById('server-access-btn'),
    serverAccessHint: document.getElementById('server-access-hint'),
    includeUrlCheckbox: document.getElementById('include-url-checkbox'),
    topicsContainer: document.getElementById('topics-container'),
    newTopicInput: document.getElementById('new-topic-input'),
    topicInputHint: document.getElementById('topic-input-hint'),

    // Recent Notifications
    notificationsList: document.getElementById('notifications-list'),
    topicSidebar: document.getElementById('topic-sidebar'),

    // Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),

    // Bulk Actions Control Bar
    notificationsControlBar: document.getElementById('notifications-control-bar'),
    markAllReadBtn: document.getElementById('mark-all-read-btn'),
    deleteAllBtn: document.getElementById('delete-all-btn'),
  };

  // State
  let config = {
    topics: [],
    apiUrl: '',
    accessToken: '',

    theme: 'auto',
    defaultTab: 'receive',
    pageUrl: '',
    sendAsZipEnabled: false
  };

  let tags = []; // State for tags
  let readMessageIds = []; // State for read notifications
  let deletedMessageIds = []; // State for deleted notifications (client-side only)
  let pendingDeleteId = null; // Message whose delete button waits for the confirming click
  let pendingDeleteTimer = null;
  let deleteAllArmed = false;
  let deleteAllTimer = null;
  let listPointerDown = false; // A press on the Receive list, during which it must not be rebuilt
  let listRefreshPending = false;
  let listRefreshTimer = null;
  let activeTab = null; // Active tab state, set by switchTab() in init()
  let receiveFilter = 'all'; // Topic shown on the Receive tab, or 'all'
  // Opened with the header button in a browser tab instead of the toolbar popup
  const pageParams = new URLSearchParams(location.search);
  const isPageMode = pageParams.get('mode') === 'page';
  let autoTitle = ''; // The tab URL last put in the Title field automatically
  let currentNotifications = []; // Currently displayed notifications for the active topic
  let attachments = [];

  // Drag and drop state
  let dragSrcIndex = null;
  let dragType = null;

  let selectedPriority = 3;
  let isSettingsView = false;
  let serverAccessMissing = false;
  let rightCtrlDown = false;
  let isSending = false;
  let draftSaveTimer = null;

  const SEND_AS_ZIP_SETTING_KEY = 'sendAsZipEnabled';
  // Synced settings; the access token is in storage.local (NtfyAPI.getAccessToken)
  const STORAGE_KEYS = ['topics', 'apiUrl', 'theme', 'priority', 'lastTags', 'lastTopic', 'sendAnotherEnabled', 'includeUrl', 'defaultTab', SEND_AS_ZIP_SETTING_KEY];
  const STORED_FILES_KEY = 'storedFiles';
  const LEGACY_STORED_FILE_KEY = 'storedFile';

  // Initialize
  init();

  async function init() {
    await loadConfig();
    await loadLocalState();
    await checkSessionAndCleanup(); // Check session and cleanup old files if needed
    await restoreDraftState();
    await loadStoredFiles();
    setupEventListeners();
    await updateServerAccessUI(config.apiUrl, config.accessToken);
    updateUI();
    // Ensure priority UI is updated after config load
    updatePriorityUI();
    applyTheme();
    // Render initial empty tags or restored ones
    renderTags();
    // Set header title dynamically from manifest
    const manifest = chrome.runtime.getManifest();
    elements.headerText.textContent = manifest.name;

    if (isPageMode) {
      document.body.classList.add('page-mode');
      elements.popoutBtn.style.display = 'none';
      elements.tabUrlBtn.style.display = '';
      // Coming back to this tab: the user may have moved on to another page
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
          config.pageUrl = await getPageUrl();
          applyUrlTitle();
        }
      });
    }
    applyUrlTitle();
    const requestedTab = pageParams.get('tab');
    switchTab(requestedTab === 'send' || requestedTab === 'receive' ? requestedTab : config.defaultTab);
    if (activeTab === 'send') {
      // Set focus on message input when popup opens
      elements.messageInput.focus();
    }

    // Trigger initial sync in background
    chrome.runtime.sendMessage({ action: 'sync' });
  }

  // ==================
  // Configuration
  // ==================

  async function loadConfig() {
    try {
      const items = await getFromStorage(STORAGE_KEYS);
      const accessToken = await NtfyAPI.getAccessToken();
      config.pageUrl = await getPageUrl();
      config = {
        ...config,
        topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : [],
        apiUrl: items.apiUrl || '',
        accessToken: accessToken,

        theme: items.theme || 'auto',
        defaultTab: items.defaultTab === 'send' ? 'send' : 'receive',
        sendAnotherEnabled: items.sendAnotherEnabled === true,
        includeUrl: items.includeUrl === true,
        sendAsZipEnabled: items[SEND_AS_ZIP_SETTING_KEY] === true
      };

      // Restore 'Send another' checkbox state
      elements.sendAnotherCheckbox.checked = config.sendAnotherEnabled;
      elements.includeUrlCheckbox.checked = config.includeUrl;
      elements.zipCheckbox.checked = config.sendAsZipEnabled;

      if (items.priority) {
        selectedPriority = items.priority;
      }

      if (items.lastTopic && config.topics.includes(items.lastTopic)) {
        config.lastTopic = items.lastTopic;
      }

      if (items.lastTags) {
        // Only set tags if they weren't already set by draft restore?
        // Actually loadConfig runs before restoreDraftState, so draft state will overwrite if exists. Correct.
        tags = Array.isArray(items.lastTags) ? items.lastTags : [];
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }

  async function saveConfig() {
    const newConfig = {
      apiUrl: elements.urlInput.value.trim(),
      accessToken: elements.tokenInput.value,
      topics: config.topics.join(','), // Use current config state which is kept in sync

      theme: config.theme,
      defaultTab: config.defaultTab,
      includeUrl: elements.includeUrlCheckbox.checked,
      sendAsZipEnabled: config.sendAsZipEnabled
    };

    try {
      const { accessToken, ...syncedSettings } = newConfig;
      await saveToStorage(syncedSettings);
      await NtfyAPI.setAccessToken(accessToken);
      config = {
        ...config,
        ...newConfig,
        topics: newConfig.topics.split(',').map(t => t.trim()).filter(Boolean)
      };

      // showSettingsStatus('Saved', 'success');

      // We don't want to full updateUI here because it might disrupt typing
      // But we need to update topic dropdown if topics changed
      updateTopicDropdown();
      renderTopics(); // Re-render to ensure state consistency
      updateThemeChipsUI(); // Ensure UI reflects state
      updateDefaultTabChipsUI();
      updateServerAccessUI(config.apiUrl, config.accessToken);

    } catch (error) {
      showSettingsStatus('Failed to save settings', 'error');
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ==================
  // Server Access
  // ==================

  // ntfy answers CORS preflights with Access-Control-Allow-Headers: *, which doesn't cover
  // Authorization, so authenticated requests need a host permission for the server.
  function serverOriginPattern(apiUrl) {
    try {
      const url = new URL(apiUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return null;
      }
      // Match patterns have no port and match every port
      return `${url.protocol}//${url.hostname}/*`;
    } catch (e) {
      return null;
    }
  }

  async function updateServerAccessUI(apiUrl, accessToken) {
    const pattern = serverOriginPattern(apiUrl);
    let missing = false;
    if (pattern && NtfyAPI.buildAuthHeaderValue(accessToken, apiUrl)) {
      try {
        missing = !(await chrome.permissions.contains({ origins: [pattern] }));
      } catch (e) {
        missing = false;
      }
    }

    serverAccessMissing = missing;
    elements.serverAccessBtn.style.display = missing ? '' : 'none';
    elements.serverAccessHint.style.display = missing ? '' : 'none';
    elements.settingsBtn.classList.toggle('highlight', !(config.apiUrl && config.topics.length > 0) || missing);
  }

  function requestServerAccess() {
    const pattern = serverOriginPattern(elements.urlInput.value.trim());
    if (!pattern) {
      return;
    }

    // Called directly from the click: permissions.request needs a user gesture
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      showSettingsStatus(granted ? 'Server access granted' : 'Server access not granted', granted ? 'success' : 'error');
      updateServerAccessUI(elements.urlInput.value.trim(), elements.tokenInput.value);
    });
  }

  // ==================
  // Theme Management
  // ==================

  function applyTheme() {
    document.body.setAttribute('data-theme', config.theme);
    updateThemeChipsUI();
  }

  function updateThemeChipsUI() {
    document.querySelectorAll('#theme-chips .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.theme === config.theme);
    });
  }

  function handleThemeChange(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.theme) return;

    config.theme = chip.dataset.theme;
    applyTheme();
  }

  // ==================
  // Default Tab
  // ==================

  function updateDefaultTabChipsUI() {
    document.querySelectorAll('#default-tab-chips .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.defaultTab === config.defaultTab);
    });
  }

  function handleDefaultTabChange(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.defaultTab) return;

    config.defaultTab = chip.dataset.defaultTab;
    updateDefaultTabChipsUI();
    saveConfig();
  }

  // ==================
  // File Handling
  // ==================

  function getLocalStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, items => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(items);
        }
      });
    });
  }

  function setLocalStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  function removeLocalStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async function readStoredFiles() {
    const result = await getLocalStorage([STORED_FILES_KEY, LEGACY_STORED_FILE_KEY]);
    let files = Array.isArray(result[STORED_FILES_KEY]) ? result[STORED_FILES_KEY] : [];

    // Keep a pending attachment created by an older extension version.
    if (files.length === 0 && result[LEGACY_STORED_FILE_KEY]) {
      files = [result[LEGACY_STORED_FILE_KEY]];
      await setLocalStorage({ [STORED_FILES_KEY]: files });
      await removeLocalStorage([LEGACY_STORED_FILE_KEY]);
    } else if (result[LEGACY_STORED_FILE_KEY]) {
      await removeLocalStorage([LEGACY_STORED_FILE_KEY]);
    }

    return files;
  }

  async function persistStoredFiles(files) {
    if (files.length > 0) {
      await setLocalStorage({ [STORED_FILES_KEY]: files });
      await removeLocalStorage([LEGACY_STORED_FILE_KEY]);
    } else {
      await removeLocalStorage([STORED_FILES_KEY, LEGACY_STORED_FILE_KEY]);
    }
  }

  async function loadStoredFiles() {
    try {
      attachments = await readStoredFiles();
      renderAttachments();
    } catch (error) {
      console.error('Error loading stored files:', error);
      attachments = [];
      renderAttachments();
    }
  }

  function renderAttachments() {
    elements.filePreview.innerHTML = '';
    elements.filePreview.classList.toggle('visible', attachments.length > 0);
    elements.mainContent.classList.toggle('has-multiple-attachments', attachments.length > 1);
    elements.fileBtn.textContent = attachments.length > 0
      ? `📎 Attach files (${attachments.length})`
      : '📎 Attach files';

    attachments.forEach((file, index) => {
      const preview = document.createElement('div');
      preview.className = 'file-preview-item';

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '📄';

      const info = document.createElement('div');
      info.className = 'file-info';

      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = file.name;

      const size = document.createElement('div');
      size.className = 'file-size';
      size.textContent = formatFileSize(file.size);

      info.appendChild(name);
      info.appendChild(size);

      const removeButton = document.createElement('button');
      removeButton.className = 'file-remove';
      removeButton.dataset.index = index;
      removeButton.title = `Remove ${file.name}`;
      removeButton.setAttribute('aria-label', `Remove ${file.name}`);
      removeButton.textContent = '×';
      removeButton.disabled = isSending;

      preview.appendChild(icon);
      preview.appendChild(info);
      preview.appendChild(removeButton);
      elements.filePreview.appendChild(preview);
    });

    elements.fileBtn.disabled = isSending;
    elements.fileInput.disabled = isSending;
    updateZipToggleUI();
  }

  function updateZipToggleUI() {
    const canSendAsZip = attachments.length > 1;

    elements.zipToggle.classList.toggle('visible', canSendAsZip);
    elements.zipToggle.classList.toggle('disabled', isSending);
    elements.zipCheckbox.disabled = isSending || !canSendAsZip;
    elements.zipCheckbox.checked = canSendAsZip && config.sendAsZipEnabled;
  }

  function handleZipToggleChange() {
    if (attachments.length < 2) {
      elements.zipCheckbox.checked = false;
      return;
    }

    config.sendAsZipEnabled = elements.zipCheckbox.checked;
    saveToStorage({ [SEND_AS_ZIP_SETTING_KEY]: config.sendAsZipEnabled }).catch(error => {
      console.error('Error saving ZIP preference:', error);
    });
  }

  async function appendStoredFiles(newFiles) {
    if (newFiles.length === 0) return;

    const existingFiles = await readStoredFiles();
    const updatedFiles = [...existingFiles, ...newFiles];
    await persistStoredFiles(updatedFiles);
    attachments = updatedFiles;
    renderAttachments();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = event => {
        resolve({
          name: file.name,
          type: file.type,
          size: file.size,
          data: event.target.result
        });
      };

      reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
      reader.onabort = () => reject(new Error(`Reading "${file.name}" was cancelled`));
      reader.readAsDataURL(file);
    });
  }

  async function checkSessionAndCleanup() {
    // Hybrid storage approach:
    // Files are stored in 'local' (large quota).
    // Session state is tracked in 'session'.
    // If 'sessionActive' is missing from 'session' storage, it means the browser restarted.
    // In that case, clear the files and draft from 'local' storage.

    try {
      const session = await new Promise(resolve => chrome.storage.session.get(['sessionActive'], resolve));

      if (!session.sessionActive) {
        console.log('New session detected, cleaning up stored files and draft');
        await removeLocalStorage([STORED_FILES_KEY, LEGACY_STORED_FILE_KEY, 'draftState']);
        await new Promise(resolve => chrome.storage.session.set({ sessionActive: true }, resolve));
      }
    } catch (error) {
      console.error('Error checking session state:', error);
    }
  }

  async function handleFileButtonClick() {
    if (isSending) return;

    // Save state first because popup will close
    await flushDraftSave();

    // Open file picker in a popup window to avoid main popup closing
    const filePickerUrl = chrome.runtime.getURL(`filepicker.html?theme=${config.theme}`);
    const width = 450;
    const height = 340;

    // Get current window to center the popup
    chrome.windows.getCurrent((currentWindow) => {
      let left = undefined;
      let top = undefined;

      if (currentWindow && currentWindow.left !== undefined && currentWindow.top !== undefined) {
        left = Math.round(currentWindow.left + (currentWindow.width - width) / 2);
        top = Math.round(currentWindow.top + (currentWindow.height - height) / 2);
      }

      chrome.windows.create({
        url: filePickerUrl,
        type: 'popup',
        width: width,
        height: height,
        left: left,
        top: top,
        focused: true
      }, (window) => {
        if (chrome.runtime.lastError) {
          console.log('Windows API error, trying tabs:', chrome.runtime.lastError);
          // Fallback to tab
          chrome.tabs.create({ url: filePickerUrl, active: true });
        }
      });
    });
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    readAndStoreFiles(files);
  }

  async function readAndStoreFiles(files) {
    if (files.length === 0 || isSending) return;

    try {
      // Read the whole selection before writing so a read error does not append a partial batch.
      const fileRecords = await Promise.all(files.map(readFileAsDataUrl));
      await appendStoredFiles(fileRecords);
    } catch (error) {
      console.error('Error storing files:', error);
      showStatus(`Failed to attach files: ${error.message}`, 'error');
    }
  }

  async function handleAttachmentRemove(e) {
    const removeButton = e.target.closest('.file-remove');
    if (!removeButton || isSending) return;

    const index = parseInt(removeButton.dataset.index, 10);
    if (Number.isNaN(index) || index < 0 || index >= attachments.length) return;

    try {
      const updatedFiles = attachments.filter((_, fileIndex) => fileIndex !== index);
      await persistStoredFiles(updatedFiles);
      attachments = updatedFiles;
      renderAttachments();
    } catch (error) {
      console.error('Error removing file:', error);
      showStatus(`Failed to remove file: ${error.message}`, 'error');
    }
  }

  async function clearStoredFiles() {
    await persistStoredFiles([]);
    attachments = [];
    elements.fileInput.value = '';
    renderAttachments();
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function saveDraftState() {
    const draft = {
      // An automatically filled tab URL isn't part of the draft: the next popup fills in its own tab's
      title: elements.titleInput.value === autoTitle ? '' : elements.titleInput.value,
      message: elements.messageInput.value,
      topic: elements.topicSelect.value,
      tags: tags, // Save tags array
      priority: selectedPriority
    };
    await new Promise(resolve => chrome.storage.local.set({ draftState: draft }, resolve));
  }

  function scheduleDraftSave() {
    if (draftSaveTimer !== null) {
      clearTimeout(draftSaveTimer);
    }

    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      saveDraftState().catch(error => console.error('Error saving draft:', error));
    }, 250);
  }

  function cancelScheduledDraftSave() {
    if (draftSaveTimer !== null) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
  }

  async function flushDraftSave() {
    cancelScheduledDraftSave();
    await saveDraftState();
  }

  async function restoreDraftState() {
    return new Promise(resolve => {
      chrome.storage.local.get(['draftState'], (result) => {
        if (result.draftState) {
          const draft = result.draftState;
          if (typeof draft.title === 'string') elements.titleInput.value = draft.title;
          if (typeof draft.message === 'string') elements.messageInput.value = draft.message;
          if (draft.tags) {
            tags = Array.isArray(draft.tags) ? draft.tags : draft.tags.split(',').filter(Boolean);
            renderTags();
          }
          if (draft.priority) {
            selectedPriority = draft.priority;
            updatePriorityUI();
          }
          if (draft.topic) {
            elements.topicSelect.value = draft.topic;
            elements.topicDropdownText.textContent = draft.topic;
            updateCustomDropdownSelection(draft.topic);
          }

          // Keep the draft until a message is sent successfully.
        }
        resolve();
      });
    });
  }

  // ==================
  // Storage Helpers
  // ==================

  function getFromStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, items => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(items);
        }
      });
    });
  }

  function saveToStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  function getFromStorageLocal(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, items => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(items);
        }
      });
    });
  }

  function saveToStorageLocal(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  // Reading another tab's URL needs the optional "tabs" permission (asked for by the "Use tab URL" button)
  async function getLastBrowsingTabUrl() {
    try {
      if (!(await chrome.permissions.contains({ permissions: ['tabs'] }))) {
        return '';
      }
      const own = await chrome.tabs.getCurrent();
      const tabs = await chrome.tabs.query({ windowType: 'normal' });
      const pages = tabs.filter(tab => tab.id !== own?.id && NtfyAPI.isHttpUrl(tab.url));
      pages.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      return pages[0]?.url || '';
    } catch (e) {
      return '';
    }
  }

  // "Include current tab's URL" puts the URL in the Title field, where it can still be edited.
  // A title the user typed is left alone.
  function applyUrlTitle() {
    const current = elements.titleInput.value.trim();
    if (current && current !== autoTitle) {
      return;
    }

    const url = config.includeUrl && NtfyAPI.isHttpUrl(config.pageUrl) ? config.pageUrl.replace(/\/$/, '') : '';
    elements.titleInput.value = url;
    autoTitle = url;
  }

  function useTabUrl() {
    // Called directly from the click: permissions.request needs a user gesture
    chrome.permissions.request({ permissions: ['tabs'] }, async (granted) => {
      if (!granted) {
        showStatus('Allow reading tabs to use the tab URL', 'warning');
        return;
      }
      const url = await getLastBrowsingTabUrl();
      if (!url) {
        showStatus('No web page tab found', 'warning');
        return;
      }
      config.pageUrl = url;
      elements.titleInput.value = url.replace(/\/$/, '');
      autoTitle = elements.titleInput.value;
    });
  }

  async function getPageUrl() {
    if (isPageMode) {
      // The active tab is this page itself: use the web page tab the user was on last
      return getLastBrowsingTabUrl();
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(tabs[0]?.url || '');
        }
      });
    });
  }

  // ==================
  // Event Listeners
  // ==================

  function setupEventListeners() {
    // View switching
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.backBtn.addEventListener('click', showMainView);

    // Settings Auto-save
    const debouncedSave = debounce(saveConfig, 1000);

    elements.urlInput.addEventListener('input', () => {
      // showSettingsStatus('Saving...', 'visible');
      debouncedSave();
    });

    elements.tokenInput.addEventListener('input', () => {
      // showSettingsStatus('Saving...', 'visible');
      debouncedSave();
    });

    elements.includeUrlCheckbox.addEventListener('change', () => {
      saveConfig();
    });

    elements.serverAccessBtn.addEventListener('click', requestServerAccess);

    // Keep the composer text available if the popup closes before sending.
    elements.titleInput.addEventListener('input', scheduleDraftSave);
    elements.messageInput.addEventListener('input', scheduleDraftSave);


    // Topics handling (badges)
    elements.newTopicInput.addEventListener('keydown', handleTopicKeydown);
    elements.newTopicInput.addEventListener('input', updateTopicInputHint);
    elements.topicsContainer.addEventListener('click', handleTopicRemove);

    // Theme chips
    elements.themeChips.addEventListener('click', (e) => {
      handleThemeChange(e);
      saveConfig();
    });

    // Default tab chips
    elements.defaultTabChips.addEventListener('click', handleDefaultTabChange);

    // Open ntfy URL
    elements.openUrlBtn.addEventListener('click', openNtfyUrl);

    // Send message
    elements.sendBtn.addEventListener('click', sendNotification);

    // Send another checkbox - save state on change
    elements.sendAnotherCheckbox.addEventListener('change', () => {
      config.sendAnotherEnabled = elements.sendAnotherCheckbox.checked;
      saveToStorage({ sendAnotherEnabled: config.sendAnotherEnabled });
    });

    // Send multiple attachments either individually or as one ZIP.
    elements.zipCheckbox.addEventListener('change', handleZipToggleChange);

    // File handling
    elements.fileBtn.addEventListener('click', handleFileButtonClick);
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.filePreview.addEventListener('click', handleAttachmentRemove);

    // Priority chips
    elements.priorityChips.addEventListener('click', handlePriorityClick);

    // Tags handling (badges)
    elements.newTagInput.addEventListener('keydown', handleTagKeydown);
    elements.newTagInput.addEventListener('input', updateTagInputHint);
    elements.tagsContainer.addEventListener('click', handleTagRemove);

    // Advanced options toggle
    elements.advancedToggle.addEventListener('click', toggleAdvancedOptions);

    // Custom topic dropdown
    elements.topicDropdownSelected.addEventListener('click', toggleTopicDropdown);

    // Tab switching
    elements.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    elements.popoutBtn.addEventListener('click', openInTab);
    elements.tabUrlBtn.addEventListener('click', useTabUrl);

    // Bulk actions
    elements.markAllReadBtn.addEventListener('click', handleMarkAllRead);
    elements.deleteAllBtn.addEventListener('click', handleDeleteAll);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!elements.topicDropdown.contains(e.target)) {
        closeTopicDropdown();
      }
    });

    // Listen for storage changes for live UI updates and external picker
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes[STORED_FILES_KEY] || changes[LEGACY_STORED_FILE_KEY]) {
          loadStoredFiles();
        }
        if (changes.receivedNotifications || changes.readMessageIds || changes.deletedMessageIds) {
          scheduleNotificationsRefresh();
        }
      }
    });

    // Rebuilding the list between press and release swallows the click on its buttons, so hold
    // refreshes back while a press is on it
    elements.notificationsList.addEventListener('pointerdown', () => {
      listPointerDown = true;
    });
    document.addEventListener('pointerup', releaseListPointer);
    document.addEventListener('pointercancel', releaseListPointer);

    // An armed delete button disarms on a click anywhere else or on Escape. Bubbling, so the click
    // that armed it has already been handled and is let through.
    document.addEventListener('click', (e) => {
      if (pendingDeleteId && !e.target.closest('.delete-btn.confirming')) {
        clearPendingDelete();
      }
      if (deleteAllArmed && !e.target.closest('#delete-all-btn')) {
        setDeleteAllArmed(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (pendingDeleteId || deleteAllArmed)) {
        e.preventDefault(); // Keeps the popup open
        clearPendingDelete();
        setDeleteAllArmed(false);
      }
    });

    setupTooltips();

    // Global keyboard shortcuts
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('keyup', handleGlobalKeyup);
    window.addEventListener('blur', () => {
      rightCtrlDown = false;
    });
  }

  // ==================
  // View Switching
  // ==================

  function switchTab(tab) {
    if (tab === activeTab) return;

    activeTab = tab;

    // Update active button class
    elements.tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    // Update active content class
    elements.tabContents.forEach(content => {
      const isTarget = content.id === `tab-content-${tab}`;
      content.classList.toggle('active', isTarget);
    });

    document.body.classList.toggle('receive-active', tab === 'receive');

    // Load notifications on-demand when switching to receive tab
    if (activeTab === 'receive') {
      loadNotifications();
      chrome.runtime.sendMessage({ action: 'sync' });
    }
  }

  // Open this page in a browser tab, which unlike the toolbar popup can be any size.
  // Switch to that tab instead if it is already open (runtime.getContexts: Chrome 116+).
  async function openInTab() {
    const pageUrl = chrome.runtime.getURL('popup.html?mode=page');
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
      const open = contexts.find(context => context.documentUrl && context.documentUrl.startsWith(pageUrl));
      if (open) {
        await chrome.tabs.update(open.tabId, { active: true });
        await chrome.windows.update(open.windowId, { focused: true });
        window.close();
        return;
      }
    }

    await chrome.tabs.create({ url: `${pageUrl}&tab=${activeTab}` });
    window.close();
  }

  function showSettingsView() {
    // Populate settings fields with current config
    elements.urlInput.value = config.apiUrl;
    elements.tokenInput.value = config.accessToken;
    renderTopics(); // Render badges
    updateServerAccessUI(config.apiUrl, config.accessToken);

    updateThemeChipsUI();
    updateDefaultTabChipsUI();

    elements.mainView.classList.remove('active');
    elements.settingsView.classList.add('active');
    elements.backBtn.classList.add('visible');
    elements.settingsBtn.style.display = 'none';
    elements.openUrlBtn.style.display = 'none';
    elements.headerText.textContent = 'Settings';
    isSettingsView = true;
  }

  function showMainView() {
    elements.settingsView.classList.remove('active');
    elements.mainView.classList.add('active');
    elements.backBtn.classList.remove('visible');
    elements.settingsBtn.style.display = '';
    elements.openUrlBtn.style.display = '';

    const manifest = chrome.runtime.getManifest();
    elements.headerText.textContent = manifest.name;

    isSettingsView = false;

    // Refresh UI to reflect any changes made in settings
    updateUI();
    applyUrlTitle();
  }

  // ==================
  // UI Updates
  // ==================

  function updateUI() {
    const isConfigured = config.apiUrl && config.topics.length > 0;

    // Toggle disabled state on form and highlight on settings button
    elements.mainView.classList.toggle('disabled', !isConfigured);
    elements.settingsBtn.classList.toggle('highlight', !isConfigured || serverAccessMissing);

    // Enable/disable the open URL button based on configuration
    elements.openUrlBtn.disabled = !config.apiUrl;

    // Update topic dropdown
    if (!isConfigured) {
      elements.topicSelect.innerHTML = '<option disabled>No topics configured</option>';
      elements.topicDropdownText.textContent = 'No topics configured';
      elements.topicDropdownOptions.innerHTML = '';
    } else {
      updateTopicDropdown();
      if (config.lastTopic) {
        elements.topicSelect.value = config.lastTopic;
        elements.topicDropdownText.textContent = config.lastTopic;
        updateCustomDropdownSelection(config.lastTopic);
      }
    }


    updatePriorityUI();
  }

  function updateTopicDropdown() {
    elements.topicSelect.innerHTML = '';
    elements.topicDropdownOptions.innerHTML = '';

    config.topics.forEach(topic => {
      // Hidden select for form value
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      elements.topicSelect.appendChild(option);

      // Custom dropdown option
      const customOption = document.createElement('div');
      customOption.className = 'custom-dropdown-option';
      customOption.dataset.value = topic;
      customOption.textContent = topic;
      customOption.addEventListener('click', () => selectTopic(topic));
      elements.topicDropdownOptions.appendChild(customOption);
    });

    // Update displayed text
    if (config.topics.length > 0) {
      const selectedTopic = elements.topicSelect.value || config.topics[0];
      elements.topicDropdownText.textContent = selectedTopic;
      updateCustomDropdownSelection(selectedTopic);
    } else {
      elements.topicDropdownText.textContent = 'No topics configured';
    }
  }

  function selectTopic(topic) {
    elements.topicSelect.value = topic;
    elements.topicDropdownText.textContent = topic;
    updateCustomDropdownSelection(topic);
    closeTopicDropdown();

    // Save the selected topic
    config.lastTopic = topic;
    saveToStorage({ lastTopic: topic });

    // Load notifications for the new topic if we are on the receive tab
    if (activeTab === 'receive') {
      loadNotifications();
    }
  }

  function updateCustomDropdownSelection(selectedValue) {
    elements.topicDropdownOptions.querySelectorAll('.custom-dropdown-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === selectedValue);
    });
  }

  function toggleTopicDropdown() {
    elements.topicDropdown.classList.toggle('open');
  }

  function closeTopicDropdown() {
    elements.topicDropdown.classList.remove('open');
  }

  function updatePriorityUI() {
    document.querySelectorAll('#priority-chips .chip').forEach(chip => {
      const priority = parseInt(chip.dataset.priority, 10);
      chip.classList.toggle('active', priority === selectedPriority);
    });
  }



  function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `status visible ${type}`;

    setTimeout(() => {
      elements.status.classList.remove('visible');
    }, 3000);
  }

  function showReceiveStatus(message, type) {
    elements.receiveStatus.textContent = message;
    elements.receiveStatus.className = `status visible ${type}`;

    setTimeout(() => {
      elements.receiveStatus.classList.remove('visible');
    }, 4000);
  }

  function showSettingsStatus(message, type) {
    elements.settingsStatus.textContent = message;
    elements.settingsStatus.className = `status visible ${type}`;

    setTimeout(() => {
      elements.settingsStatus.classList.remove('visible');
    }, 3000);
  }

  function toggleAdvancedOptions() {
    const isOpen = elements.advancedOptions.classList.toggle('visible');
    elements.advancedToggle.classList.toggle('open', isOpen);
    elements.mainContent.classList.toggle('advanced-open', isOpen);
  }

  // ==================
  // Drag and Drop
  // ==================

  function setupDragAndDrop(element, index, type) {
    element.draggable = true;

    element.addEventListener('dragstart', (e) => {
      dragSrcIndex = index;
      dragType = type;
      element.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index);
    });

    element.addEventListener('dragend', () => {
      element.classList.remove('dragging');
      element.classList.remove('drag-over');
      dragSrcIndex = null;
      dragType = null;
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault(); // Necessary to allow dropping
      e.dataTransfer.dropEffect = 'move';
      return false;
    });

    element.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (dragType === type && dragSrcIndex !== index) {
        element.classList.add('drag-over');
      }
    });

    element.addEventListener('dragleave', (e) => {
      element.classList.remove('drag-over');
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      element.classList.remove('drag-over');

      if (dragType !== type) return;
      if (dragSrcIndex === null) return;
      if (dragSrcIndex === index) return;

      // Adjust index if moving item from earlier position to later position
      // because removal shifts indices
      // Note: Splice logic actually handles "insert at index" naturally,
      // but interpretation of "drop on" varies.
      // Current implementation: Remove then Insert.

      // We will perform the move in the data model and re-render.
      // Since we re-render, the dragend might not fire on the original element,
      // so we reset state here too.

      const srcIdx = dragSrcIndex;
      dragSrcIndex = null;
      dragType = null;

      if (type === 'tag') {
        const item = tags[srcIdx];
        tags.splice(srcIdx, 1);
        tags.splice(index, 0, item);
        renderTags();
        saveToStorage({ lastTags: [...tags] });
      } else if (type === 'topic') {
        const item = config.topics[srcIdx];
        config.topics.splice(srcIdx, 1);
        config.topics.splice(index, 0, item);
        renderTopics();
        saveConfig();
      }
    });
  }

  // ==================
  // Tags Handling
  // ==================

  function renderTags() {
    // Clear current badges but keep input
    const badges = elements.tagsContainer.querySelectorAll('.tag-badge');
    badges.forEach(b => b.remove());

    // Insert badges before input
    tags.forEach((tag, index) => {
      const badge = document.createElement('div');
      badge.className = 'tag-badge';
      badge.textContent = tag;

      setupDragAndDrop(badge, index, 'tag');

      const removeSpan = document.createElement('span');
      removeSpan.className = 'tag-remove';
      removeSpan.dataset.index = index;
      removeSpan.textContent = '×';
      badge.appendChild(removeSpan);
      elements.tagsContainer.insertBefore(badge, elements.newTagInput);
    });
  }

  function handleTagKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = elements.newTagInput.value.trim();

      if (value) {
        // Add tag
        if (!tags.includes(value)) {
          tags.push(value);
          renderTags();
          saveToStorage({ lastTags: [...tags] });
        }
        elements.newTagInput.value = '';
        updateTagInputHint(); // Hide hint after clearing
      }
    } else if (e.key === 'Backspace' && !elements.newTagInput.value) {
      // Remove last tag if input is empty
      if (tags.length > 0) {
        tags.pop();
        renderTags();
        saveToStorage({ lastTags: [...tags] });
      }
    }
  }

  function updateTagInputHint() {
    elements.tagInputHint.classList.toggle('visible', elements.newTagInput.value.length > 0);
  }

  function handleTagRemove(e) {
    if (e.target.classList.contains('tag-remove')) {
      const index = parseInt(e.target.dataset.index, 10);
      tags.splice(index, 1);
      renderTags();
      saveToStorage({ lastTags: [...tags] });
    }

    // Focus input if clicking on container
    if (e.target === elements.tagsContainer) {
      elements.newTagInput.focus();
    }
  }

  // ==================
  // Priority Handling
  // ==================

  function handlePriorityClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.priority) return;

    selectedPriority = parseInt(chip.dataset.priority, 10);
    updatePriorityUI();

    // Persist priority
    saveToStorage({ priority: selectedPriority });
    saveToStorage({ priority: selectedPriority });
  }

  // ==================
  // Topics Handling
  // ==================

  function renderTopics() {
    // Clear current badges but keep input
    const badges = elements.topicsContainer.querySelectorAll('.topic-badge');
    badges.forEach(b => b.remove());

    // Insert badges before input
    config.topics.forEach((topic, index) => {
      const badge = document.createElement('div');
      badge.className = 'topic-badge';
      badge.textContent = topic;

      setupDragAndDrop(badge, index, 'topic');

      const removeSpan = document.createElement('span');
      removeSpan.className = 'topic-remove';
      removeSpan.dataset.index = index;
      removeSpan.textContent = '×';
      badge.appendChild(removeSpan);
      elements.topicsContainer.insertBefore(badge, elements.newTopicInput);
    });
  }

  function handleTopicKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = elements.newTopicInput.value.trim();

      if (value) {
        // Add topic if not exists
        if (!config.topics.includes(value)) {
          config.topics.push(value);
          renderTopics();
          saveConfig();
        }
        elements.newTopicInput.value = '';
        updateTopicInputHint(); // Hide hint after clearing
      }
    } else if (e.key === 'Backspace' && !elements.newTopicInput.value) {
      // Remove last topic if input is empty
      if (config.topics.length > 0) {
        config.topics.pop();
        renderTopics();
        saveConfig();
      }
    }
  }

  function updateTopicInputHint() {
    elements.topicInputHint.classList.toggle('visible', elements.newTopicInput.value.length > 0);
  }

  function handleTopicRemove(e) {
    if (e.target.classList.contains('topic-remove')) {
      const index = parseInt(e.target.dataset.index, 10);
      config.topics.splice(index, 1);
      renderTopics();
      saveConfig();
    }

    // Focus input if clicking on container
    if (e.target === elements.topicsContainer) {
      elements.newTopicInput.focus();
    }
  }

  // ==================
  // Open ntfy URL
  // ==================

  function openNtfyUrl() {
    if (config.apiUrl) {
      let url = config.apiUrl;
      const topic = elements.topicSelect.value;

      // Only append topic if it is a valid topic (present in the list of configured topics)
      if (topic && config.topics.includes(topic)) {
        if (url.endsWith('/')) {
          url = url.slice(0, -1);
        }
        url += `/${topic}`;
      }

      chrome.tabs.create({ url: url });
    }
  }

  // ==================
  // Send Notification
  // ==================

  function decodeDataUrl(dataUrl) {
    const base64 = (dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl).replace(/\s/g, '');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes.buffer;
  }

  function showAttachmentSendSummary(sentCount, totalCount, failures) {
    const failureDetails = failures
      .map(({ file, error }) => `${file.name}: ${error.message}`)
      .join('; ');
    const sentText = `${sentCount} of ${totalCount} attachment${totalCount === 1 ? '' : 's'} sent.`;
    showStatus(`${sentText} Failed: ${failureDetails}`, 'error');
  }

  function getZipFilename(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `ntfy-files-${datePart}-${timePart}.zip`;
  }

  async function sendNotification() {
    if (isSending) return;

    const topic = elements.topicSelect.value;
    const rawMessage = elements.messageInput.value.trim();
    const title = elements.titleInput.value.trim();

    // With "Include current tab's URL", the URL is in the title (applyUrlTitle)
    const message = rawMessage;
    const tagsString = tags.join(','); // Use tags array

    // Capture the latest values before validating or sending so a failed send can be retried.
    await flushDraftSave();

    let filesToSend;
    try {
      filesToSend = await readStoredFiles();
      attachments = filesToSend;
      renderAttachments();
    } catch (error) {
      showStatus(`Failed to load attachments: ${error.message}`, 'error');
      return;
    }

    if (!config.apiUrl) {
      showStatus('Configure ntfy URL in settings', 'warning');
      return;
    }

    if (!topic) {
      showStatus('Select a topic', 'warning');
      return;
    }

    isSending = true;
    elements.sendBtn.disabled = true;
    renderAttachments();

    try {
      const apiConfig = {
        apiUrl: config.apiUrl,
        accessToken: config.accessToken
      };

      if (filesToSend.length > 0) {
        const sendAsZip = filesToSend.length > 1 && elements.zipCheckbox.checked;

        if (sendAsZip) {
          const zipData = await ZipUtils.createZip(filesToSend.map(file => ({
            name: file.name,
            data: decodeDataUrl(file.data)
          })));

          await NtfyAPI.sendAttachment(apiConfig, topic, {
            data: zipData,
            filename: getZipFilename(),
            contentType: 'application/zip',
            message: message,
            title: title,
            priority: selectedPriority,
            tags: tagsString
          });

          await finishSuccessfulSend(filesToSend.length, 'ZIP sent!');
          return;
        }

        const failures = [];
        let sentCount = 0;
        let remainingFiles = [...filesToSend];

        // Send sequentially so the backend still receives one attachment per message.
        for (const file of filesToSend) {
          try {
            await NtfyAPI.sendAttachment(apiConfig, topic, {
              data: decodeDataUrl(file.data),
              filename: file.name,
              message: message,
              title: title,
              priority: selectedPriority,
              tags: tagsString
            });
          } catch (error) {
            failures.push({ file, error });
            continue;
          }

          sentCount++;
          remainingFiles = remainingFiles.filter(remainingFile => remainingFile !== file);
          await persistStoredFiles(remainingFiles);
          attachments = remainingFiles;
          renderAttachments();
        }

        if (failures.length > 0) {
          // Failed files remain in storage and the form remains unchanged for retry.
          showAttachmentSendSummary(sentCount, filesToSend.length, failures);
          return;
        }

        await finishSuccessfulSend(filesToSend.length);
      } else {
        // Send text notification using NtfyAPI
        await NtfyAPI.sendNotification(apiConfig, topic, {
          message: message,
          title: title,
          priority: selectedPriority,
          tags: tagsString
        });

        await finishSuccessfulSend(0);
      }
    } catch (error) {
      showStatus(`Error: ${error.message}`, 'error');
    } finally {
      isSending = false;
      elements.sendBtn.disabled = false;
      renderAttachments();
    }
  }

  async function finishSuccessfulSend(attachmentCount, successMessage) {
    cancelScheduledDraftSave();
    elements.messageInput.value = '';
    elements.titleInput.value = '';
    autoTitle = '';
    applyUrlTitle();

    if (attachmentCount > 0) {
      await clearStoredFiles();
    }

    // Clear any saved draft state so it doesn't overwrite preferences next time.
    await removeLocalStorage(['draftState']);
    updatePriorityUI();

    // Close the popup unless "Send another" is checked (the extension's tab stays open).
    if (!elements.sendAnotherCheckbox.checked && !isPageMode) {
      setTimeout(() => window.close(), 100);
    } else {
      const notificationText = successMessage || (attachmentCount > 1
        ? `${attachmentCount} notifications sent!`
        : 'Notification sent!');
      showStatus(notificationText, 'success');
    }
  }
  function setupTooltips() {
    const tooltip = document.getElementById('tooltip');
    let activeElement = null;
    let tooltipTimeout = null;

    document.addEventListener('mouseover', (e) => {
      // Find closest element with a title attribute or data-tooltip
      const target = e.target.closest('[title], [data-tooltip]');

      // If we are already tracking this element, do nothing (prevents timer reset on mouse move inside element)
      if (activeElement && target === activeElement) {
        return;
      }

      // If we moved to a new element (or no element), clear any pending tooltip
      if (activeElement) {
        clearTimeout(tooltipTimeout);
        hideTooltip();
      }

      if (!target) {
        return;
      }

      // If it has a title, move it to data-tooltip to suppress native tooltip
      if (target.hasAttribute('title')) {
        const title = target.getAttribute('title');
        target.setAttribute('data-tooltip', title);
        target.removeAttribute('title');
      }

      const text = target.getAttribute('data-tooltip');
      if (!text) return;

      activeElement = target;

      // Delay showing the tooltip
      tooltipTimeout = setTimeout(() => {
        // Double-check we are still active on this element
        if (activeElement === target) {
          showTooltip(target, text);
        }
      }, 1000); // 1000ms delay
    });

    document.addEventListener('mouseout', (e) => {
      if (activeElement && (e.target === activeElement || e.target.closest('[data-tooltip]') === activeElement)) {
        // check if we moved to child of the active element
        if (e.relatedTarget && activeElement.contains(e.relatedTarget)) {
          return;
        }

        // otherwise, we left the element entirely
        clearTimeout(tooltipTimeout);
        hideTooltip();
      }
    });

    function showTooltip(element, text) {
      if (!element.isConnected) return; // Verify element is still in DOM

      tooltip.textContent = text;
      tooltip.classList.add('visible');

      const rect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 8;

      // Default: Top center
      let top = rect.top - tooltipRect.height - margin;
      let left = rect.left + (rect.width - tooltipRect.width) / 2;

      // prevent overflow top
      if (top < 0) {
        top = rect.bottom + margin;
      }

      // prevent overflow left/right
      if (left < margin) {
        left = margin;
      } else if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
      }

      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    }

    function hideTooltip() {
      tooltip.classList.remove('visible');
      activeElement = null;
    }
  }

  // ==================
  // Keyboard Shortcuts
  // ==================

  function handleGlobalKeydown(e) {
    if (e.code === 'ControlRight') {
      rightCtrlDown = true;
    }

    if (e.key === 'Enter' && rightCtrlDown) {
      // Check if send button is visible and enabled
      // offsetParent is null if element or any parent is hidden (display: none)
      if (elements.sendBtn.offsetParent !== null && !elements.sendBtn.disabled) {
        e.preventDefault();
        elements.sendBtn.click();
      }
    }
  }

  function handleGlobalKeyup(e) {
    if (e.code === 'ControlRight') {
      rightCtrlDown = false;
    }
  }

  // ==================
  // Recent Notifications
  // ==================

  // Lists the received messages of all topics, like the unread badge counts them. (Filtering by the
  // Send tab's topic hid everything when that topic was one the token can only send to.)
  async function loadNotifications() {
    if (!config.apiUrl || config.topics.length === 0) {
      elements.notificationsList.innerHTML = '<div class="notifications-empty">Configure server and topics to view notifications</div>';
      return;
    }

    try {
      const localData = await getFromStorageLocal(['receivedNotifications', THUMBNAIL_CACHE_KEY]);
      const allNotifications = (localData.receivedNotifications || [])
        .filter(notification => !deletedMessageIds.includes(notification.id));
      thumbnailCache = localData[THUMBNAIL_CACHE_KEY] || {};
      pruneThumbnails(allNotifications);

      if (receiveFilter !== 'all' && !config.topics.includes(receiveFilter)) {
        receiveFilter = 'all';
      }
      renderTopicSidebar(allNotifications);

      const notifications = receiveFilter === 'all'
        ? allNotifications
        : allNotifications.filter(notification => notification.topic === receiveFilter);

      // Save currently visible notifications for bulk actions
      currentNotifications = notifications;

      // Show control bar only if there are notifications to manage
      elements.notificationsControlBar.style.visibility = notifications.length > 0 ? 'visible' : 'hidden'; // Keeps its space, so the heading doesn't move

      elements.notificationsList.innerHTML = '';

      if (notifications.length === 0) {
        elements.notificationsList.innerHTML = '<div class="notifications-empty">No recent notifications</div>';
        return;
      }

      // Sort notifications by time descending (newest first)
      notifications.sort((a, b) => b.time - a.time);

      notifications.forEach(notification => {
        const item = document.createElement('div');
        item.className = 'notification-item';
        item.dataset.priority = notification.priority || 3;

        const isRead = readMessageIds.includes(notification.id);
        if (isRead) {
          item.classList.add('read');
        }

        const header = document.createElement('div');
        header.className = 'notification-header';

        const title = document.createElement('span');
        title.className = 'notification-title';
        title.textContent = notification.title || 'Notification';
        header.appendChild(title);

        const time = document.createElement('span');
        time.className = 'notification-time';
        time.textContent = `${notification.topic} · ${formatTime(notification.time)}`;
        header.appendChild(time);

        item.appendChild(header);

        const message = document.createElement('div');
        message.className = 'notification-message';
        const text = notification.message || '';
        // Rendered only for messages sent as Markdown, like the ntfy web app does
        const markdown = notification.content_type === 'text/markdown'
          ? Markdown.render(text, { createLink: createMessageLink })
          : null;
        message.classList.toggle('markdown', Boolean(markdown));
        message.replaceChildren(...(markdown || linkify(text)));
        item.appendChild(message);

        if (isImageAttachment(notification.attachment)) {
          item.appendChild(createImagePreview(notification));
        }

        // Footer for tags and actions
        const footer = document.createElement('div');
        footer.className = 'notification-footer';

        if (notification.tags && notification.tags.length > 0) {
          const tagsContainer = document.createElement('div');
          tagsContainer.className = 'notification-tags';
          notification.tags.forEach(tag => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'notification-tag';
            tagSpan.textContent = tag;
            tagsContainer.appendChild(tagSpan);
          });
          footer.appendChild(tagsContainer);
        }

        // Actions
        const actions = document.createElement('div');
        actions.className = 'notification-actions';

        if (!isRead) {
          const readBtn = document.createElement('button');
          readBtn.className = 'notification-action-btn read-btn';
          readBtn.textContent = '✓';
          readBtn.title = 'Mark as Read';
          readBtn.addEventListener('click', () => handleMarkAsRead(notification.id, item, readBtn));
          actions.appendChild(readBtn);
        }

        if (notification.attachment && NtfyAPI.isHttpUrl(notification.attachment.url)) {
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'notification-action-btn download-btn';
          downloadBtn.appendChild(createDownloadIcon());
          downloadBtn.title = notification.attachment.name ? `Download ${notification.attachment.name}` : 'Download attachment';
          downloadBtn.addEventListener('click', () => handleDownload(notification.attachment, downloadBtn));
          actions.appendChild(downloadBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'notification-action-btn delete-btn';
        setDeleteButtonArmed(deleteBtn, notification.id === pendingDeleteId);
        deleteBtn.addEventListener('click', () => handleDeleteClick(notification.id, item, deleteBtn));
        actions.appendChild(deleteBtn);

        footer.appendChild(actions);
        item.appendChild(footer);

        elements.notificationsList.appendChild(item);
      });
    } catch (error) {
      console.error('Error loading notifications:', error);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'notifications-error';
      errorDiv.textContent = `Error: ${error.message}`;
      elements.notificationsList.replaceChildren(errorDiv);
    }
  }

  // Topic list of the Receive tab: All topics, then each configured topic, with unread counts
  function renderTopicSidebar(notifications) {
    const unreadCount = topic => notifications
      .filter(notification => topic === 'all' || notification.topic === topic)
      .filter(notification => !readMessageIds.includes(notification.id))
      .length;

    const entries = ['all', ...config.topics];
    elements.topicSidebar.replaceChildren(...entries.map(topic => {
      const btn = document.createElement('button');
      btn.className = 'topic-filter-btn';
      btn.classList.toggle('active', topic === receiveFilter);

      const name = document.createElement('span');
      name.className = 'topic-filter-name';
      name.textContent = topic === 'all' ? 'All topics' : topic;
      btn.appendChild(name);

      const count = unreadCount(topic);
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'topic-unread-count';
        badge.textContent = count;
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => {
        receiveFilter = topic;
        setDeleteAllArmed(false);
        saveToStorageLocal({ receiveTopicFilter: topic }).catch(() => {});
        loadNotifications();
      });
      return btn;
    }));
  }

  // Text and link nodes for a message: http(s) URLs become links that open in a new tab
  function linkify(text) {
    const nodes = [];
    let last = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      // Leave trailing punctuation out of the link, e.g. a full stop after the URL
      const url = match[0].replace(/[.,;:!?)\]}]+$/, '');
      if (!NtfyAPI.isHttpUrl(url)) {
        continue;
      }
      nodes.push(document.createTextNode(text.slice(last, match.index)));
      nodes.push(createMessageLink(url, [document.createTextNode(url)]));
      last = match.index + url.length;
    }
    nodes.push(document.createTextNode(text.slice(last)));
    return nodes;
  }

  // Link in a message that opens in a new tab. The tooltip shows the real target, as Markdown
  // link text can claim to be a different URL.
  function createMessageLink(url, content) {
    const link = document.createElement('a');
    link.className = 'notification-link';
    link.href = url;
    link.title = url;
    link.append(...content);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url });
    });
    return link;
  }

  // ==================
  // Image Previews
  // ==================

  // Downscaled copies of image attachments, by message id, so the list doesn't load full-size images
  const THUMBNAIL_CACHE_KEY = 'imageThumbnails';
  const THUMBNAIL_MAX_SIZE = 320; // px, longest side (shown at up to half that, sharp on HiDPI screens)
  const THUMBNAIL_MAX_SOURCE_BYTES = 15 * 1024 * 1024;
  let thumbnailCache = {};
  const thumbnailJobs = new Map(); // message id -> Promise<string|null>
  let thumbnailCacheQueue = Promise.resolve();

  function isImageAttachment(attachment) {
    if (!attachment || !NtfyAPI.isHttpUrl(attachment.url)) {
      return false;
    }
    if (attachment.type) {
      return attachment.type.startsWith('image/');
    }
    return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(attachment.name || '');
  }

  function createImagePreview(notification) {
    const attachment = notification.attachment;
    const preview = document.createElement('button');
    preview.className = 'notification-image';
    preview.title = attachment.name ? `Open ${attachment.name}` : 'Open image';
    preview.style.display = 'none';

    const img = document.createElement('img');
    img.alt = attachment.name || 'Image attachment';
    img.decoding = 'async';
    img.addEventListener('load', () => { preview.style.display = ''; });
    img.addEventListener('error', () => {
      console.warn(`Image preview: could not load ${attachment.name || 'the attachment'}`);
      preview.remove();
    });
    preview.appendChild(img);

    preview.addEventListener('click', () => chrome.tabs.create({ url: attachment.url }));

    getThumbnail(notification).then(src => {
      if (src) {
        img.src = src;
      } else {
        preview.remove();
      }
    });
    return preview;
  }

  // Resolves to the thumbnail's data URL, the original URL if it can't be downscaled, or null if expired
  function getThumbnail(notification) {
    const id = notification.id;
    const attachment = notification.attachment;
    if (thumbnailCache[id]) {
      return Promise.resolve(thumbnailCache[id]);
    }
    if (attachment.expires && attachment.expires * 1000 < Date.now()) {
      console.warn(`Image preview: ${attachment.name || 'the attachment'} has expired`);
      return Promise.resolve(null);
    }

    if (!thumbnailJobs.has(id)) {
      thumbnailJobs.set(id, (async () => {
        try {
          const dataUrl = await createThumbnail(attachment);
          await storeThumbnail(id, dataUrl);
          return dataUrl;
        } catch (e) {
          if (e.status === 429) {
            // Server request limit: don't spend another request on the original, try again next time
            thumbnailJobs.delete(id);
            return null;
          }
          // E.g. the image's server doesn't allow reading it (CORS): show the original, scaled down by CSS
          console.warn(`Image preview: could not downscale ${attachment.name || 'the attachment'}:`, e.message);
          return attachment.url;
        }
      })());
    }
    return thumbnailJobs.get(id);
  }

  async function createThumbnail(attachment) {
    if (attachment.size && attachment.size > THUMBNAIL_MAX_SOURCE_BYTES) {
      throw new Error('Image too large');
    }

    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    }
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(bitmap.width, bitmap.height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    return canvas.toDataURL('image/webp', 0.8);
  }

  // Stored one write at a time, so thumbnails made at the same time don't overwrite each other
  function storeThumbnail(id, dataUrl) {
    thumbnailCache[id] = dataUrl;
    thumbnailCacheQueue = thumbnailCacheQueue.then(async () => {
      const stored = (await getFromStorageLocal([THUMBNAIL_CACHE_KEY]))[THUMBNAIL_CACHE_KEY] || {};
      stored[id] = dataUrl;
      await saveToStorageLocal({ [THUMBNAIL_CACHE_KEY]: stored });
    }).catch(error => console.error('Error saving image thumbnail:', error));
    return thumbnailCacheQueue;
  }

  // Drop thumbnails of messages that left the history or were deleted
  function pruneThumbnails(notifications) {
    const ids = new Set(notifications.map(notification => notification.id));
    if (Object.keys(thumbnailCache).every(id => ids.has(id))) {
      return;
    }

    thumbnailCacheQueue = thumbnailCacheQueue.then(async () => {
      const stored = (await getFromStorageLocal([THUMBNAIL_CACHE_KEY]))[THUMBNAIL_CACHE_KEY] || {};
      Object.keys(stored).forEach(id => {
        if (!ids.has(id)) {
          delete stored[id];
        }
      });
      thumbnailCache = stored;
      await saveToStorageLocal({ [THUMBNAIL_CACHE_KEY]: stored });
    }).catch(error => console.error('Error pruning image thumbnails:', error));
  }

  function formatTime(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }

  async function loadLocalState() {
    try {
      const result = await getFromStorageLocal(['readMessageIds', 'deletedMessageIds', 'receiveTopicFilter']);
      readMessageIds = result.readMessageIds || [];
      deletedMessageIds = result.deletedMessageIds || [];
      receiveFilter = result.receiveTopicFilter || 'all';
    } catch (error) {
      console.error('Error loading local state:', error);
    }
  }

  function scheduleNotificationsRefresh() {
    clearTimeout(listRefreshTimer);
    // Coalesces the burst of writes a sync makes, one per received message
    listRefreshTimer = setTimeout(() => {
      if (listPointerDown) {
        listRefreshPending = true;
        return;
      }
      loadLocalState().then(loadNotifications);
    }, 100);
  }

  function releaseListPointer() {
    if (!listPointerDown) return;
    listPointerDown = false;
    if (listRefreshPending) {
      listRefreshPending = false;
      // After the click event that follows this release
      setTimeout(scheduleNotificationsRefresh, 0);
    }
  }

  // Read-modify-write of an ID list against storage, not the popup's copy, which a refresh may have
  // replaced with an older one
  async function updateStoredIds(key, update) {
    const result = await getFromStorageLocal([key]);
    const ids = update(result[key] || []);
    await saveToStorageLocal({ [key]: ids });
    return ids;
  }

  async function handleMarkAsRead(messageId, itemElement, btnElement) {
    itemElement.classList.add('read');
    btnElement.remove();
    try {
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => ids.includes(messageId) ? ids : [...ids, messageId]);
    } catch (error) {
      console.error('Error saving readMessageIds:', error);
      showReceiveStatus('Failed to mark as read', 'error');
    }
  }

  const DELETE_CONFIRM_TIMEOUT = 4000;

  function setDeleteButtonArmed(btnElement, armed) {
    btnElement.classList.toggle('confirming', armed);
    btnElement.textContent = armed ? 'Delete?' : '×';
    btnElement.title = armed ? 'Click again to delete' : 'Delete Notification';
  }

  // The first click arms the button, a second one within a few seconds deletes
  function handleDeleteClick(messageId, itemElement, btnElement) {
    if (pendingDeleteId === messageId) {
      clearPendingDelete();
      handleDelete(messageId, itemElement);
      return;
    }
    clearPendingDelete();
    pendingDeleteId = messageId;
    setDeleteButtonArmed(btnElement, true);
    pendingDeleteTimer = setTimeout(clearPendingDelete, DELETE_CONFIRM_TIMEOUT);
  }

  function clearPendingDelete() {
    clearTimeout(pendingDeleteTimer);
    pendingDeleteId = null;
    elements.notificationsList.querySelectorAll('.delete-btn.confirming')
      .forEach(btn => setDeleteButtonArmed(btn, false));
  }

  async function handleDelete(messageId, itemElement) {
    try {
      itemElement.remove();
      if (elements.notificationsList.children.length === 0) {
        elements.notificationsList.innerHTML = '<div class="notifications-empty">No recent notifications</div>';
      }

      deletedMessageIds = await updateStoredIds('deletedMessageIds',
        ids => ids.includes(messageId) ? ids : [...ids, messageId]);
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => ids.filter(id => id !== messageId));
    } catch (error) {
      console.error('Error deleting notification locally:', error);
      showReceiveStatus('Failed to delete notification', 'error');
    }
  }

  // Download an attachment under its own name. A cross-origin link ignores the download attribute, so
  // fetch the file and save it from a blob URL.
  async function handleDownload(attachment, btnElement) {
    btnElement.disabled = true;
    try {
      let response;
      // ntfy refills its request limit by one request every 5 s, so retry a 429 a couple of times
      for (let attempt = 0; ; attempt++) {
        try {
          response = await fetch(attachment.url);
        } catch (error) {
          // E.g. the server doesn't allow reading the file (CORS): open it in a tab, where ntfy's
          // Content-Disposition: attachment makes the browser download it
          console.warn(`Download: could not fetch ${attachment.name || 'the attachment'}:`, error.message);
          chrome.tabs.create({ url: attachment.url });
          return;
        }
        if (response.status !== 429 || attempt >= DOWNLOAD_RETRY_DELAYS.length) {
          break;
        }
        showReceiveStatus('Server is busy, retrying the download…', 'warning');
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_RETRY_DELAYS[attempt]));
      }
      if (!response.ok) {
        showReceiveStatus(downloadErrorMessage(response.status), 'error');
        return;
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = attachment.name || 'attachment';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (error) {
      console.error('Download failed:', error);
      showReceiveStatus('Download failed', 'error');
    } finally {
      btnElement.disabled = false;
    }
  }

  const DOWNLOAD_RETRY_DELAYS = [6000, 12000];

  function downloadErrorMessage(status) {
    if (status === 404 || status === 410) {
      return 'Download failed: the attachment has expired or was deleted';
    }
    if (status === 429) {
      return 'Download failed: the server\'s request limit was reached, try again later';
    }
    return `Download failed (HTTP ${status})`;
  }

  function createDownloadIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', 'M5 20h14v-2H5v2zm14-11h-4V3H9v6H5l7 7 7-7z');
    svg.appendChild(path);
    return svg;
  }

  async function handleMarkAllRead() {
    if (currentNotifications.length === 0) return;

    const visibleIds = currentNotifications.map(notification => notification.id);
    try {
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => [...ids, ...visibleIds.filter(id => !ids.includes(id))]);
      showStatus('All marked as read', 'success');
    } catch (error) {
      console.error('Error saving readMessageIds:', error);
      showStatus('Failed to mark all as read', 'error');
    }
  }

  function setDeleteAllArmed(armed) {
    deleteAllArmed = armed;
    clearTimeout(deleteAllTimer);
    elements.deleteAllBtn.classList.toggle('confirming', armed);
    const scope = receiveFilter === 'all' ? 'all' : `all in "${receiveFilter}"`;
    elements.deleteAllBtn.textContent = armed ? `Delete ${scope}?` : '🗑 Delete all';
    elements.deleteAllBtn.title = armed ? 'Click again to delete' : 'Delete all';
    if (armed) {
      deleteAllTimer = setTimeout(() => setDeleteAllArmed(false), DELETE_CONFIRM_TIMEOUT);
    }
  }

  // Like a single delete: the first click arms the button, the second deletes
  async function handleDeleteAll() {
    if (currentNotifications.length === 0) return;

    if (!deleteAllArmed) {
      setDeleteAllArmed(true);
      return;
    }
    setDeleteAllArmed(false);

    const visibleIds = currentNotifications.map(notification => notification.id);
    try {
      deletedMessageIds = await updateStoredIds('deletedMessageIds',
        ids => [...ids, ...visibleIds.filter(id => !ids.includes(id))]);
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => ids.filter(id => !visibleIds.includes(id)));
      showStatus('All notifications deleted', 'success');
    } catch (error) {
      console.error('Error performing bulk delete:', error);
      showStatus('Failed to delete all', 'error');
    }
  }

});
