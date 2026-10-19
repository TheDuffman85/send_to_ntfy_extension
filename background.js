// Background service worker for context menu integration
// Compatible with Chrome, Edge, and Firefox 142+

// Import shared utilities (only in Service Worker context)
if (typeof importScripts === 'function') {
    importScripts('ntfy.js', 'markdown.js', 'emojis.js');
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
// A socket can stay open after the connection died (e.g. after sleep or a network change) until TCP
// gives up, many minutes later. ntfy sends a keepalive event every 45 s by default, so a socket that
// has been silent much longer than that is replaced. Generous, for servers with a longer interval.
const WS_SILENCE_TIMEOUT = 3 * 60 * 1000;
const MAX_HISTORY_ITEMS = 50;
const MAX_SEEN_IDS_PER_TOPIC = 200;
// How long the read-access check of the topics is reused
const READABLE_TOPICS_TTL = 60 * 60 * 1000;
// Window fetched silently the first time a topic is synced
const INITIAL_SYNC_SINCE = '24h';
// ntfy limits the requests of each visitor (by default a burst of 60, then one every 5 s). After an
// HTTP 429, the background makes no requests for this long, so the limit can recover for sending
// and downloads instead of being used up again by reconnects and catch-up polls.
const RATE_LIMIT_PAUSE = 2 * 60 * 1000;
// Messages missed while offline: up to this many get their own desktop notification, more get one summary
const MAX_CATCH_UP_NOTIFICATIONS = 3;
const SUMMARY_NOTIFICATION_ID = 'ntfy-summary';
const ALARM_NAME = 'ws-keepalive';


const PARENT_MENU_ID = 'ntfy-parent';
const SEND_SELECTION_ID = 'ntfy-send-selection';
const SEND_IMAGE_ID = 'ntfy-send-image';
const SEND_LINK_ID = 'ntfy-send-link'; // Replaced SEND_PAGE_ID
const SEND_TAB_ID = 'ntfy-send-tab';

// Initialize context menu, WebSocket (which also sets up the alarm), and unread badge on install and startup
chrome.runtime.onInstalled.addListener(() => {
    // Replaced by the per-topic topicSyncState
    chrome.storage.local.remove('lastNotificationId');
    // The "Include current tab's URL" setting was removed
    chrome.storage.sync.remove('includeUrl');
    updateContextMenu();
    initWebSocket();
    updateUnreadBadge();
    listPreviousImageSites().then(removeUnusedImageSitePermissions);
});

chrome.runtime.onStartup.addListener(() => {
    clearPreviousSessionDrafts();
    updateContextMenu();
    initWebSocket();
    // The badge isn't kept over a browser restart; don't wait for the connection to show it again
    updateUnreadBadge();
    // Also when the browser was closed at the time of the daily alarm
    removeUnusedImageSitePermissions();
});

// Files attached in the popup are stored, with the unsent draft, until sent; a new browser session
// starts without them. Done here at startup rather than when the popup next opens, so they don't
// stay on disk until then. The popup checks the same flag, for a session the extension joined later.
async function clearPreviousSessionDrafts() {
    try {
        await chrome.storage.local.remove(['storedFiles', 'storedFile', 'draftState']);
        await chrome.storage.session.set({ sessionActive: true });
    } catch (error) {
        console.error('Failed to clear the previous session\'s attachments:', error.message);
    }
}

// Listen for storage changes to update context menu, WebSocket config, and unread badge
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        if (changes.topics || changes.apiUrl || changes.accessToken) {
            updateContextMenu();
            scheduleWebSocketInit();
        }
        if (changes.topics) {
            NtfyAPI.getConfig().then(config => forgetRemovedTopics(config.topics));
            updateUnreadBadge();
        }
        if (changes.receiveEnabled) {
            scheduleWebSocketInit();
            updateUnreadBadge();
        }
    }
    if (area === 'local') {
        if (changes.accessToken || changes.serverUsername || changes.serverPassword) {
            scheduleWebSocketInit();
        }
        if (changes.receivedNotifications || changes.readMessageIds || changes.deletedMessageIds) {
            updateUnreadBadge();
        }
    }
});

