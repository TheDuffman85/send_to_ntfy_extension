// Background service worker for context menu integration
// Compatible with Chrome, Edge, and Firefox 142+

// Import shared utilities (only in Service Worker context)
if (typeof importScripts === 'function') {
    importScripts('ntfy.js');
}

// WebSocket & Background Sync State
let ws = null;
let wsUrl = null; // URL the current socket was opened with, to detect configuration changes
let reconnectTimer = null;
let keepaliveTimer = null;
let reconnectDelay = 5000;
const MAX_RECONNECT_DELAY = 60000;
// Chrome stops an idle extension service worker after 30 s. Since Chrome 116, WebSocket traffic resets
// that timer, but ntfy only sends a keepalive every 45 s by default, so send a small frame of our own.
// ntfy reads and discards client frames of up to 64 bytes.
const WS_KEEPALIVE_INTERVAL = 20000;
const MAX_HISTORY_ITEMS = 50;
const MAX_SEEN_IDS_PER_TOPIC = 200;
// Window fetched silently the first time a topic is synced
const INITIAL_SYNC_SINCE = '24h';


const PARENT_MENU_ID = 'ntfy-parent';
const SEND_SELECTION_ID = 'ntfy-send-selection';
const SEND_IMAGE_ID = 'ntfy-send-image';
const SEND_LINK_ID = 'ntfy-send-link'; // Replaced SEND_PAGE_ID
const SEND_TAB_ID = 'ntfy-send-tab';

// Initialize context menu, WebSocket, and alarms on install and startup
chrome.runtime.onInstalled.addListener(() => {
    // Replaced by the per-topic topicSyncState
    chrome.storage.local.remove('lastNotificationId');
    updateContextMenu();
    initWebSocket();
    setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    updateContextMenu();
    initWebSocket();
    setupAlarm();
});

// Listen for storage changes to update context menu, WebSocket config, and unread badge
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        if (changes.topics || changes.apiUrl || changes.accessToken) {
            updateContextMenu();
            initWebSocket();
        }
    }
    if (area === 'local') {
        if (changes.accessToken) {
            initWebSocket();
        }
        if (changes.receivedNotifications || changes.readMessageIds || changes.deletedMessageIds) {
            updateUnreadBadge();
        }
    }
});

