// Background service worker for context menu integration
// Compatible with Chrome, Edge, and Firefox 142+

// Import shared utilities
importScripts('ntfy.js');

const PARENT_MENU_ID = 'ntfy-parent';
const SEND_SELECTION_ID = 'ntfy-send-selection';
const SEND_IMAGE_ID = 'ntfy-send-image';
const SEND_PAGE_ID = 'ntfy-send-page';

// Initialize context menu on install and startup
chrome.runtime.onInstalled.addListener(() => {
    updateContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
    updateContextMenu();
});

// Listen for storage changes to update menu when topics change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.topics) {
        updateContextMenu();
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

    if (topics.length === 1) {
        // Single topic: direct menu items
        const topic = topics[0];

        chrome.contextMenus.create({
            id: SEND_SELECTION_ID,
            title: `Send to ntfy (${topic})`,
            contexts: ['selection']
        });

        chrome.contextMenus.create({
            id: SEND_IMAGE_ID,
            title: `Send to ntfy (${topic})`,
            contexts: ['image']
        });

        chrome.contextMenus.create({
            id: SEND_PAGE_ID,
            title: `Send to ntfy (${topic})`,
            contexts: ['page']
        });
    } else {
        // Multiple topics: create parent menu with submenu

        // Selection context
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-selection`,
            title: 'Send to ntfy',
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

        // Image context
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-image`,
            title: 'Send to ntfy',
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

        // Page context
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-page`,
            title: 'Send to ntfy',
            contexts: ['page']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_PAGE_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-page`,
                title: topic,
                contexts: ['page']
            });
        });
    }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        console.error('ntfy not configured');
        return;
    }

    let topic;
    let menuId = info.menuItemId;

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
            await NtfyAPI.sendNotification(config, topic, {
                message: info.selectionText
            });
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_IMAGE_ID || menuId.startsWith(SEND_IMAGE_ID)) {
            // Send image
            await NtfyAPI.sendImageFromUrl(config, topic, info.srcUrl);
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_PAGE_ID || menuId.startsWith(SEND_PAGE_ID)) {
            // Send page URL
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
function showBadge(text, color) {
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: color });

    setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
    }, 2000);
}
