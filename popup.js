document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const elements = {
    // Views
    mainView: document.getElementById('main-view'),
    settingsView: document.getElementById('settings-view'),

    // Header
    backBtn: document.getElementById('back-btn'),
    headerText: document.getElementById('header-text'),
    openUrlBtn: document.getElementById('open-url-btn'),
    settingsBtn: document.getElementById('settings-btn'),

    // Composer
    composer: document.getElementById('composer'),
    composerToggle: document.getElementById('composer-toggle'),
    composerOptions: document.getElementById('composer-options'),
    messageSlot: document.getElementById('message-slot'),
    titleInput: document.getElementById('title-input'),
    messageInput: document.getElementById('message-input'),
    tagsContainer: document.getElementById('tags-container'),
    newTagInput: document.getElementById('new-tag-input'),
    tagInputHint: document.getElementById('tag-input-hint'),
    emojiBtn: document.getElementById('emoji-btn'),
    emojiPicker: document.getElementById('emoji-picker'),
    emojiSearch: document.getElementById('emoji-search'),
    emojiList: document.getElementById('emoji-list'),


    // File handling
    fileBtn: document.getElementById('file-btn'),
    filePreview: document.getElementById('file-preview'),
    zipToggle: document.getElementById('zip-toggle'),
    zipCheckbox: document.getElementById('zip-checkbox'),

    // Priority & Theme chips
    priorityChips: document.getElementById('priority-chips'),
    themeChips: document.getElementById('theme-chips'),
    sizeChips: document.getElementById('size-chips'),

    // Actions
    sendBtn: document.getElementById('send-btn'),
    insertUrlBtn: document.getElementById('insert-url-btn'),
    composerField: document.getElementById('composer-field'),
    sendAnotherCheckbox: document.getElementById('send-another-checkbox'),
    markdownCheckbox: document.getElementById('markdown-checkbox'),

    // Status
    status: document.getElementById('status'),
    settingsStatus: document.getElementById('settings-status'),

    // Settings inputs
    urlInput: document.getElementById('url-input'),
    tokenInput: document.getElementById('token-input'),
    usernameInput: document.getElementById('username-input'),
    passwordInput: document.getElementById('password-input'),
    insecureHint: document.getElementById('insecure-hint'),
    serverAccessBtn: document.getElementById('server-access-btn'),
    serverAccessHint: document.getElementById('server-access-hint'),
    receiveCheckbox: document.getElementById('receive-checkbox'),

    // Receive hint
    receiveHint: document.getElementById('receive-hint'),
    receiveHintMessage: document.getElementById('receive-hint-message'),
    receiveHintDismiss: document.getElementById('receive-hint-dismiss'),
    topicsContainer: document.getElementById('topics-container'),
    newTopicInput: document.getElementById('new-topic-input'),
    topicInputHint: document.getElementById('topic-input-hint'),

    // Recent Notifications
    notificationsTitle: document.getElementById('notifications-title'),
    notificationsSection: document.getElementById('notifications-section'),
    serverSection: document.getElementById('settings-server-title').parentElement,
    topicsSection: document.getElementById('settings-topics-title').parentElement,
    notificationsList: document.getElementById('notifications-list'),
    topicSidebar: document.getElementById('topic-sidebar'),

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
    username: '',
    password: '',

    theme: 'auto',
    popupSize: 'medium',
    pageUrl: '',
    sendAsZipEnabled: false,
    receiveEnabled: false
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
  let receiveFilter = 'all'; // Topic shown and sent to, or 'all' (nothing to send to)
  let receiveHintDismissed = false; // The hint about the Receive messages setting is shown only once
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
  const STORAGE_KEYS = ['topics', 'apiUrl', 'theme', 'priority', 'lastTags', 'sendAnotherEnabled', 'markdownEnabled', 'receiveEnabled', 'popupSize', SEND_AS_ZIP_SETTING_KEY];
  const POPUP_SIZES = ['small', 'medium', 'large'];
  // The size is also kept in localStorage, so it applies before the first paint
  // instead of after the asynchronous settings load
  const POPUP_SIZE_CACHE_KEY = 'popupSize';

  try {
    applyPopupSize(localStorage.getItem(POPUP_SIZE_CACHE_KEY));
  } catch (e) {}
  const STORED_FILES_KEY = 'storedFiles';
  const LEGACY_STORED_FILE_KEY = 'storedFile';

  // The popup opens on the view it was closed on. Kept in localStorage like the size, so the
  // settings show from the first paint; init fills them in once the config is loaded.
  const LAST_VIEW_KEY = 'lastView';
  let reopenSettings = false;
  try {
    reopenSettings = localStorage.getItem(LAST_VIEW_KEY) === 'settings';
  } catch (e) {}
  if (reopenSettings) {
    setViewChrome(true);
  }

  // Initialize
  init();

  async function init() {
    await loadConfig();
    await loadLocalState();
    await checkSessionAndCleanup(); // Check session and cleanup old files if needed
    await restoreDraftState();
    await loadStoredFiles();
    setupEventListeners();
    await updateServerAccessUI(config.apiUrl);
    updateUI();
    // Ensure priority UI is updated after config load
    updatePriorityUI();
    applyTheme();
    // The synced setting wins, e.g. when changed in another browser
    applyPopupSize(config.popupSize);
    try {
      localStorage.setItem(POPUP_SIZE_CACHE_KEY, config.popupSize);
    } catch (e) {}
    // Render initial empty tags or restored ones
    renderTags();
    if (reopenSettings) {
      showSettingsView();
    } else {
      // Set header title dynamically from manifest
      elements.headerText.textContent = chrome.runtime.getManifest().name;
    }

    updateInsertUrlButton();
    autoSizeMessageInput();
    // Back from the file picker: show the attached files
    setComposerOptionsOpen(attachments.length > 0 || !config.receiveEnabled);
    await loadNotifications();
    if (!isSettingsView && !elements.composer.hidden) {
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
      // Before reading apiUrl: moves credentials out of it
      const credentials = await NtfyAPI.getServerCredentials();
      const items = await getFromStorage(STORAGE_KEYS);
      const accessToken = await NtfyAPI.getAccessToken();
      config.pageUrl = await getPageUrl();
      config = {
        ...config,
        topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : [],
        apiUrl: NtfyAPI.normalizeServerUrl(items.apiUrl),
        accessToken: accessToken,
        username: credentials.username,
        password: credentials.password,

        theme: items.theme || 'auto',
        popupSize: POPUP_SIZES.includes(items.popupSize) ? items.popupSize : 'medium',
        sendAnotherEnabled: items.sendAnotherEnabled === true,
        markdownEnabled: items.markdownEnabled === true,
        receiveEnabled: items.receiveEnabled === true,
        sendAsZipEnabled: items[SEND_AS_ZIP_SETTING_KEY] === true
      };

      // Restore 'Send another' checkbox state
      elements.sendAnotherCheckbox.checked = config.sendAnotherEnabled;
      elements.markdownCheckbox.checked = config.markdownEnabled;
      elements.receiveCheckbox.checked = config.receiveEnabled;
      elements.zipCheckbox.checked = config.sendAsZipEnabled;

      if (items.priority) {
        selectedPriority = items.priority;
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
    // Credentials typed into the URL (https://user:password@host) move to their own fields: the URL
    // is synced to other browsers, the credentials are kept on this device only
    const server = NtfyAPI.splitServerUrl(elements.urlInput.value);
    if (server.username || server.password) {
      elements.urlInput.value = server.url;
      elements.usernameInput.value = server.username;
      elements.passwordInput.value = server.password;
    }

    const newConfig = {
      // "ntfy.sh" is saved as "https://ntfy.sh"; the field keeps what was typed until the settings reopen
      apiUrl: server.url,
      accessToken: elements.tokenInput.value,
      username: elements.usernameInput.value,
      password: elements.passwordInput.value,
      topics: config.topics.join(','), // Use current config state which is kept in sync

      theme: config.theme,
      popupSize: config.popupSize,
      receiveEnabled: elements.receiveCheckbox.checked,
      sendAsZipEnabled: config.sendAsZipEnabled
    };

    try {
      const { accessToken, username, password, ...syncedSettings } = newConfig;
      // The writes start right away, so they also complete when the popup is closing
      await Promise.all([
        saveToStorage(syncedSettings),
        NtfyAPI.setAccessToken(accessToken),
        NtfyAPI.setServerCredentials(username, password)
      ]);
      config = {
        ...config,
        ...newConfig,
        topics: newConfig.topics.split(',').map(t => t.trim()).filter(Boolean)
      };

      // showSettingsStatus('Saved', 'success');

      // We don't want to full updateUI here because it might disrupt typing
      renderTopics(); // Re-render to ensure state consistency
      updateThemeChipsUI(); // Ensure UI reflects state
      updateSizeChipsUI();
      updateServerAccessUI(config.apiUrl);

    } catch (error) {
      showSettingsStatus('Failed to save settings', 'error');
    }
  }

  // flush() runs a pending call right away, cancel() drops it
  function debounce(func, wait) {
    let timeout = null;
    const debounced = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        func();
      }, wait);
    };
    debounced.cancel = () => {
      clearTimeout(timeout);
      timeout = null;
    };
    debounced.flush = () => {
      if (timeout !== null) {
        debounced.cancel();
        func();
      }
    };
    return debounced;
  }

  // Settings typed in the server and token fields
  const debouncedSave = debounce(saveConfig, 1000);

  // The popup closes on any click outside it, often right after typing, and its timers end with it.
  // Save what is still pending: chrome.storage writes started now still complete.
  function savePendingChanges() {
    if (isSettingsView) {
      addTopicFromInput(); // A topic typed without Enter
    }
    debouncedSave.flush();
    if (draftSaveTimer !== null) {
      flushDraftSave().catch(error => console.error('Error saving draft:', error));
    }
  }

  // ==================
  // Server Access
  // ==================

  // Asked for only once the server's CORS headers blocked a request (NtfyAPI.checkServerAccessBlocked):
  // most servers, ntfy itself included, let the extension through.
  async function updateServerAccessUI(apiUrl) {
    const pattern = NtfyAPI.serverOriginPattern(apiUrl);
    let missing = false;
    if (pattern) {
      try {
        const { serverAccessBlocked } = await chrome.storage.local.get('serverAccessBlocked');
        missing = serverAccessBlocked === pattern
          && !(await chrome.permissions.contains({ origins: [pattern] }));
      } catch (e) {
        missing = false;
      }
    }

    serverAccessMissing = missing;
    elements.serverAccessBtn.style.display = missing ? '' : 'none';
    elements.serverAccessHint.style.display = missing ? '' : 'none';
    elements.settingsBtn.classList.toggle('highlight', !(config.apiUrl && config.topics.length > 0) || missing);
    updateMissingSettings();
  }

  function requestServerAccess() {
    const pattern = NtfyAPI.serverOriginPattern(elements.urlInput.value.trim());
    if (!pattern) {
      return;
    }

    // Called directly from the click: permissions.request needs a user gesture
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      showSettingsStatus(granted ? 'Server access granted' : 'Server access not granted', granted ? 'success' : 'error');
      updateServerAccessUI(elements.urlInput.value.trim());
      if (granted) {
        chrome.runtime.sendMessage({ action: 'sync' }); // Fetch what was missed while blocked
      }
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

  function applyPopupSize(size) {
    document.body.setAttribute('data-size', POPUP_SIZES.includes(size) ? size : 'medium');
  }

  function updateSizeChipsUI() {
    elements.sizeChips.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.size === config.popupSize);
    });
  }

  function handleSizeChange(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.size) return;

    config.popupSize = chip.dataset.size;
    applyPopupSize(config.popupSize);
    updateSizeChipsUI();
    try {
      localStorage.setItem(POPUP_SIZE_CACHE_KEY, config.popupSize);
    } catch (e) {}
    saveConfig();
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
    updateComposerToggleUI();
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
    renderAttachments();
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function saveDraftState() {
    const draft = {
      title: elements.titleInput.value,
      message: elements.messageInput.value,
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

  // The link button in the message bar inserts the tab's URL. Always there, so it can say why when the
  // tab's address isn't available; then it is dimmed further.
  function updateInsertUrlButton() {
    const available = NtfyAPI.isHttpUrl(config.pageUrl);
    elements.insertUrlBtn.classList.toggle('unavailable', !available);
    elements.insertUrlBtn.setAttribute('aria-disabled', String(!available));
  }

  // Inserts the tab's URL at the cursor (replacing a selection), with a space on either side where
  // it would otherwise run into the text around it
  async function insertPageUrl() {
    const input = elements.messageInput;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    // Asked again: the popup may have opened before the browser let the extension see the tab
    if (!NtfyAPI.isHttpUrl(config.pageUrl)) {
      config.pageUrl = await getPageUrl().catch(() => '');
      updateInsertUrlButton();
    }
    const url = config.pageUrl;
    if (!NtfyAPI.isHttpUrl(url)) {
      showStatus(url
        ? 'Only the address of a web page (http or https) can be inserted'
        : 'The browser doesn\'t share this tab\'s address with the extension (e.g. on browser or add-on store pages)', 'warning');
      return;
    }

    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const text = (before && !/\s$/.test(before) ? ' ' : '') + url + (after && !/^\s/.test(after) ? ' ' : '');
    input.focus();
    input.setRangeText(text, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true })); // Resizes the field, saves the draft
  }

  async function getPageUrl() {
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
    elements.backBtn.addEventListener('click', leaveSettings);

    // Settings Auto-save: while typing, and right away when the field is left
    elements.urlInput.addEventListener('input', () => {
      updateMissingSettings();
      updateInsecureHint();
      debouncedSave();
    });
    elements.urlInput.addEventListener('change', debouncedSave.flush);

    [elements.tokenInput, elements.usernameInput, elements.passwordInput].forEach(input => {
      input.addEventListener('input', () => {
        updateInsecureHint();
        debouncedSave();
      });
      input.addEventListener('change', debouncedSave.flush);
    });

    window.addEventListener('pagehide', savePendingChanges);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        savePendingChanges();
      }
    });

    elements.receiveCheckbox.addEventListener('change', () => {
      dismissReceiveHint(); // Found the setting
      saveConfig();
    });

    elements.receiveHintDismiss.addEventListener('click', dismissReceiveHint);

    elements.serverAccessBtn.addEventListener('click', requestServerAccess);

    // Keep the composer text available if the popup closes before sending.
    elements.titleInput.addEventListener('input', () => {
      updateComposerToggleUI();
      scheduleDraftSave();
    });
    elements.messageInput.addEventListener('input', () => {
      autoSizeMessageInput();
      scheduleDraftSave();
    });
    // In the message bar Enter sends, like in the ntfy web app, and Shift+Enter starts a new line.
    // Below the title (options open) Enter starts a new line and Ctrl+Enter sends.
    elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const optionsOpen = elements.composer.classList.contains('options-open');
      if (optionsOpen ? e.ctrlKey : !e.shiftKey) {
        e.preventDefault();
        sendNotification();
      }
    });


    // Topics handling (badges)
    elements.newTopicInput.addEventListener('keydown', handleTopicKeydown);
    elements.newTopicInput.addEventListener('blur', addTopicFromInput);
    elements.newTopicInput.addEventListener('input', updateTopicInputHint);
    elements.topicsContainer.addEventListener('click', handleTopicRemove);

    // Theme chips
    elements.sizeChips.addEventListener('click', handleSizeChange);

    elements.themeChips.addEventListener('click', (e) => {
      handleThemeChange(e);
      saveConfig();
    });

    // Open ntfy URL
    elements.openUrlBtn.addEventListener('click', openNtfyUrl);

    // Send message
    elements.sendBtn.addEventListener('click', sendNotification);
    elements.insertUrlBtn.addEventListener('click', insertPageUrl);

    // Send another checkbox - save state on change
    elements.sendAnotherCheckbox.addEventListener('change', () => {
      config.sendAnotherEnabled = elements.sendAnotherCheckbox.checked;
      saveToStorage({ sendAnotherEnabled: config.sendAnotherEnabled });
    });

    // Format as Markdown: remembered like Send another
    elements.markdownCheckbox.addEventListener('change', () => {
      config.markdownEnabled = elements.markdownCheckbox.checked;
      saveToStorage({ markdownEnabled: config.markdownEnabled });
      updateComposerToggleUI();
    });

    // Send multiple attachments either individually or as one ZIP.
    elements.zipCheckbox.addEventListener('change', handleZipToggleChange);

    // File handling
    elements.fileBtn.addEventListener('click', handleFileButtonClick);
    elements.filePreview.addEventListener('click', handleAttachmentRemove);

    // Priority chips
    elements.priorityChips.addEventListener('click', handlePriorityClick);

    // Tags handling (badges)
    elements.newTagInput.addEventListener('keydown', handleTagKeydown);
    elements.newTagInput.addEventListener('input', updateTagInputHint);
    elements.tagsContainer.addEventListener('click', handleTagRemove);
    elements.emojiBtn.addEventListener('click', () => setEmojiPickerOpen(elements.emojiPicker.hidden));
    elements.emojiSearch.addEventListener('input', filterEmojis);
    elements.emojiList.addEventListener('click', handleEmojiPick);
    // Follows the field when the options scroll or the popup changes size
    elements.composerOptions.addEventListener('scroll', positionEmojiPicker);
    window.addEventListener('resize', positionEmojiPicker);

    // Further send options above the message bar
    elements.composerToggle.addEventListener('click', () => {
      if (!config.receiveEnabled) return; // Always open without receiving
      setComposerOptionsOpen(!elements.composer.classList.contains('options-open'));
    });


    // Bulk actions
    elements.markAllReadBtn.addEventListener('click', handleMarkAllRead);
    elements.deleteAllBtn.addEventListener('click', handleDeleteAll);

    // Listen for storage changes for live UI updates and external picker
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if (changes[STORED_FILES_KEY] || changes[LEGACY_STORED_FILE_KEY]) {
          loadStoredFiles();
        }
        if (changes.receivedNotifications || changes.readMessageIds || changes.deletedMessageIds) {
          scheduleNotificationsRefresh();
        }
        if (changes.serverAccessBlocked) {
          updateServerAccessUI(config.apiUrl);
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
      if (!elements.emojiPicker.hidden && !e.target.closest('#emoji-picker, #emoji-btn')) {
        setEmojiPickerOpen(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !elements.emojiPicker.hidden) {
        e.preventDefault(); // Keeps the popup open
        setEmojiPickerOpen(false);
        elements.emojiBtn.focus();
        return;
      }
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

  // Shows the main view or the settings with their header, and remembers which for the next open
  function setViewChrome(settings) {
    elements.mainView.classList.toggle('active', !settings);
    elements.settingsView.classList.toggle('active', settings);
    elements.backBtn.classList.toggle('visible', settings);
    elements.settingsBtn.style.display = settings ? 'none' : '';
    elements.openUrlBtn.style.display = settings ? 'none' : '';
    elements.headerText.textContent = settings ? 'Settings' : chrome.runtime.getManifest().name;
    isSettingsView = settings;
    try {
      localStorage.setItem(LAST_VIEW_KEY, settings ? 'settings' : 'main');
    } catch (e) {}
  }

  function showSettingsView() {
    // Populate settings fields with current config
    elements.urlInput.value = config.apiUrl;
    elements.tokenInput.value = config.accessToken;
    elements.usernameInput.value = config.username;
    elements.passwordInput.value = config.password;
    updateInsecureHint();
    renderTopics(); // Render badges
    updateServerAccessUI(config.apiUrl);

    updateThemeChipsUI();
    updateSizeChipsUI();

    setViewChrome(true);

    // During setup, start in the first setting still missing
    updateMissingSettings();
    if (!elements.urlInput.value.trim()) {
      elements.urlInput.focus();
    } else if (config.topics.length === 0) {
      elements.newTopicInput.focus();
    } else if (serverAccessMissing) {
      elements.serverAccessBtn.focus();
    }
  }

  // Credentials over http are readable by anyone on the way to the server
  function updateInsecureHint() {
    const hasCredentials = [elements.tokenInput, elements.usernameInput, elements.passwordInput]
      .some(input => input.value !== '');
    const url = NtfyAPI.normalizeServerUrl(elements.urlInput.value);
    elements.insecureHint.hidden = !(hasCredentials && /^http:\/\//i.test(url));
  }

  // Marks the settings needed to send and receive while they are empty, and the server while
  // its access token can't be used yet (same conditions as the settings button highlight)
  function updateMissingSettings() {
    elements.serverSection.classList.toggle('missing', !elements.urlInput.value.trim() || serverAccessMissing);
    elements.topicsSection.classList.toggle('missing', config.topics.length === 0);
  }

  // Saves right away what is still pending (typed topic, debounced URL or token), so the main
  // view shows the settings as entered
  async function leaveSettings() {
    if (!addTopicFromInput()) {
      elements.newTopicInput.focus();
      return;
    }
    debouncedSave.cancel();
    await saveConfig();
    showMainView();
  }

  function showMainView() {
    setViewChrome(false);

    // Refresh UI to reflect any changes made in settings
    updateUI();
    loadNotifications();
  }

  // ==================
  // UI Updates
  // ==================

  function updateUI() {
    const isConfigured = config.apiUrl && config.topics.length > 0;

    // Highlight the settings button until the extension is set up
    elements.settingsBtn.classList.toggle('highlight', !isConfigured || serverAccessMissing);

    // Enable/disable the open URL button based on configuration
    elements.openUrlBtn.disabled = !config.apiUrl;

    updatePriorityUI();
  }

  // The composer sends to the selected topic, so it is there only while one is.
  // Without receiving there are no messages to show, so its options are always open in their place.
  function updateComposer() {
    const topic = config.apiUrl && receiveFilter !== 'all' ? receiveFilter : null;
    elements.composer.hidden = !topic;
    elements.composerToggle.hidden = !config.receiveEnabled;
    elements.notificationsTitle.textContent = topic || 'All topics';
    const optionsOpen = elements.composer.classList.contains('options-open');
    if (!config.receiveEnabled) {
      if (!optionsOpen) {
        setComposerOptionsOpen(true);
      }
    } else if (!topic && optionsOpen) {
      setComposerOptionsOpen(false);
    }
    if (topic) {
      autoSizeMessageInput();
    }
  }

  // Open options take the message field below the title, closed ones give it back to the bar
  function setComposerOptionsOpen(open) {
    const input = elements.messageInput;
    const hadFocus = document.activeElement === input;
    if (open) {
      elements.messageSlot.appendChild(elements.composerField);
    } else {
      elements.composerToggle.after(elements.composerField);
    }
    input.rows = open ? 3 : 1;
    if (hadFocus) {
      input.focus();
    }

    elements.composer.classList.toggle('options-open', open);
    elements.composerToggle.setAttribute('aria-expanded', String(open));
    elements.composerToggle.title = open ? 'Fewer options' : 'More options';
    autoSizeMessageInput();
  }

  // A dot on the arrow button while the closed options hold a title, files, or Markdown formatting
  function updateComposerToggleUI() {
    const hasExtras = attachments.length > 0 || elements.titleInput.value.trim() !== ''
      || elements.markdownCheckbox.checked;
    elements.composerToggle.classList.toggle('has-extras', hasExtras);
  }

  // The message field grows with its text, up to a few lines (more below the title)
  function autoSizeMessageInput() {
    const input = elements.messageInput;
    input.style.height = 'auto';
    if (!input.scrollHeight) {
      return; // Hidden: sized when the composer shows
    }
    const border = input.offsetHeight - input.clientHeight;
    const maxHeight = elements.composer.classList.contains('options-open') ? 200 : 120;
    input.style.height = `${Math.min(input.scrollHeight + border, maxHeight)}px`;
  }

  function updatePriorityUI() {
    document.querySelectorAll('#priority-chips .chip').forEach(chip => {
      const priority = parseInt(chip.dataset.priority, 10);
      chip.classList.toggle('active', priority === selectedPriority);
    });
  }



  function showStatus(message, type) {
    showStatusIn(elements.status, message, type);
  }

  function showSettingsStatus(message, type) {
    showStatusIn(elements.settingsStatus, message, type);
  }

  // Each message shows for 3 s; a new one restarts the time, so an older timer can't hide it early
  const statusTimers = new Map();
  function showStatusIn(element, message, type) {
    element.textContent = message;
    element.className = `status visible ${type}`;

    clearTimeout(statusTimers.get(element));
    statusTimers.set(element, setTimeout(() => {
      element.classList.remove('visible');
    }, 3000));
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
    positionEmojiPicker(); // The field may have got another line
  }

  function handleTagKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = elements.newTagInput.value.trim();

      if (value) {
        addTag(value);
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

  function addTag(value) {
    if (!tags.includes(value)) {
      tags.push(value);
      renderTags();
      saveToStorage({ lastTags: [...tags] });
    }
  }

  // Emoji picker: built on first use; stays open for picking several, like ntfy's
  function setEmojiPickerOpen(open) {
    if (open && !elements.emojiList.hasChildNodes()) {
      buildEmojiList();
    }
    elements.emojiPicker.hidden = !open;
    elements.emojiBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      positionEmojiPicker();
      elements.emojiSearch.focus();
    }
  }

  // Above the tags field, its right edge at the field's. Fixed, so the scrolling options don't
  // cut it off. Lengths set on it are zoomed with the page, measured ones are not: divide by the zoom.
  function positionEmojiPicker() {
    if (elements.emojiPicker.hidden) return;
    const picker = elements.emojiPicker;
    const field = elements.tagsContainer.getBoundingClientRect();
    const zoom = field.height / elements.tagsContainer.offsetHeight || 1;
    const margin = 8;
    const viewportWidth = window.innerWidth / zoom;

    // Gets smaller if there isn't enough room above the field
    picker.style.maxHeight = `${Math.max(field.top / zoom - 4 - margin, 120)}px`;
    picker.style.maxWidth = `${viewportWidth - 2 * margin}px`;
    const left = Math.min(field.right / zoom, viewportWidth - margin) - picker.offsetWidth;
    picker.style.left = `${Math.max(left, margin)}px`;
    picker.style.top = `${Math.max(field.top / zoom - 4 - picker.offsetHeight, margin)}px`;
  }

  function buildEmojiList() {
    Emojis.pickerCategories().forEach(category => {
      const heading = document.createElement('div');
      heading.className = 'emoji-category';
      heading.textContent = category.name;
      elements.emojiList.appendChild(heading);

      category.emojis.forEach(emoji => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'emoji-option';
        option.textContent = emoji.emoji;
        option.title = emoji.title;
        option.setAttribute('aria-label', emoji.title);
        option.dataset.tag = emoji.tag;
        option.emoji = emoji; // For the search
        elements.emojiList.appendChild(option);
      });
    });
  }

  // Like ntfy: any of the words may match, and the category names hide while searching
  function filterEmojis() {
    const words = elements.emojiSearch.value.toLowerCase().split(' ').filter(Boolean);
    elements.emojiList.classList.toggle('searching', words.length > 0);
    elements.emojiList.querySelectorAll('.emoji-option').forEach(option => {
      option.hidden = !Emojis.matches(option.emoji, words);
    });
  }

  function handleEmojiPick(e) {
    const option = e.target.closest('.emoji-option');
    if (option) {
      addTag(option.dataset.tag);
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
    elements.newTopicInput.placeholder = config.topics.length ? '' : 'Type a topic name, e.g. alerts';
    updateMissingSettings();
  }

  // Adds the typed topic, if any. Also on leaving the field, so a topic typed without Enter isn't lost.
  // Returns false if the typed name isn't a valid ntfy topic (it stays in the field to be corrected).
  function addTopicFromInput() {
    const value = elements.newTopicInput.value.trim();
    if (!value) return true;

    if (!NtfyAPI.TOPIC_PATTERN.test(value)) {
      showSettingsStatus('Topic names can only use letters, digits, - and _ (up to 64 characters)', 'error');
      return false;
    }

    // Add topic if not exists
    if (!config.topics.includes(value)) {
      config.topics.push(value);
      renderTopics();
      saveConfig();
    }
    elements.newTopicInput.value = '';
    updateTopicInputHint(); // Hide hint after clearing
    return true;
  }

  function handleTopicKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTopicFromInput();
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
    if (!config.apiUrl) return;

    let url;
    try {
      url = new URL(config.apiUrl);
    } catch (e) {
      showStatus('The server URL in the settings is not valid', 'error');
      return;
    }
    // Credentials in the server URL are for the extension's requests, not for the tab's address bar and history
    url.username = '';
    url.password = '';
    const topic = receiveFilter;
    // Only append topic if it is a valid topic (present in the list of configured topics)
    if (topic && config.topics.includes(topic)) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;
    }

    chrome.tabs.create({ url: url.href });
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
    // Set before the first await, so a second trigger meanwhile (a key repeat, a double click) can't send again
    isSending = true;
    try {
      await sendComposedMessage();
    } finally {
      isSending = false;
      elements.sendBtn.disabled = false;
      renderAttachments();
    }
  }

  async function sendComposedMessage() {
    const topic = receiveFilter;
    const message = elements.messageInput.value.trim();
    const title = elements.titleInput.value.trim();
    const tagsString = tags.join(','); // Use tags array
    const markdown = elements.markdownCheckbox.checked;

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

    if (!config.topics.includes(topic)) {
      showStatus('Select a topic', 'warning');
      return;
    }

    elements.sendBtn.disabled = true;
    renderAttachments();

    try {
      const apiConfig = {
        apiUrl: config.apiUrl,
        accessToken: config.accessToken,
        username: config.username,
        password: config.password
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
            tags: tagsString,
            markdown
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
              tags: tagsString,
              markdown
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
        await NtfyAPI.sendNotification(apiConfig, topic, {
          message: message,
          title: title,
          priority: selectedPriority,
          tags: tagsString,
          markdown
        });

        await finishSuccessfulSend(0);
      }
    } catch (error) {
      await updateServerAccessUI(config.apiUrl);
      showStatus(serverAccessMissing
        ? 'Error: The server blocked the request. Allow access to it in the settings.'
        : `Error: ${error.message}`, 'error');
    }
  }

  async function finishSuccessfulSend(attachmentCount, successMessage) {
    cancelScheduledDraftSave();
    elements.messageInput.value = '';
    autoSizeMessageInput();
    elements.titleInput.value = '';
    updateComposerToggleUI();

    if (attachmentCount > 0) {
      await clearStoredFiles();
    }

    // Clear any saved draft state so it doesn't overwrite preferences next time.
    await removeLocalStorage(['draftState']);
    updatePriorityUI();

    // Close the popup unless "Send another" is checked (the extension's tab stays open).
    if (!elements.sendAnotherCheckbox.checked) {
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
      moveTitleToTooltip(target);

      if (!target.getAttribute('data-tooltip')) return;

      activeElement = target;

      // Delay showing the tooltip
      tooltipTimeout = setTimeout(() => {
        // Double-check we are still active on this element; the text as it is now
        if (activeElement === target) {
          showTooltip(target, target.getAttribute('data-tooltip'));
        }
      }, 1000); // 1000ms delay
    });

    function moveTitleToTooltip(element) {
      if (element.hasAttribute('title')) {
        element.setAttribute('data-tooltip', element.getAttribute('title'));
        element.removeAttribute('title');
      }
    }

    // A title set while the element is hovered (e.g. "Click again to delete") would bring up the
    // native tooltip next to this one, which would keep the old text: move it over, and update
    // the tooltip if it is showing
    new MutationObserver(mutations => {
      mutations.forEach(({ target }) => {
        if (!target.hasAttribute('title')) return;
        moveTitleToTooltip(target);
        if (target === activeElement && tooltip.classList.contains('visible')) {
          showTooltip(target, target.getAttribute('data-tooltip'));
        }
      });
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] });

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

    // defaultPrevented: the message field already handled this Enter (and sent)
    if (e.key === 'Enter' && rightCtrlDown && !e.defaultPrevented) {
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

  // Lists the received messages of the selected topic, or of all topics
  async function loadNotifications() {
    if (receiveFilter !== 'all' && !config.topics.includes(receiveFilter)) {
      receiveFilter = 'all';
    }
    // Without receiving, All topics isn't offered: there is nothing to list, and nothing to send to
    if (!config.receiveEnabled && receiveFilter === 'all' && config.topics.length > 0) {
      receiveFilter = config.topics[0];
    }
    updateComposer();
    updateReceiveHint();

    if (!config.apiUrl || config.topics.length === 0) {
      renderSetupHint();
      return;
    }
    elements.notificationsSection.classList.remove('setup');

    if (!config.receiveEnabled) {
      currentNotifications = [];
      renderTopicSidebar([]);
      return;
    }

    try {
      const localData = await getFromStorageLocal(['receivedNotifications', THUMBNAIL_CACHE_KEY]);
      // Messages of removed topics leave the history too (background), but may still be there
      const allNotifications = (localData.receivedNotifications || [])
        .filter(notification => config.topics.includes(notification.topic)
          && !deletedMessageIds.includes(notification.id));
      thumbnailCache = localData[THUMBNAIL_CACHE_KEY] || {};
      pruneThumbnails(allNotifications);

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
        title.textContent = notification.title ? Emojis.formatTitle(notification) : 'Notification';
        header.appendChild(title);

        const time = document.createElement('span');
        time.className = 'notification-time';
        time.textContent = `${notification.topic} · ${formatTime(notification.time)}`;
        header.appendChild(time);

        item.appendChild(header);

        const message = document.createElement('div');
        message.className = 'notification-message';
        const text = Emojis.formatMessage(notification);
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

        // Tags that are emojis already show in front of the title or message, like in the ntfy web app
        const otherTags = Emojis.unmatchedTags(notification.tags);
        if (otherTags.length > 0) {
          const tagsLine = document.createElement('div');
          tagsLine.className = 'notification-tags';
          tagsLine.textContent = `Tags: ${otherTags.join(', ')}`;
          footer.appendChild(tagsLine);
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

        if (notification.message) {
          const copyBtn = document.createElement('button');
          copyBtn.className = 'notification-action-btn copy-btn';
          copyBtn.appendChild(createIcon(COPY_ICON_PATH));
          copyBtn.title = 'Copy text';
          copyBtn.addEventListener('click', () => handleCopy(notification.message, copyBtn));
          actions.appendChild(copyBtn);
        }

        if (notification.attachment && NtfyAPI.isHttpUrl(notification.attachment.url)) {
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'notification-action-btn download-btn';
          downloadBtn.appendChild(createIcon(DOWNLOAD_ICON_PATH));
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

  // Points to the Receive messages setting, once the extension is set up, until dismissed
  function updateReceiveHint() {
    // From the first start on, so the choice is known while setting up
    const show = !receiveHintDismissed;
    elements.receiveHint.hidden = !show;
    if (show) {
      elements.receiveHintMessage.textContent = config.receiveEnabled
        ? 'Only want to send? Turn off Receive messages in the settings.'
        : 'The extension only sends for now. To see your topics\' messages here and get desktop notifications, turn on Receive messages in the settings.';
    }
  }

  function dismissReceiveHint() {
    if (receiveHintDismissed) return;
    receiveHintDismissed = true;
    elements.receiveHint.hidden = true;
    saveToStorageLocal({ receiveHintDismissed: true }).catch(() => {});
  }

  // First start: nothing to list until a server and at least one topic are set
  function renderSetupHint() {
    elements.topicSidebar.replaceChildren();
    elements.topicSidebar.style.display = 'none';
    elements.notificationsSection.classList.add('setup');

    const hint = document.createElement('div');
    hint.className = 'notifications-empty setup-hint';

    const title = document.createElement('div');
    title.className = 'setup-hint-title';
    title.textContent = config.apiUrl ? 'No topic configured' : 'No server configured';

    const text = document.createElement('div');
    text.textContent = config.apiUrl
      ? 'Add a topic in the settings to get started.'
      : `Enter your ntfy server${config.topics.length ? '' : ' and a topic'} in the settings to get started.`;

    hint.append(title, text);
    elements.notificationsList.replaceChildren(hint);
  }

  // Topic list: All topics (when receiving), then each configured topic, with unread counts
  function renderTopicSidebar(notifications) {
    const unreadCount = topic => notifications
      .filter(notification => topic === 'all' || notification.topic === topic)
      .filter(notification => !readMessageIds.includes(notification.id))
      .length;

    const entries = config.receiveEnabled ? ['all', ...config.topics] : config.topics;
    elements.topicSidebar.style.display = '';
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
        // Another topic's list starts at the top, not at the previous list's scroll position
        loadNotifications().then(() => { elements.notificationsList.scrollTop = 0; });
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

  // Only files uploaded to the ntfy server get a preview: the server reports their size (and type and
  // expiry). An attachment can also be a link to a file anywhere (X-Attach), which has none of those;
  // loading it by itself would let anyone who can publish to the topic make the popup request any
  // host, like an image in Markdown would (not loaded either), and of any size.
  function isImageAttachment(attachment) {
    if (!attachment || !NtfyAPI.isHttpUrl(attachment.url) || typeof attachment.size !== 'number') {
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
    if (attachment.size > THUMBNAIL_MAX_SOURCE_BYTES) {
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
      const result = await getFromStorageLocal(['readMessageIds', 'deletedMessageIds', 'receiveTopicFilter', 'receiveHintDismissed']);
      readMessageIds = result.readMessageIds || [];
      deletedMessageIds = result.deletedMessageIds || [];
      receiveFilter = result.receiveTopicFilter || 'all';
      receiveHintDismissed = result.receiveHintDismissed === true;
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
        ids => NtfyAPI.appendIds(ids, [messageId]));
    } catch (error) {
      console.error('Error saving readMessageIds:', error);
      showStatus('Failed to mark as read', 'error');
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
        ids => NtfyAPI.appendIds(ids, [messageId]));
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => ids.filter(id => id !== messageId));
    } catch (error) {
      console.error('Error deleting notification locally:', error);
      showStatus('Failed to delete notification', 'error');
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
        showStatus('Server is busy, retrying the download…', 'warning');
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_RETRY_DELAYS[attempt]));
      }
      if (!response.ok) {
        showStatus(downloadErrorMessage(response.status), 'error');
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
      showStatus('Download failed', 'error');
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

  const DOWNLOAD_ICON_PATH = 'M5 20h14v-2H5v2zm14-11h-4V3H9v6H5l7 7 7-7z';
  const COPY_ICON_PATH = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';

  function createIcon(pathData) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
    return svg;
  }

  // Copies the message as sent (Markdown source for Markdown messages); "Copied" confirms it
  async function handleCopy(text, btnElement) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Copy failed:', error);
      showStatus('Copy failed', 'error');
      return;
    }
    btnElement.classList.add('copied');
    btnElement.textContent = 'Copied';
    setTimeout(() => {
      btnElement.classList.remove('copied');
      btnElement.replaceChildren(createIcon(COPY_ICON_PATH));
    }, 1500);
  }

  async function handleMarkAllRead() {
    if (currentNotifications.length === 0) return;

    const visibleIds = currentNotifications.map(notification => notification.id);
    try {
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => NtfyAPI.appendIds(ids, visibleIds));
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
        ids => NtfyAPI.appendIds(ids, visibleIds));
      readMessageIds = await updateStoredIds('readMessageIds',
        ids => ids.filter(id => !visibleIds.includes(id)));
      showStatus('All notifications deleted', 'success');
    } catch (error) {
      console.error('Error performing bulk delete:', error);
      showStatus('Failed to delete all', 'error');
    }
  }

});