// Build or rebuild the context menu based on current topics
async function updateContextMenu() {
    // Remove all existing menus first
    await chrome.contextMenus.removeAll();

    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        // No valid configuration, don't create menu
        return;
    }

    // Create a single parent menu dynamically from manifest name
    const manifest = chrome.runtime.getManifest();
    chrome.contextMenus.create({
        id: PARENT_MENU_ID,
        title: manifest.name,
        contexts: ['all']
    });

    if (topics.length === 1) {
        // Single topic: Text/Image/Link are direct clickable items under the parent
        const topic = topics[0];

        // 1. Page (Tab) - Always visible
        chrome.contextMenus.create({
            id: SEND_TAB_ID,
            parentId: PARENT_MENU_ID,
            title: `Page (${topic})`,
            contexts: ['all']
        });

        // 2. Text - Selection only
        chrome.contextMenus.create({
            id: SEND_SELECTION_ID,
            parentId: PARENT_MENU_ID,
            title: `Text (${topic})`,
            contexts: ['selection']
        });

        // 3. Image - Image only
        chrome.contextMenus.create({
            id: SEND_IMAGE_ID,
            parentId: PARENT_MENU_ID,
            title: `Image (${topic})`,
            contexts: ['image']
        });

        // 4. Link - Link only
        chrome.contextMenus.create({
            id: SEND_LINK_ID,
            parentId: PARENT_MENU_ID,
            title: `Link (${topic})`,
            contexts: ['link']
        });
    } else {
        // Multiple topics: Text/Image/Link are submenus containing topics

        // 1. Page (Tab) Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-tab`,
            parentId: PARENT_MENU_ID,
            title: 'Page',
            contexts: ['all']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_TAB_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-tab`,
                title: topic,
                contexts: ['all']
            });
        });

        // 2. Text Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-selection`,
            parentId: PARENT_MENU_ID,
            title: 'Text',
            contexts: ['selection']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_SELECTION_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-selection`,
                title: topic,
                contexts: ['selection']
            });
        });

        // 3. Image Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-image`,
            parentId: PARENT_MENU_ID,
            title: 'Image',
            contexts: ['image']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_IMAGE_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-image`,
                title: topic,
                contexts: ['image']
            });
        });

        // 4. Link Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-link`,
            parentId: PARENT_MENU_ID,
            title: 'Link',
            contexts: ['link']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_LINK_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-link`,
                title: topic,
                contexts: ['link']
            });
        });
    }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let menuId = info.menuItemId;

    // Check if we need to request permission for an image
    if ((menuId === SEND_IMAGE_ID || menuId.startsWith(SEND_IMAGE_ID + '-')) && info.srcUrl) {
        if (info.srcUrl.startsWith('http')) {
            const imgUrlObj = new URL(info.srcUrl);
            const origin = imgUrlObj.origin + '/*';

            try {
                // Request permission immediately while we have the user gesture
                // We don't check permissions.contains first because that is async and will kill the user gesture
                const granted = await new Promise(resolve => {
                    chrome.permissions.request({ origins: [origin] }, resolve);
                });

                if (!granted) {
                    console.error('Permission denied to access image origin');
                    return;
                }
            } catch (e) {
                console.error('Failed to request permission:', e);
                // Continue anyway, it might fail later in fetch but we tried
            }
        }
    }

    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        console.error('ntfy not configured');
        return;
    }

    let topic;

    // Determine which topic was selected
    if (topics.length === 1) {
        topic = topics[0];
    } else {
        // Extract topic index from menu ID
        const match = menuId.match(/-(\d+)$/);
        if (match) {
            const index = parseInt(match[1], 10);
            topic = topics[index];
        }
    }

    if (!topic) {
        console.error('Could not determine topic');
        return;
    }

    try {
        if (menuId === SEND_SELECTION_ID || menuId.startsWith(SEND_SELECTION_ID)) {
            // Send selected text
            let message = info.selectionText;
            if (config.includeUrl && tab && tab.url) {
                const formattedUrl = tab.url.replace(/\/$/, '');
                message = `${message}\n\nSent from: ${formattedUrl}`;
            }
            await NtfyAPI.sendNotification(config, topic, {
                message: message
            });
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_IMAGE_ID || menuId.startsWith(SEND_IMAGE_ID)) {
            // Send image
            let message = '';
            if (config.includeUrl && tab && tab.url) {
                const formattedUrl = tab.url.replace(/\/$/, '');
                message = `Sent from: ${formattedUrl}`;
            }
            await NtfyAPI.sendImageFromUrl(config, topic, info.srcUrl, message);
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_LINK_ID || menuId.startsWith(SEND_LINK_ID)) {
            // Send link URL
            const urlToSend = info.linkUrl;
            let titleToSend = '';

            // Try to get link text from the page
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (targetUrl) => {
                        // Find the link element that matches the URL
                        // We use .href because it returns the absolute URL, matching targetUrl
                        const links = document.querySelectorAll('a');
                        for (const link of links) {
                            if (link.href === targetUrl) {
                                return link.innerText || link.textContent || '';
                            }
                        }
                        return '';
                    },
                    args: [info.linkUrl]
                });

                if (results && results[0] && results[0].result) {
                    titleToSend = results[0].result.trim();
                }
            } catch (e) {
                console.error('Failed to retrieve link text:', e);
            }

            let message = urlToSend;
            if (config.includeUrl && tab && tab.url) {
                const formattedUrl = tab.url.replace(/\/$/, '');
                message = `${message}\n\nSent from: ${formattedUrl}`;
            }

            await NtfyAPI.sendNotification(config, topic, {
                message: message,
                title: titleToSend
            });
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_TAB_ID || menuId.startsWith(SEND_TAB_ID)) {
            // Send current page (tab) URL
            await NtfyAPI.sendNotification(config, topic, {
                message: tab.url,
                title: tab.title
            });
            showBadge('✓', '#4CAF50');
        }
    } catch (error) {
        console.error('Failed to send notification:', error);
        showBadge('✗', '#f44336');
    }
});

// Show a temporary badge on the extension icon
// Show a temporary badge on the extension icon (restores unread count after 2s)
function showBadge(text, color) {
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: color });

    setTimeout(() => {
        updateUnreadBadge();
    }, 2000);
}

// ========================================
// WebSocket & Background Sync Logic
// ========================================

async function initWebSocket() {
    const config = await NtfyAPI.getConfig();
    if (!config.apiUrl || config.topics.length === 0) {
        console.log('ntfy is not configured, skipping WebSocket connection.');
        closeWebSocket();
        return;
    }

    if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            let expectedUrl = null;
            try {
                expectedUrl = buildWsUrl(config).url;
            } catch (e) {}
            if (wsUrl === expectedUrl) {
                return;
            }
            console.log('Configuration changed, reconnecting WebSocket...');
        }
    }

    connectWebSocket(config);
}

function startKeepalive(socket) {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send('keepalive');
        }
    }, WS_KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
    if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
    }
}

function closeWebSocket() {
    stopKeepalive();
    if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
        wsUrl = null;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// Returns { url, logUrl }: url may carry the credentials in ?auth=, logUrl never does
function buildWsUrl(config) {
    let apiUrl = config.apiUrl;
    if (!/^https?:\/\//i.test(apiUrl)) {
        apiUrl = 'https://' + apiUrl;
    }

    // Host only, like the HTTP calls: credentials embedded in the URL must not end up in the WebSocket URL
    const urlObj = new URL(apiUrl);
    const scheme = urlObj.protocol === 'http:' ? 'ws:' : 'wss:';
    const logUrl = `${scheme}//${urlObj.host}/${config.topics.join(',')}/ws`;

    // Browsers can't set headers on a WebSocket, so ntfy accepts the Authorization header value in ?auth=
    const auth = NtfyAPI.buildAuthHeaderValue(config.accessToken, config.apiUrl);
    const url = auth ? `${logUrl}?auth=${NtfyAPI.base64UrlEncode(auth)}` : logUrl;

    return { url, logUrl };
}