// One save in the settings changes storage.sync and storage.local (the credentials) one after the other,
// and typing the server or token saves repeatedly. Reconnect once, after the changes settle.
const CONFIG_CHANGE_DELAY = 1000;
let configChangeTimer = null;
function scheduleWebSocketInit() {
    clearTimeout(configChangeTimer);
    configChangeTimer = setTimeout(() => {
        configChangeTimer = null;
        initWebSocket();
    }, CONFIG_CHANGE_DELAY);
}

// Menu ids of a topic's items: the topic name rather than its position, so a click on a menu built
// from an older topic list can't send to another topic. The id is split at the first "|".
const TOPIC_SEPARATOR = '|';

// Rebuilds run one at a time: overlapping ones would create the same ids twice
let contextMenuUpdate = Promise.resolve();
function updateContextMenu() {
    contextMenuUpdate = contextMenuUpdate
        .then(buildContextMenu)
        .catch(error => console.error('Failed to update the context menu:', error));
    return contextMenuUpdate;
}

// Build or rebuild the context menu based on current topics
async function buildContextMenu() {
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
            id: `${SEND_TAB_ID}${TOPIC_SEPARATOR}${topic}`,
            parentId: PARENT_MENU_ID,
            title: `Page (${topic})`,
            contexts: ['all']
        });

        // 2. Text - Selection only
        chrome.contextMenus.create({
            id: `${SEND_SELECTION_ID}${TOPIC_SEPARATOR}${topic}`,
            parentId: PARENT_MENU_ID,
            title: `Text (${topic})`,
            contexts: ['selection']
        });

        // 3. Image - Image only
        chrome.contextMenus.create({
            id: `${SEND_IMAGE_ID}${TOPIC_SEPARATOR}${topic}`,
            parentId: PARENT_MENU_ID,
            title: `Image (${topic})`,
            contexts: ['image']
        });

        // 4. Link - Link only
        chrome.contextMenus.create({
            id: `${SEND_LINK_ID}${TOPIC_SEPARATOR}${topic}`,
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

        topics.forEach(topic => {
            chrome.contextMenus.create({
                id: `${SEND_TAB_ID}${TOPIC_SEPARATOR}${topic}`,
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

        topics.forEach(topic => {
            chrome.contextMenus.create({
                id: `${SEND_SELECTION_ID}${TOPIC_SEPARATOR}${topic}`,
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

        topics.forEach(topic => {
            chrome.contextMenus.create({
                id: `${SEND_IMAGE_ID}${TOPIC_SEPARATOR}${topic}`,
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

        topics.forEach(topic => {
            chrome.contextMenus.create({
                id: `${SEND_LINK_ID}${TOPIC_SEPARATOR}${topic}`,
                parentId: `${PARENT_MENU_ID}-link`,
                title: topic,
                contexts: ['link']
            });
        });
    }
}

// Image sites the extension got a permission for to send an image, by the time of their last use
// (storage.local, as { origin pattern: ms }). A permission it got otherwise ("Allow access to this
// server") isn't listed and stays. Older versions kept every image site's permission: those found on
// updating are listed once, as used then (see listPreviousImageSites).
const IMAGE_SITES_KEY = 'imageSitePermissions';
const IMAGE_SITES_LISTED_KEY = 'imageSitePermissionsListed';
// Unused for this long, a listed site's permission is removed, so sending images doesn't leave a
// lasting permission for every site sent from
const IMAGE_SITE_MAX_UNUSED = 30 * 24 * 60 * 60 * 1000;
const IMAGE_SITE_ALARM = 'image-site-cleanup';

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const menuId = String(info.menuItemId);
    const separator = menuId.indexOf(TOPIC_SEPARATOR);
    const action = separator === -1 ? menuId : menuId.slice(0, separator);
    const topic = separator === -1 ? null : menuId.slice(separator + 1);

    // An image is fetched from its site, which needs a permission for that site
    const origin = action === SEND_IMAGE_ID && info.srcUrl ? NtfyAPI.serverOriginPattern(info.srcUrl) : null;
    if (origin) {
        try {
            // Request permission immediately while we have the user gesture: nothing may be awaited
            // before it. Whether the permission was there already is asked at the same time.
            const hadPermission = chrome.permissions.contains({ origins: [origin] }).catch(() => true);
            const granted = await new Promise(resolve => {
                chrome.permissions.request({ origins: [origin] }, resolve);
            });

            if (!granted) {
                console.error('Permission denied to access image origin');
                showBadge('✗', '#f44336');
                return;
            }
            await noteImageSiteUse(origin, !(await hadPermission));
        } catch (e) {
            console.error('Failed to request permission:', e);
            // Continue anyway, it might fail later in fetch but we tried
        }
    }

    await handleMenuAction(action, topic, info, tab);
});

// Lists a site whose permission was just granted, and renews the time of a listed one
function noteImageSiteUse(origin, newlyGranted) {
    return serialized(async () => {
        const { [IMAGE_SITES_KEY]: sites = {} } = await chrome.storage.local.get([IMAGE_SITES_KEY]);
        if (!newlyGranted && !(origin in sites)) {
            return; // The extension had the permission before
        }
        sites[origin] = Date.now();
        await chrome.storage.local.set({ [IMAGE_SITES_KEY]: sites });
        await updateImageSiteAlarm(sites);
    });
}

// Once: lists the site permissions the extension has, which older versions left from sending images,
// so their 30 days start now. Not the server's site, which the extension needs for its own requests,
// nor a permission for all sites, which the user gave on purpose.
function listPreviousImageSites() {
    return serialized(async () => {
        const stored = await chrome.storage.local.get([IMAGE_SITES_KEY, IMAGE_SITES_LISTED_KEY]);
        if (stored[IMAGE_SITES_LISTED_KEY]) {
            return;
        }
        const { origins = [] } = await chrome.permissions.getAll();
        const serverOrigin = NtfyAPI.serverOriginPattern((await NtfyAPI.getConfig()).apiUrl);
        const sites = stored[IMAGE_SITES_KEY] || {};
        origins
            .filter(origin => /^https?:\/\/[^*/]+\/\*$/.test(origin) && origin !== serverOrigin && !(origin in sites))
            .forEach(origin => {
                sites[origin] = Date.now();
            });
        await chrome.storage.local.set({ [IMAGE_SITES_KEY]: sites, [IMAGE_SITES_LISTED_KEY]: true });
        await updateImageSiteAlarm(sites);
    }).catch(error => console.error('Failed to list the image site permissions:', error.message));
}

// Removes the permissions of listed sites unused for IMAGE_SITE_MAX_UNUSED
function removeUnusedImageSitePermissions() {
    return serialized(async () => {
        const { [IMAGE_SITES_KEY]: sites = {} } = await chrome.storage.local.get([IMAGE_SITES_KEY]);
        const unused = Object.keys(sites).filter(origin => Date.now() - sites[origin] >= IMAGE_SITE_MAX_UNUSED);
        if (unused.length > 0) {
            // The server's site stays: the extension may need it for its own requests
            const serverOrigin = NtfyAPI.serverOriginPattern((await NtfyAPI.getConfig()).apiUrl);
            for (const origin of unused) {
                if (origin !== serverOrigin) {
                    await chrome.permissions.remove({ origins: [origin] }).catch(error => {
                        console.error('Failed to remove the image site permission:', error.message);
                    });
                }
                delete sites[origin];
            }
            await chrome.storage.local.set({ [IMAGE_SITES_KEY]: sites });
        }
        await updateImageSiteAlarm(sites);
    }).catch(error => console.error('Failed to remove unused image site permissions:', error.message));
}

// A daily check while sites are listed; none listed, nothing wakes the extension for it
async function updateImageSiteAlarm(sites) {
    const listed = Object.keys(sites).length > 0;
    const alarm = await chrome.alarms.get(IMAGE_SITE_ALARM);
    if (listed && !alarm) {
        await chrome.alarms.create(IMAGE_SITE_ALARM, { periodInMinutes: 24 * 60 });
    } else if (!listed && alarm) {
        await chrome.alarms.clear(IMAGE_SITE_ALARM);
    }
}

async function handleMenuAction(action, topic, info, tab) {
    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        console.error('ntfy not configured');
        showBadge('✗', '#f44336');
        return;
    }

    // The topic must still be configured
    if (!topic || !topics.includes(topic)) {
        console.error('Could not determine topic');
        showBadge('✗', '#f44336');
        return;
    }

    try {
        if (action === SEND_SELECTION_ID) {
            // Send selected text
            await NtfyAPI.sendNotification(config, topic, {
                message: info.selectionText
            });
            showBadge('✓', '#4CAF50');
        } else if (action === SEND_IMAGE_ID) {
            // Send image
            await NtfyAPI.sendImageFromUrl(config, topic, info.srcUrl);
            showBadge('✓', '#4CAF50');
        } else if (action === SEND_LINK_ID) {
            // Send link URL
            const urlToSend = info.linkUrl;
            let linkText = '';

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
                    // One line: the text of a card-style link spans several (heading, teaser, ...)
                    linkText = results[0].result.replace(/\s+/g, ' ').trim();
                }
            } catch (e) {
                console.error('Failed to retrieve link text:', e);
            }

            // The link text is the title
            await NtfyAPI.sendNotification(config, topic, {
                message: urlToSend,
                title: linkText
            });
            showBadge('✓', '#4CAF50');
        } else if (action === SEND_TAB_ID) {
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
}

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

// Runs one at a time. A call while one runs makes it run again once done, with the configuration
// as it is then, so an older run finishing last can't connect with outdated settings.
let webSocketInit = null;
let webSocketInitAgain = false;
function initWebSocket() {
    if (webSocketInit) {
        webSocketInitAgain = true;
        return webSocketInit;
    }
    webSocketInit = (async () => {
        do {
            webSocketInitAgain = false;
            try {
                await refreshWebSocket();
            } catch (error) {
                console.error('Failed to set up the WebSocket:', error.message);
            }
        } while (webSocketInitAgain);
    })().finally(() => {
        webSocketInit = null;
    });
    return webSocketInit;
}

async function refreshWebSocket() {
    const config = await NtfyAPI.getConfig();
    await updateAlarm(Boolean(config.apiUrl && config.topics.length > 0 && config.receiveEnabled));
    if (!config.apiUrl || config.topics.length === 0) {
        console.log('ntfy is not configured, skipping WebSocket connection.');
        closeWebSocket();
        return;
    }

    if (!config.receiveEnabled) {
        console.log('Receiving is disabled, skipping WebSocket connection.');
        closeWebSocket();
        // Turned back on, each topic starts again with a silent sync instead of notifying the
        // whole backlog of the time it was off
        await serialized(async () => {
            const { topicSyncState } = await chrome.storage.local.get(['topicSyncState']);
            if (topicSyncState) {
                await chrome.storage.local.remove('topicSyncState');
            }
        });
        return;
    }

    if (await waitForRateLimit()) {
        return;
    }

    const topics = await getReadableTopics(config);
    if (await waitForRateLimit()) {
        return;
    }
    if (topics.length === 0) {
        console.log('No configured topic is readable, skipping WebSocket connection.');
        closeWebSocket();
        return;
    }
    const subscription = { ...config, topics };

    if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            let expectedUrl = null;
            try {
                expectedUrl = buildWsUrl(subscription).url;
            } catch (e) {}
            if (wsUrl === expectedUrl) {
                return;
            }
            console.log('Configuration changed, reconnecting WebSocket...');
        }
    }

    connectWebSocket(subscription);
}

// ntfy rejects a subscription to several topics if any one of them isn't readable, and a topic the
// token can only send to is a normal setup. So subscribe to, and poll, the readable topics only.
// The result is also kept in storage.session (memory only), so a restarted service worker doesn't ask again.
let readableTopicsCache = { key: null, topics: [], time: 0 };
async function getReadableTopics(config) {
    const key = await readableTopicsKey(config);
    if (readableTopicsCache.key !== key && chrome.storage.session) {
        try {
            const stored = (await chrome.storage.session.get(['readableTopicsCache'])).readableTopicsCache;
            if (stored) {
                readableTopicsCache = stored;
            }
        } catch (e) {}
    }
    if (readableTopicsCache.key === key && Date.now() - readableTopicsCache.time < READABLE_TOPICS_TTL) {
        return readableTopicsCache.topics;
    }

    let access;
    try {
        access = await Promise.all(config.topics.map(topic => NtfyAPI.canReadTopic(config, topic)));
    } catch (error) {
        if (error.status !== 429) {
            throw error;
        }
        await noteRateLimited();
        // Keep the last known result (even if outdated), or try all topics
        return readableTopicsCache.key === key ? readableTopicsCache.topics : config.topics;
    }
    // A topic the server couldn't be asked about (null) is kept, and the result isn't cached
    const topics = config.topics.filter((topic, i) => access[i] !== false);
    const skipped = config.topics.filter((topic, i) => access[i] === false);
    if (skipped.length > 0) {
        console.log(`Not receiving from topics without read access: ${skipped.join(', ')}`);
    }
    if (!access.includes(null)) {
        readableTopicsCache = { key, topics, time: Date.now() };
        if (chrome.storage.session) {
            chrome.storage.session.set({ readableTopicsCache }).catch(() => {});
        }
    }
    return topics;
}

// The alarm reconnects and catches up while receiving. Without receiving there is nothing for it to
// do, so it is removed and doesn't wake the service worker every minute.
async function updateAlarm(receiving) {
    try {
        const alarm = await chrome.alarms.get(ALARM_NAME);
        if (receiving && !alarm) {
            await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
        } else if (!receiving && alarm) {
            await chrome.alarms.clear(ALARM_NAME);
        }
    } catch (error) {
        console.error('Failed to update the alarm:', error.message);
    }
}

// The access check depends on the server, credentials and topics. Hashed, so the cache in
// storage.session doesn't hold the credentials.
async function readableTopicsKey(config) {
    const data = new TextEncoder().encode(JSON.stringify([config.apiUrl, NtfyAPI.buildAuthHeaderValue(config), config.topics]));
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function startKeepalive(socket) {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
        if (socket !== ws || socket.readyState !== WebSocket.OPEN || replaceSilentWebSocket()) {
            return;
        }
        socket.send('keepalive');
    }, WS_KEEPALIVE_INTERVAL);
}

// Time of the last data from the server on the current socket (its opening, a message, or a keepalive)
let lastWsActivity = 0;

// Replaces an open socket that has been silent for too long (see WS_SILENCE_TIMEOUT).
// Returns true if it did.
function replaceSilentWebSocket() {
    if (!isWebSocketOpen() || Date.now() - lastWsActivity < WS_SILENCE_TIMEOUT) {
        return false;
    }
    console.log('No data from the server for a while, reconnecting WebSocket...');
    closeWebSocket();
    initWebSocket();
    return true;
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
    // Host only, like the HTTP calls: credentials embedded in the URL must not end up in the WebSocket URL
    const urlObj = new URL(NtfyAPI.normalizeServerUrl(config.apiUrl));
    const scheme = urlObj.protocol === 'http:' ? 'ws:' : 'wss:';
    const logUrl = `${scheme}//${urlObj.host}/${config.topics.map(encodeURIComponent).join(',')}/ws`;

    // Browsers can't set headers on a WebSocket, so ntfy accepts the Authorization header value in ?auth=
    const auth = NtfyAPI.buildAuthHeaderValue(config);
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
            lastWsActivity = Date.now();
            reconnectDelay = 5000;
            startKeepalive(socket);
            syncMissedMessages();
            updateUnreadBadge(); // Initial badge sync
        };

        ws.onmessage = async (event) => {
            lastWsActivity = Date.now();
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
            scheduleReconnect();
        };

        // Don't log the event or the exception: they contain the URL, and with it the ?auth= credentials
        ws.onerror = () => {
            console.error('WebSocket error');
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error.name);
        scheduleReconnect();
    }
}

// delay: wait this long instead of the next backoff step (used while rate limited)
function scheduleReconnect(delay) {
    if (reconnectTimer) return;

    const wait = delay || reconnectDelay;
    console.log(`Scheduling WebSocket reconnect in ${Math.ceil(wait / 1000)}s...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!delay) {
            reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
        }
        initWebSocket();
    }, wait);
}

// While rate limited, leave an open socket alone and schedule the reconnect for after the pause.
// Resolves to true if rate limited.
async function waitForRateLimit() {
    const pause = await rateLimitRemaining();
    if (pause === 0) {
        return false;
    }
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        console.log(`Server request limit reached, connecting again in ${Math.ceil(pause / 1000)}s.`);
        scheduleReconnect(pause);
    }
    return true;
}

// The pause is kept in storage.session, so a restarted service worker keeps to it
let rateLimitedUntil = null;
async function noteRateLimited() {
    rateLimitedUntil = Date.now() + RATE_LIMIT_PAUSE;
    console.log('Server request limit reached (HTTP 429), pausing background requests.');
    if (chrome.storage.session) {
        await chrome.storage.session.set({ rateLimitedUntil }).catch(() => {});
    }
}

async function rateLimitRemaining() {
    if (rateLimitedUntil === null) {
        rateLimitedUntil = 0;
        if (chrome.storage.session) {
            try {
                rateLimitedUntil = (await chrome.storage.session.get(['rateLimitedUntil'])).rateLimitedUntil || 0;
            } catch (e) {}
        }
    }
    return Math.max(0, rateLimitedUntil - Date.now());
}

async function handleIncomingMessage(notification) {
    console.log('Received notification:', notification.id, notification.title);
    if (await processMessage(notification)) {
        showDesktopNotification(notification);
    }
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
// Resolves to true if the message is new, and not one this extension sent itself (NtfyAPI.markAsSent):
// worth a desktop notification.
function processMessage(notification) {
    return serialized(async () => {
        const { topicSyncState = {}, sentMessageIds = [] } =
            await chrome.storage.local.get(['topicSyncState', 'sentMessageIds']);
        const state = topicSyncState[notification.topic] || { since: null, ids: [] };
        if (state.ids.includes(notification.id)) {
            return false;
        }

        state.ids = [...state.ids, notification.id].slice(-MAX_SEEN_IDS_PER_TOPIC);
        if (state.since === null || notification.time > state.since) {
            state.since = notification.time;
        }
        topicSyncState[notification.topic] = state;
        await chrome.storage.local.set({ topicSyncState });

        const added = await saveNotificationToHistory(notification);
        return added && !sentMessageIds.includes(notification.id);
    });
}

// Resolves to true if the notification was added, false if it was already there, deleted, or older
// than all of a full history
async function saveNotificationToHistory(notification) {
    const result = await chrome.storage.local.get(['receivedNotifications', 'deletedMessageIds']);
    const deletedIds = new Set(result.deletedMessageIds || []);
    const history = result.receivedNotifications || [];

    if (deletedIds.has(notification.id) || history.some(n => n.id === notification.id)) {
        return false;
    }

    // Deleted messages give up their place (their ids stay in deletedMessageIds, so they don't come
    // back), and the oldest messages by server time are the ones dropped, not the first to arrive:
    // a catch-up goes topic by topic
    const updated = [notification, ...history.filter(n => !deletedIds.has(n.id))]
        .sort((a, b) => b.time - a.time)
        .slice(0, MAX_HISTORY_ITEMS);
    await chrome.storage.local.set({ receivedNotifications: updated });
    return updated.includes(notification);
}

function showDesktopNotification(notification) {
    const priorityLabels = {
        1: '⇊ Min',
        2: '↓ Low',
        4: '↑ High',
        5: '⇈ Urgent'
    };
    const priorityLabel = priorityLabels[notification.priority] ? ` [${priorityLabels[notification.priority]}]` : '';

    // Whoever sends the message chooses the pages a click and the button open: name their sites, so
    // a link to a lookalike site doesn't pass unnoticed
    const buttons = [];
    if (notification.attachment && NtfyAPI.isHttpUrl(notification.attachment.url)) {
        buttons.push({ title: `🔗 Open attachment (${new URL(notification.attachment.url).host})` });
    }
    let message = Emojis.formatMessage({ ...notification, message: notificationText(notification) });
    if (NtfyAPI.isHttpUrl(notification.click)) {
        message += `\n↗ ${new URL(notification.click).host}`;
    }

    createNotification(notification.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: (notification.title ? Emojis.formatTitle(notification) : 'Notification') + priorityLabel,
        message,
        contextMessage: `Topic: ${notification.topic}`,
        buttons: buttons,
        requireInteraction: notification.priority >= 4
    });
}

// Messages of priority 4 and 5 stay on screen until dismissed. Anyone who can publish to a topic can
// send those, so only a few stay at a time; further ones go away like the others.
const MAX_STICKY_NOTIFICATIONS = 3;
let stickyNotificationIds = null; // Kept in storage.session, so a restarted service worker knows them

// Created one at a time, so the sticky notifications are counted correctly
let notificationQueue = Promise.resolve();
function createNotification(id, options) {
    notificationQueue = notificationQueue
        .then(async () => {
            const requireInteraction = Boolean(options.requireInteraction) && await claimStickySlot(id);
            chrome.notifications.create(id, { ...options, requireInteraction });
        })
        .catch(error => console.error('Failed to show a notification:', error));
    return notificationQueue;
}

// Resolves to true if notification id may stay on screen
async function claimStickySlot(id) {
    if (stickyNotificationIds === null) {
        try {
            stickyNotificationIds = (await chrome.storage.session.get(['stickyNotificationIds'])).stickyNotificationIds || [];
        } catch (e) {
            stickyNotificationIds = [];
        }
    }
    // Those still showing; the one being replaced (same id) counts as gone
    const open = await new Promise(resolve => chrome.notifications.getAll(resolve)) || {};
    stickyNotificationIds = stickyNotificationIds.filter(stickyId => stickyId in open && stickyId !== id);

    const claimed = stickyNotificationIds.length < MAX_STICKY_NOTIFICATIONS;
    if (claimed) {
        stickyNotificationIds.push(id);
    }
    chrome.storage.session.set({ stickyNotificationIds }).catch(() => {});
    return claimed;
}

// Notifications show plain text, so Markdown messages lose their formatting characters
function notificationText(notification) {
    const text = notification.message || '';
    if (notification.content_type !== 'text/markdown') {
        return text;
    }
    try {
        return Markdown.toPlainText(text);
    } catch (e) {
        console.warn('Could not convert Markdown for the notification:', e);
        return text; // Better the raw text than no notification
    }
}

// Messages missed while offline: each gets its own desktop notification if there are only a few,
// otherwise one summary, so starting the browser doesn't bring up a pile of them
function showCatchUpNotifications(notifications) {
    if (notifications.length <= MAX_CATCH_UP_NOTIFICATIONS) {
        notifications.forEach(showDesktopNotification);
        return;
    }

    const newest = [...notifications].sort((a, b) => b.time - a.time);
    const lines = newest.slice(0, MAX_CATCH_UP_NOTIFICATIONS)
        .map(notification => notification.title
            ? Emojis.formatTitle(notification)
            : Emojis.formatMessage({ ...notification, message: notificationText(notification) }).split('\n')[0]);
    lines.push(`… and ${newest.length - lines.length} more`);
    const topics = [...new Set(newest.map(notification => notification.topic))];

    createNotification(SUMMARY_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `${notifications.length} new messages`,
        message: lines.join('\n'),
        contextMessage: `${topics.length === 1 ? 'Topic' : 'Topics'}: ${topics.join(', ')}`,
        requireInteraction: notifications.some(notification => notification.priority >= 4)
    });
}

// A click on a desktop notification marks its message as read and opens the message's click URL
// (ntfy's X-Click) or else the popup
chrome.notifications.onClicked.addListener(async (notificationId) => {
    chrome.notifications.clear(notificationId);
    if (notificationId !== SUMMARY_NOTIFICATION_ID) {
        const { receivedNotifications = [], readMessageIds = [] } =
            await chrome.storage.local.get(['receivedNotifications', 'readMessageIds']);
        const notification = receivedNotifications.find(n => n.id === notificationId);
        if (notification) {
            await chrome.storage.local.set({ readMessageIds: NtfyAPI.appendIds(readMessageIds, [notificationId]) });
            if (NtfyAPI.isHttpUrl(notification.click)) {
                chrome.tabs.create({ url: notification.click });
                return;
            }
        }
    }
    // Not available, or not allowed without a click on the extension, in every browser
    try {
        await chrome.action.openPopup();
    } catch (e) {
        console.log('Could not open the popup:', e.message);
    }
});

// Handle desktop notification button clicks (Open attachment URL in new tab).
// Firefox has no notification buttons; there the event may be missing.
if (chrome.notifications.onButtonClicked) {
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
        if (buttonIndex === 0) {
            chrome.storage.local.get(['receivedNotifications'], (result) => {
                const history = result.receivedNotifications || [];
                const notification = history.find(n => n.id === notificationId);
                if (notification && notification.attachment && NtfyAPI.isHttpUrl(notification.attachment.url)) {
                    chrome.tabs.create({ url: notification.attachment.url });
                }
            });
        }
    });
}

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
    if (!config.apiUrl || config.topics.length === 0 || !config.receiveEnabled) return;
    if (await rateLimitRemaining() > 0) return;

    const { topicSyncState = {} } = await chrome.storage.local.get(['topicSyncState']);
    const topics = await getReadableTopics(config);
    if (await rateLimitRemaining() > 0) return;

    const toNotify = [];
    for (const topic of topics) {
        // A topic synced for the first time gets its recent history without desktop notifications
        const state = topicSyncState[topic];
        const since = state && state.since !== null ? state.since : INITIAL_SYNC_SINCE;

        try {
            const messages = await NtfyAPI.getNotifications(config, topic, since);
            messages.sort((a, b) => a.time - b.time);
            for (const notification of messages) {
                if (await processMessage(notification) && state) {
                    toNotify.push(notification);
                }
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
            if (error.status === 429) {
                await noteRateLimited();
                break;
            }
            console.error(`Failed to sync missed messages for topic ${topic}:`, error.message);
        }
    }

    showCatchUpNotifications(toNotify);
    await forgetRemovedTopics(config.topics);
}

// Forget removed topics: their messages leave the history, and adding one back starts with a
// silent sync again
function forgetRemovedTopics(topics) {
    return serialized(async () => {
        const { topicSyncState = {}, receivedNotifications = [] } =
            await chrome.storage.local.get(['topicSyncState', 'receivedNotifications']);
        const update = {};

        const stale = Object.keys(topicSyncState).filter(topic => !topics.includes(topic));
        if (stale.length > 0) {
            stale.forEach(topic => delete topicSyncState[topic]);
            update.topicSyncState = topicSyncState;
        }
        const history = receivedNotifications.filter(notification => topics.includes(notification.topic));
        if (history.length !== receivedNotifications.length) {
            update.receivedNotifications = history;
        }

        if (Object.keys(update).length > 0) {
            await chrome.storage.local.set(update);
        }
    });
}

function isWebSocketOpen() {
    return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

// Alarm Listener for keep-alive and missed sync (set up while receiving, see updateAlarm)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log('Keep-alive alarm fired, ensuring WebSocket is connected...');
        if (!replaceSilentWebSocket()) {
            initWebSocket();
        }
        // While the socket is open, messages arrive live, and each (re)connect catches up on missed ones.
        // Polling every topic each minute on top of that runs into ntfy's request limit (HTTP 429).
        if (!isWebSocketOpen()) {
            syncMissedMessages();
        }
    } else if (alarm.name === IMAGE_SITE_ALARM) {
        removeUnusedImageSitePermissions();
    }
});

async function updateUnreadBadge() {
    const config = await NtfyAPI.getConfig();
    if (!config.receiveEnabled) {
        chrome.action.setBadgeText({ text: '' });
        return;
    }
    chrome.storage.local.get(['receivedNotifications', 'readMessageIds', 'deletedMessageIds'], (result) => {
        const history = result.receivedNotifications || [];
        const readIds = new Set(result.readMessageIds || []);
        const deletedIds = new Set(result.deletedMessageIds || []);

        // Unread count = history items of configured topics that are NOT deleted AND NOT read
        const unreadCount = history
            .filter(n => config.topics.includes(n.topic) && !deletedIds.has(n.id) && !readIds.has(n.id))
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
        if (isWebSocketOpen()) {
            sendResponse({ success: true });
            return false;
        }
        console.log('Sync request received from popup, forcing sync...');
        syncMissedMessages()
            .then(() => sendResponse({ success: true }))
            .catch(() => sendResponse({ success: false }));
        return true;
    }
});
