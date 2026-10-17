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

    // Advanced options
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedOptions: document.getElementById('advanced-options'),

    // Actions
    sendBtn: document.getElementById('send-btn'),
    sendAnotherCheckbox: document.getElementById('send-another-checkbox'),

    // Status
    status: document.getElementById('status'),
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
    pageUrl: '',
    sendAsZipEnabled: false
  };

  let tags = []; // State for tags
  let readMessageIds = []; // State for read notifications
  let deletedMessageIds = []; // State for deleted notifications (client-side only)
  let activeTab = 'send'; // Active tab state
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
  const STORAGE_KEYS = ['topics', 'apiUrl', 'theme', 'priority', 'lastTags', 'lastTopic', 'sendAnotherEnabled', 'includeUrl', SEND_AS_ZIP_SETTING_KEY];
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
    if (pageParams.get('tab') === 'receive') {
      switchTab('receive');
    } else {
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
          console.log('Local notifications history changed, re-rendering...');
          loadLocalState().then(() => {
            loadNotifications();
          });
        }
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
      const localData = await getFromStorageLocal(['receivedNotifications']);
      const allNotifications = (localData.receivedNotifications || [])
        .filter(notification => !deletedMessageIds.includes(notification.id));

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
        message.textContent = notification.message || '';
        item.appendChild(message);

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

        const readBtn = document.createElement('button');
        readBtn.className = 'notification-action-btn read-btn';
        readBtn.textContent = '✓';
        readBtn.title = isRead ? 'Mark as Unread' : 'Mark as Read';
        readBtn.addEventListener('click', () => handleMarkAsRead(notification.id, item, readBtn));
        actions.appendChild(readBtn);

        if (notification.attachment && NtfyAPI.isHttpUrl(notification.attachment.url)) {
          const linkBtn = document.createElement('button');
          linkBtn.className = 'notification-action-btn link-btn';
          linkBtn.textContent = '🔗';
          linkBtn.title = 'Copy Attachment Link';
          linkBtn.addEventListener('click', () => handleCopyLink(notification.attachment.url, linkBtn));
          actions.appendChild(linkBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'notification-action-btn delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete Notification';
        deleteBtn.addEventListener('click', () => handleDelete(notification.id, item));
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
        saveToStorageLocal({ receiveTopicFilter: topic }).catch(() => {});
        loadNotifications();
      });
      return btn;
    }));
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

  async function handleMarkAsRead(messageId, itemElement, btnElement) {
    const index = readMessageIds.indexOf(messageId);
    if (index > -1) {
      // Make unread
      readMessageIds.splice(index, 1);
      itemElement.classList.remove('read');
      btnElement.title = 'Mark as Read';
    } else {
      // Make read
      readMessageIds.push(messageId);
      itemElement.classList.add('read');
      btnElement.title = 'Mark as Unread';
    }

    try {
      await saveToStorageLocal({ readMessageIds: readMessageIds });
    } catch (error) {
      console.error('Error saving readMessageIds:', error);
    }
  }

  async function handleDelete(messageId, itemElement) {
    try {
      if (!deletedMessageIds.includes(messageId)) {
        deletedMessageIds.push(messageId);
        await saveToStorageLocal({ deletedMessageIds: deletedMessageIds });
      }

      itemElement.remove();

      const index = readMessageIds.indexOf(messageId);
      if (index > -1) {
        readMessageIds.splice(index, 1);
        await saveToStorageLocal({ readMessageIds: readMessageIds });
      }

      if (elements.notificationsList.children.length === 0) {
        elements.notificationsList.innerHTML = '<div class="notifications-empty">No recent notifications</div>';
      }
    } catch (error) {
      console.error('Error deleting notification locally:', error);
      showStatus('Failed to delete notification', 'error');
    }
  }

  async function handleCopyLink(url, btnElement) {
    try {
      await navigator.clipboard.writeText(url);
      const originalTitle = btnElement.title;
      btnElement.title = 'Copied!';
      btnElement.style.color = 'var(--primary-light)';

      showStatus('Attachment link copied!', 'success');

      setTimeout(() => {
        btnElement.title = originalTitle;
        btnElement.style.color = '';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      showStatus('Failed to copy link', 'error');
    }
  }

  async function handleMarkAllRead() {
    if (currentNotifications.length === 0) return;

    let updated = false;
    currentNotifications.forEach(notification => {
      if (!readMessageIds.includes(notification.id)) {
        readMessageIds.push(notification.id);
        updated = true;
      }
    });

    if (updated) {
      try {
        await saveToStorageLocal({ readMessageIds: readMessageIds });
        showStatus('All marked as read', 'success');
      } catch (error) {
        console.error('Error saving readMessageIds:', error);
        showStatus('Failed to mark all as read', 'error');
      }
    }
  }

  async function handleDeleteAll() {
    if (currentNotifications.length === 0) return;

    const scope = receiveFilter === 'all' ? '' : ` in topic "${receiveFilter}"`;
    if (!confirm(`Are you sure you want to delete all notifications${scope}?`)) {
      return;
    }

    try {
      let updatedDeleted = false;
      let updatedRead = false;

      currentNotifications.forEach(notification => {
        if (!deletedMessageIds.includes(notification.id)) {
          deletedMessageIds.push(notification.id);
          updatedDeleted = true;
        }
        const readIndex = readMessageIds.indexOf(notification.id);
        if (readIndex > -1) {
          readMessageIds.splice(readIndex, 1);
          updatedRead = true;
        }
      });

      if (updatedDeleted) {
        await saveToStorageLocal({ deletedMessageIds: deletedMessageIds });
      }
      if (updatedRead) {
        await saveToStorageLocal({ readMessageIds: readMessageIds });
      }

      showStatus('All notifications deleted', 'success');
    } catch (error) {
      console.error('Error performing bulk delete:', error);
      showStatus('Failed to delete all', 'error');
    }
  }

});