async function connectWebSocket(config) {
    closeWebSocket();

    try {
        const { url, logUrl } = buildWsUrl(config);
        console.log('Connecting WebSocket to:', logUrl);
        ws = new WebSocket(url);
        wsUrl = url;

        const socket = ws;
        ws.onopen = () => {
            console.log('WebSocket connected successfully.');
            reconnectDelay = 5000;
            startKeepalive(socket);
            syncMissedMessages();
            updateUnreadBadge(); // Initial badge sync
        };

        ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.event === 'message') {
                    await handleIncomingMessage(message);
                }
            } catch (e) {
                console.error('Error processing WebSocket message:', e);
            }
        };

        ws.onclose = (event) => {
            stopKeepalive();
            console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}. Reconnecting...`);
            scheduleReconnect(config);
        };

        // Don't log the event or the exception: they contain the URL, and with it the ?auth= credentials
        ws.onerror = () => {
            console.error('WebSocket error');
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error.name);
        scheduleReconnect(config);
    }
}

function scheduleReconnect(config) {
    if (reconnectTimer) return;

    console.log(`Scheduling WebSocket reconnect in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        NtfyAPI.getConfig().then(currentConfig => {
            if (currentConfig.apiUrl && currentConfig.topics.length > 0) {
                reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
                connectWebSocket(currentConfig);
            }
        });
    }, reconnectDelay);
}

async function handleIncomingMessage(notification) {
    console.log('Received notification:', notification.id, notification.title);
    await processMessage(notification, { notify: true });
}

// The live socket and the catch-up poll both read-modify-write the history and the sync state.
// Run those updates one at a time so neither overwrites the other's.
let storageQueue = Promise.resolve();
function serialized(task) {
    const run = storageQueue.then(task);
    storageQueue = run.catch(() => {});
    return run;
}

// Per topic, topicSyncState holds the server time of the newest message seen (the next poll's
// since=, inclusive) and the ids of the latest messages, to skip the ones a poll returns again.
// since is null until the topic's first message.
function processMessage(notification, { notify }) {
    return serialized(async () => {
        const { topicSyncState = {} } = await chrome.storage.local.get(['topicSyncState']);
        const state = topicSyncState[notification.topic] || { since: null, ids: [] };
        if (state.ids.includes(notification.id)) {
            return;
        }

        state.ids = [...state.ids, notification.id].slice(-MAX_SEEN_IDS_PER_TOPIC);
        if (state.since === null || notification.time > state.since) {
            state.since = notification.time;
        }
        topicSyncState[notification.topic] = state;
        await chrome.storage.local.set({ topicSyncState });

        const added = await saveNotificationToHistory(notification);
        if (added && notify) {
            showDesktopNotification(notification);
        }
    });
}

// Resolves to true if the notification was added, false if it was already there or deleted
async function saveNotificationToHistory(notification) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['receivedNotifications', 'deletedMessageIds'], (result) => {
            let history = result.receivedNotifications || [];
            const deletedIds = result.deletedMessageIds || [];

            if (deletedIds.includes(notification.id)) {
                resolve(false);
                return;
            }

            if (history.some(n => n.id === notification.id)) {
                resolve(false);
                return;
            }

            history.unshift(notification);

            if (history.length > MAX_HISTORY_ITEMS) {
                history = history.slice(0, MAX_HISTORY_ITEMS);
            }

            chrome.storage.local.set({ receivedNotifications: history }, () => {
                resolve(true);
            });
        });
    });
}

