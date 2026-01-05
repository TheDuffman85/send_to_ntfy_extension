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

    // Main form
    topicSelect: document.getElementById('topic-select'),
    topicDropdown: document.getElementById('topic-dropdown'),
    topicDropdownSelected: document.getElementById('topic-dropdown-selected'),
    topicDropdownText: document.getElementById('topic-dropdown-text'),
    topicDropdownOptions: document.getElementById('topic-dropdown-options'),
    titleInput: document.getElementById('title-input'),
    messageInput: document.getElementById('message-input'),
    tagsContainer: document.getElementById('tags-container'),
    newTagInput: document.getElementById('new-tag-input'),


    // File handling
    fileInput: document.getElementById('file-input'),
    fileBtn: document.getElementById('file-btn'),
    filePreview: document.getElementById('file-preview'),
    fileName: document.getElementById('file-name'),
    fileSize: document.getElementById('file-size'),
    fileRemove: document.getElementById('file-remove'),

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

    // Content sections
    mainContent: document.getElementById('main-content'),

    // Settings inputs
    urlInput: document.getElementById('url-input'),
    tokenInput: document.getElementById('token-input'),
    topicsContainer: document.getElementById('topics-container'),
    newTopicInput: document.getElementById('new-topic-input'),

    insertUrlBtn: document.getElementById('insert-url-btn'),
  };

  // State
  let config = {
    topics: [],
    apiUrl: '',
    accessToken: '',

    theme: 'auto',
    pageUrl: ''
  };

  let tags = []; // State for tags

  // Drag and drop state
  let dragSrcIndex = null;
  let dragType = null;

  let selectedPriority = 3;
  let isSettingsView = false;

  const STORAGE_KEYS = ['topics', 'apiUrl', 'accessToken', 'theme', 'priority', 'lastTags', 'lastTopic', 'sendAnotherEnabled'];

  // Initialize
  init();

  async function init() {
    await loadConfig();
    await restoreDraftState();
    await checkSessionAndCleanup(); // Check session and cleanup old files if needed
    await loadStoredFile();
    setupEventListeners();
    updateUI();
    // Ensure priority UI is updated after config load
    updatePriorityUI();
    applyTheme();
    // Render initial empty tags or restored ones
    renderTags();
  }

  // ==================
  // Configuration
  // ==================

  async function loadConfig() {
    try {
      const items = await getFromStorage(STORAGE_KEYS);
      config.pageUrl = await getPageUrl();
      config = {
        ...config,
        topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : [],
        apiUrl: items.apiUrl || '',
        accessToken: items.accessToken || '',

        theme: items.theme || 'auto',
        sendAnotherEnabled: items.sendAnotherEnabled === true
      };

      // Restore 'Send another' checkbox state
      elements.sendAnotherCheckbox.checked = config.sendAnotherEnabled;

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

      theme: config.theme
    };

    try {
      await saveToStorage(newConfig);
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

  async function loadStoredFile() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['storedFile'], resolve);
      });

      if (result.storedFile) {
        elements.fileName.textContent = result.storedFile.name;
        elements.fileSize.textContent = formatFileSize(result.storedFile.size);
        elements.filePreview.classList.add('visible');
        elements.fileBtn.style.display = 'none';
      }
    } catch (error) {
      console.error('Error loading stored file:', error);
    }
  }

  async function checkSessionAndCleanup() {
    // Hybrid storage approach:
    // Files are stored in 'local' (large quota).
    // Session state is tracked in 'session'.
    // If 'sessionActive' is missing from 'session' storage, it means the browser restarted.
    // In that case, we clear the file from 'local' storage.

    try {
      const session = await new Promise(resolve => chrome.storage.session.get(['sessionActive'], resolve));

      if (!session.sessionActive) {
        console.log('New session detected, cleaning up stored file');
        await new Promise(resolve => chrome.storage.local.remove(['storedFile'], resolve));
        await new Promise(resolve => chrome.storage.session.set({ sessionActive: true }, resolve));
      }
    } catch (error) {
      console.error('Error checking session state:', error);
    }
  }

  async function handleFileButtonClick() {
    // Save state first because popup will close
    await saveDraftState();

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
    const file = e.target.files[0];
    if (file) {
      readAndStoreFile(file);
    }
  }

  async function readAndStoreFile(file) {
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target.result;

        await new Promise((resolve, reject) => {
          chrome.storage.local.set({
            storedFile: {
              name: file.name,
              type: file.type,
              size: file.size,
              data: base64Data
            }
          }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        });

        elements.fileName.textContent = file.name;
        elements.fileSize.textContent = formatFileSize(file.size);
        elements.filePreview.classList.add('visible');
        elements.fileBtn.style.display = 'none';
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error storing file:', error);
      showStatus('Failed to attach file', 'error');
    }
  }

  async function removeFile() {
    await new Promise((resolve) => {
      chrome.storage.local.remove(['storedFile'], resolve);
    });

    elements.fileInput.value = '';
    elements.filePreview.classList.remove('visible');
    elements.fileBtn.style.display = '';
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
      topic: elements.topicSelect.value,
      tags: tags, // Save tags array
      priority: selectedPriority
    };
    await new Promise(resolve => chrome.storage.local.set({ draftState: draft }, resolve));
  }

  async function restoreDraftState() {
    return new Promise(resolve => {
      chrome.storage.local.get(['draftState'], (result) => {
        if (result.draftState) {
          const draft = result.draftState;
          if (draft.title) elements.titleInput.value = draft.title;
          if (draft.message) elements.messageInput.value = draft.message;
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

          // Clear draft state after restoration to prevent stale state from overwriting future sessions
          chrome.storage.local.remove(['draftState']);
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


    // Topics handling (badges)
    elements.newTopicInput.addEventListener('keydown', handleTopicKeydown);
    elements.topicsContainer.addEventListener('click', handleTopicRemove);

    // Insert URL button
    elements.insertUrlBtn.addEventListener('click', insertCurrentUrl);

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

    // File handling
    elements.fileBtn.addEventListener('click', handleFileButtonClick);
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.fileRemove.addEventListener('click', removeFile);

    // Priority chips
    elements.priorityChips.addEventListener('click', handlePriorityClick);

    // Tags handling (badges)
    elements.newTagInput.addEventListener('keydown', handleTagKeydown);
    elements.tagsContainer.addEventListener('click', handleTagRemove);

    // Advanced options toggle
    elements.advancedToggle.addEventListener('click', toggleAdvancedOptions);

    // Custom topic dropdown
    elements.topicDropdownSelected.addEventListener('click', toggleTopicDropdown);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!elements.topicDropdown.contains(e.target)) {
        closeTopicDropdown();
      }
    });

    // Listen for file selection from external picker
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.storedFile) {
        loadStoredFile();
      }
    });

    setupTooltips();
  }

  // ==================
  // View Switching
  // ==================

  function showSettingsView() {
    // Populate settings fields with current config
    elements.urlInput.value = config.apiUrl;
    elements.tokenInput.value = config.accessToken;
    renderTopics(); // Render badges

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
    elements.headerText.textContent = 'Send to ntfy';
    isSettingsView = false;

    // Refresh UI to reflect any changes made in settings
    updateUI();
  }

  // ==================
  // UI Updates
  // ==================

  function updateUI() {
    const isConfigured = config.apiUrl && config.topics.length > 0;

    // Toggle disabled state on form and highlight on settings button
    elements.mainContent.classList.toggle('disabled', !isConfigured);
    elements.settingsBtn.classList.toggle('highlight', !isConfigured);

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

  function insertCurrentUrl() {
    if (config.pageUrl) {
      // Insert at cursor position or append
      const textarea = elements.messageInput;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;

      if (text) {
        // Insert at cursor position
        textarea.value = text.substring(0, start) + config.pageUrl + text.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + config.pageUrl.length;
      } else {
        // Empty field, just set the value
        textarea.value = config.pageUrl;
      }
      textarea.focus();
    }
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
    elements.advancedToggle.classList.toggle('open');
    elements.advancedOptions.classList.toggle('visible');
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

  async function sendNotification() {
    const topic = elements.topicSelect.value;
    const message = elements.messageInput.value.trim();
    const title = elements.titleInput.value.trim();
    const tagsString = tags.join(','); // Use tags array

    const storedFile = await new Promise((resolve) => {
      chrome.storage.local.get(['storedFile'], items => {
        resolve(items.storedFile || null);
      });
    });

    if (!config.apiUrl) {
      showStatus('Configure ntfy URL in settings', 'warning');
      return;
    }

    if (!topic) {
      showStatus('Select a topic', 'warning');
      return;
    }

    elements.sendBtn.disabled = true;

    try {
      const urlObj = new URL(config.apiUrl);
      const fullUrl = `${urlObj.origin}/${topic}`;

      const headers = new Headers();

      if (urlObj.username && urlObj.password) {
        headers.set('Authorization', `Basic ${btoa(`${urlObj.username}:${urlObj.password}`)}`);
      }
      if (config.accessToken) {
        headers.set('Authorization', `Bearer ${config.accessToken}`);
      }

      if (title) {
        headers.set('X-Title', title);
      }

      if (selectedPriority !== 3) {
        headers.set('X-Priority', selectedPriority.toString());
      }

      if (tagsString) {
        headers.set('X-Tags', tagsString);
      }

      let body;

      if (storedFile) {
        headers.set('X-Filename', storedFile.name);
        if (message) {
          headers.set('X-Message', message);
        }

        const base64 = storedFile.data.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        body = bytes.buffer;
      } else {
        body = message;
      }

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body
      });

      if (response.ok) {
        elements.messageInput.value = '';
        elements.titleInput.value = '';
        // tags = []; // Keep last used tags
        // renderTags();


        await removeFile();
        // Clear any saved draft state so it doesn't overwrite preferences next time
        await new Promise(resolve => chrome.storage.local.remove(['draftState'], resolve));

        // selectedPriority = 3; // Keep last used priority
        updatePriorityUI();

        // Close the popup unless "Send another" is checked
        if (!elements.sendAnotherCheckbox.checked) {
          setTimeout(() => window.close(), 100);
        } else {
          // Only show success message if staying open
          showStatus('Notification sent!', 'success');
        }
      } else {
        const errorText = await response.text();
        showStatus(`Failed: ${response.status} ${errorText.slice(0, 50)}`, 'error');
      }
    } catch (error) {
      showStatus(`Error: ${error.message}`, 'error');
    } finally {
      elements.sendBtn.disabled = false;
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

});