function showDesktopNotification(notification) {
    const priorityLabels = {
        1: '⇊ Min',
        2: '↓ Low',
        4: '↑ High',
        5: '⇈ Urgent'
    };
    const priorityLabel = priorityLabels[notification.priority] ? ` [${priorityLabels[notification.priority]}]` : '';

    const buttons = [];
    if (notification.attachment && notification.attachment.url) {
        buttons.push({ title: '🔗 Open Attachment' });
    }

    chrome.notifications.create(notification.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: (notification.title || 'Notification') + priorityLabel,
        message: notification.message || '',
        contextMessage: `Topic: ${notification.topic}`,
        buttons: buttons,
        requireInteraction: notification.priority >= 4
    });
}

// Handle desktop notification button clicks (Open attachment URL in new tab)
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (buttonIndex === 0) {
        chrome.storage.local.get(['receivedNotifications'], (result) => {
            const history = result.receivedNotifications || [];
            const notification = history.find(n => n.id === notificationId);
            if (notification && notification.attachment && notification.attachment.url) {
                chrome.tabs.create({ url: notification.attachment.url });
            }
        });
    }
});

// Concurrent callers (socket open, alarm, popup) share the sync already running
let syncInFlight = null;
function syncMissedMessages() {
    if (!syncInFlight) {
        syncInFlight = runSync().finally(() => {
            syncInFlight = null;
        });
    }
    return syncInFlight;
}

async function runSync() {
    const config = await NtfyAPI.getConfig();
    if (!config.apiUrl || config.topics.length === 0) return;

    const { topicSyncState = {} } = await chrome.storage.local.get(['topicSyncState']);

    for (const topic of config.topics) {
        // A topic synced for the first time gets its recent history without desktop notifications
        const state = topicSyncState[topic];
        const since = state && state.since !== null ? state.since : INITIAL_SYNC_SINCE;

        try {
            const messages = await NtfyAPI.getNotifications(config, topic, since);
            messages.sort((a, b) => a.time - b.time);
            for (const notification of messages) {
                await processMessage(notification, { notify: Boolean(state) });
            }
            if (!state) {
                await serialized(async () => {
                    const current = await chrome.storage.local.get(['topicSyncState']);
                    const states = current.topicSyncState || {};
                    if (!states[topic]) {
                        states[topic] = { since: null, ids: [] };
                        await chrome.storage.local.set({ topicSyncState: states });
                    }
                });
            }
        } catch (error) {
            console.error(`Failed to sync missed messages for topic ${topic}:`, error.message);
        }
    }

    // Forget removed topics, so adding one back starts with a silent sync again
    await serialized(async () => {
        const current = await chrome.storage.local.get(['topicSyncState']);
        const states = current.topicSyncState || {};
        const stale = Object.keys(states).filter(topic => !config.topics.includes(topic));
        if (stale.length > 0) {
            stale.forEach(topic => delete states[topic]);
            await chrome.storage.local.set({ topicSyncState: states });
        }
    });
}

function setupAlarm() {
    chrome.alarms.create('ws-keepalive', { periodInMinutes: 1 });
}

// Alarm Listener for keep-alive and missed sync
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'ws-keepalive') {
        console.log('Keep-alive alarm fired, ensuring WebSocket is connected...');
        initWebSocket();
        syncMissedMessages();
    }
});

async function updateUnreadBadge() {
    chrome.storage.local.get(['receivedNotifications', 'readMessageIds', 'deletedMessageIds'], (result) => {
        const history = result.receivedNotifications || [];
        const readIds = result.readMessageIds || [];
        const deletedIds = result.deletedMessageIds || [];

        // Unread count = history items that are NOT deleted AND NOT read
        const unreadCount = history
            .filter(n => !deletedIds.includes(n.id))
            .filter(n => !readIds.includes(n.id))
            .length;

        if (unreadCount > 0) {
            chrome.action.setBadgeText({ text: unreadCount.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    });
}

// Listen for manual sync requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'sync') {
        console.log('Sync request received from popup, forcing sync...');
        syncMissedMessages()
            .then(() => sendResponse({ success: true }))
            .catch(() => sendResponse({ success: false }));
        return true;
    }
});
