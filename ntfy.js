// Shared ntfy API utilities
// Used by both popup.js and background.js

const NtfyAPI = {
    // Longest kept list of read or deleted message ids. The history holds 50 messages, and a deleted
    // message's id must outlive its copy in the server's cache (12 h by default), so a poll doesn't bring it back.
    MAX_STORED_IDS: 1000,

    // ntfy's topic name rule
    TOPIC_PATTERN: /^[-_A-Za-z0-9]{1,64}$/,

    /**
     * Get configuration from storage
     * @returns {Promise<{apiUrl: string, accessToken: string, username: string, password: string, topics: string[], receiveEnabled: boolean}>}
     */
    async getConfig() {
        const accessToken = await this.getAccessToken();
        // Before reading apiUrl: moves credentials out of it
        const { username, password } = await this.getServerCredentials();
        return new Promise((resolve) => {
            chrome.storage.sync.get(['apiUrl', 'topics', 'receiveEnabled'], (items) => {
                resolve({
                    apiUrl: this.normalizeServerUrl(items.apiUrl),
                    accessToken: accessToken,
                    username,
                    password,
                    topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : [],
                    receiveEnabled: items.receiveEnabled === true
                });
            });
        });
    },

    /**
     * Get the access token. It is kept in storage.local, so browser sync doesn't copy it to other
     * browsers; a token saved in storage.sync by an older version is moved there.
     * @returns {Promise<string>}
     */
    async getAccessToken() {
        const local = await new Promise(resolve => chrome.storage.local.get(['accessToken'], resolve));
        if (local.accessToken !== undefined) {
            return local.accessToken;
        }

        const synced = await new Promise(resolve => chrome.storage.sync.get(['accessToken'], resolve));
        if (synced.accessToken === undefined) {
            return '';
        }
        await this.setAccessToken(synced.accessToken);
        return synced.accessToken;
    },

    /**
     * Get the username and password for Basic authentication. Like the token, they are kept in
     * storage.local, so browser sync doesn't copy them to other browsers. Older versions took them
     * from the server URL (https://user:password@host), which is synced: they are moved here and
     * removed from the URL.
     * @returns {Promise<{username: string, password: string}>}
     */
    async getServerCredentials() {
        const { apiUrl } = await chrome.storage.sync.get(['apiUrl']);
        const split = this.splitServerUrl(apiUrl);
        if (split.username || split.password) {
            await this.setServerCredentials(split.username, split.password);
            await chrome.storage.sync.set({ apiUrl: split.url });
            return { username: split.username, password: split.password };
        }

        const local = await chrome.storage.local.get(['serverUsername', 'serverPassword']);
        return { username: local.serverUsername || '', password: local.serverPassword || '' };
    },

    /**
     * Save the username and password for Basic authentication to storage.local
     * @param {string} username
     * @param {string} password
     * @returns {Promise<void>}
     */
    async setServerCredentials(username, password) {
        await chrome.storage.local.set({ serverUsername: username || '', serverPassword: password || '' });
    },

    /**
     * Separate credentials from a server URL: "https://user:pass@host" gives "https://host",
     * "user" and "pass"
     * @param {string} apiUrl
     * @returns {{url: string, username: string, password: string}} - url normalized, without credentials
     */
    splitServerUrl(apiUrl) {
        const normalized = this.normalizeServerUrl(apiUrl);
        let url;
        try {
            url = new URL(normalized);
        } catch (e) {
            return { url: normalized, username: '', password: '' };
        }
        if (!url.username && !url.password) {
            return { url: normalized, username: '', password: '' };
        }

        const decode = value => {
            try {
                return decodeURIComponent(value);
            } catch (e) {
                return value; // Not valid percent-encoding: as typed
            }
        };
        const username = decode(url.username);
        const password = decode(url.password);
        url.username = '';
        url.password = '';
        // No "/" added to a URL typed without a path
        const typedPath = normalized.replace(/[?#].*$/, '').endsWith('/');
        const bare = url.pathname === '/' && !url.search && !url.hash && !typedPath
            ? `${url.protocol}//${url.host}`
            : url.href;
        return { url: bare, username, password };
    },

    /**
     * The server URL with a scheme: "ntfy.sh" becomes "https://ntfy.sh"
     * @param {string} apiUrl
     * @returns {string} - '' if no URL is set
     */
    normalizeServerUrl(apiUrl) {
        const url = (apiUrl || '').trim();
        if (!url || /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
            return url;
        }
        return `https://${url}`;
    },

    /**
     * Add ids to a stored id list: no duplicates, and only the newest MAX_STORED_IDS kept
     * @param {string[]} ids
     * @param {string[]} newIds
     * @returns {string[]}
     */
    appendIds(ids, newIds) {
        const added = newIds.filter((id, index) => !ids.includes(id) && newIds.indexOf(id) === index);
        return [...ids, ...added].slice(-this.MAX_STORED_IDS);
    },

    /**
     * Save the access token to storage.local and remove any copy left in storage.sync
     * @param {string} accessToken
     * @returns {Promise<void>}
     */
    async setAccessToken(accessToken) {
        await new Promise(resolve => chrome.storage.local.set({ accessToken: accessToken || '' }, resolve));
        await new Promise(resolve => chrome.storage.sync.remove(['accessToken'], resolve));
    },

    /**
     * Build authorization headers for ntfy API
     * @param {Object} config - Configuration object with accessToken, username and password
     * @returns {Headers}
     */
    buildAuthHeaders(config) {
        const headers = new Headers();
        const auth = this.buildAuthHeaderValue(config);
        if (auth) {
            headers.set('Authorization', auth);
        }
        return headers;
    },

    /**
     * Build the Authorization header value: Bearer token, or else Basic from username and password
     * @param {Object} config - Configuration object with accessToken, username and password
     * @returns {string} - Header value, or '' when there is no authentication
     */
    buildAuthHeaderValue(config) {
        if (config.accessToken) {
            return `Bearer ${config.accessToken}`;
        }
        if (config.username || config.password) {
            return `Basic ${this.base64Encode(`${config.username || ''}:${config.password || ''}`)}`;
        }
        return '';
    },

    /**
     * Whether a URL from a received message is safe to open or copy: http(s) only
     * @param {string} url
     * @returns {boolean}
     */
    isHttpUrl(url) {
        try {
            const protocol = new URL(url).protocol;
            return protocol === 'https:' || protocol === 'http:';
        } catch (e) {
            return false;
        }
    },

    /**
     * Base64-encode a UTF-8 string
     * @param {string} value
     * @returns {string}
     */
    base64Encode(value) {
        return btoa(unescape(encodeURIComponent(value)));
    },

    /**
     * Encode a string as ntfy's ?auth= query parameter expects it: base64url without padding
     * (Go's base64.RawURLEncoding) of the whole Authorization header value
     * @param {string} value
     * @returns {string}
     */
    base64UrlEncode(value) {
        return this.base64Encode(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    /**
     * Host permission match pattern for the server's site, or null for an invalid URL
     * @param {string} apiUrl
     * @returns {string|null}
     */
    serverOriginPattern(apiUrl) {
        try {
            const url = new URL(this.normalizeServerUrl(apiUrl));
            if (url.protocol !== 'https:' && url.protocol !== 'http:') {
                return null;
            }
            // Match patterns have no port and match every port
            return `${url.protocol}//${url.hostname}/*`;
        } catch (e) {
            return null;
        }
    },

    /**
     * fetch for a request to the ntfy server. ntfy's CORS headers let the extension through, but a
     * server behind e.g. a reverse proxy may not. When a request fails without a response, see
     * whether that is the cause (see checkServerAccessBlocked).
     * @param {Object} config - Configuration object with apiUrl and credentials
     * @param {string} url
     * @param {RequestInit} options
     * @returns {Promise<Response>}
     */
    async serverFetch(config, url, options) {
        try {
            return await fetch(url, options);
        } catch (error) {
            await this.checkServerAccessBlocked(config, options && options.headers);
            throw error;
        }
    },

    /**
     * After a request failed without a response: if the server can be reached all the same (a
     * no-cors request gets an answer whatever its CORS headers say), but not by a CORS request with
     * the same headers, its CORS headers blocked the request. A host permission for the server lifts
     * that, so remember the server's site for the settings to offer "Allow access to this server".
     * If the CORS request goes through, the failure had another cause (e.g. a proxy that cut off an
     * upload too large for it, or a dropped connection), which access wouldn't fix.
     * @param {Object} config - Configuration object with apiUrl
     * @param {HeadersInit} [headers] - Headers of the failed request
     * @returns {Promise<void>}
     */
    async checkServerAccessBlocked(config, headers) {
        const pattern = this.serverOriginPattern(config.apiUrl);
        if (!pattern) {
            return;
        }
        let healthUrl;
        try {
            if (await chrome.permissions.contains({ origins: [pattern] })) {
                return;
            }
            healthUrl = `${new URL(this.normalizeServerUrl(config.apiUrl)).origin}/v1/health`;
            await fetch(healthUrl, { mode: 'no-cors' });
        } catch (e) {
            return; // The server can't be reached at all: not a question of access
        }
        try {
            await fetch(healthUrl, { headers });
            return; // Any answer: CORS let it through
        } catch (e) {
            // Blocked
        }
        await chrome.storage.local.set({ serverAccessBlocked: pattern });
    },

    /**
     * Build the full ntfy URL for a topic
     * @param {string} apiUrl - Base ntfy server URL
     * @param {string} topic - Topic name
     * @returns {string}
     */
    buildTopicUrl(apiUrl, topic) {
        const urlObj = new URL(this.normalizeServerUrl(apiUrl));
        return `${urlObj.origin}/${encodeURIComponent(topic)}`;
    },

    /**
     * Send a text notification
     * @param {Object} config - Configuration object with apiUrl and credentials
     * @param {string} topic - Topic to send to
     * @param {Object} options - Notification options
     * @param {string} [options.message] - Message body
     * @param {string} [options.title] - Optional title
     * @param {number} [options.priority] - Optional priority (1-5, default 3)
     * @param {string} [options.tags] - Optional comma-separated tags
     * @returns {Promise<Response>}
     */
    /**
     * Encode header value using RFC 2047 if it contains non-ASCII or control characters
     * @param {string} value - Header value to check and encode
     * @returns {string}
     */
    encodeHeaderValue(value) {
        if (!value) return '';
        // A header value can't hold line breaks (Headers.set throws), so a multi-line message is
        // encoded like non-ASCII text: =?utf-8?B?base64_encoded_value?=, which ntfy decodes
        if (/[^\x20-\x7E\t]/.test(value)) {
            return `=?utf-8?B?${this.base64Encode(value)}?=`;
        }
        return value;
    },

    /**
     * Send a text notification
     * @param {Object} config - Configuration object with apiUrl and credentials
     * @param {string} topic - Topic to send to
     * @param {Object} options - Notification options
     * @param {string} [options.message] - Message body
     * @param {string} [options.title] - Optional title
     * @param {number} [options.priority] - Optional priority (1-5, default 3)
     * @param {string} [options.tags] - Optional comma-separated tags
     * @param {boolean} [options.markdown] - Format the message as Markdown
     * @returns {Promise<Response>}
     */
    async sendNotification(config, topic, { message, title, priority, tags, markdown }) {
        const fullUrl = this.buildTopicUrl(config.apiUrl, topic);
        const headers = this.buildAuthHeaders(config);

        if (title) {
            headers.set('X-Title', this.encodeHeaderValue(title));
        }
        if (priority && priority !== 3) {
            headers.set('X-Priority', priority.toString());
        }
        if (tags) {
            headers.set('X-Tags', this.encodeHeaderValue(tags));
        }
        if (markdown) {
            headers.set('X-Markdown', 'yes');
        }

        const response = await this.serverFetch(config, fullUrl, {
            method: 'POST',
            headers: headers,
            body: message || ''
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        await this.markAsSent(response);
        return response;
    },

    /**
     * Send a file/image as attachment
     * @param {Object} config - Configuration object with apiUrl and credentials
     * @param {string} topic - Topic to send to
     * @param {Object} options - Attachment options
     * @param {ArrayBuffer} options.data - File data as ArrayBuffer
     * @param {string} options.filename - Filename for the attachment
     * @param {string} [options.contentType] - Explicit MIME type for the attachment
     * @param {string} [options.message] - Optional message
     * @param {string} [options.title] - Optional title
     * @param {number} [options.priority] - Optional priority (1-5, default 3)
     * @param {string} [options.tags] - Optional comma-separated tags
     * @param {boolean} [options.markdown] - Format the message as Markdown
     * @returns {Promise<Response>}
     */
    async sendAttachment(config, topic, { data, filename, contentType, message, title, priority, tags, markdown }) {
        const fullUrl = this.buildTopicUrl(config.apiUrl, topic);
        const headers = this.buildAuthHeaders(config);

        headers.set('X-Filename', this.encodeHeaderValue(filename));
        if (contentType) {
            headers.set('Content-Type', contentType);
        }

        if (message) {
            headers.set('X-Message', this.encodeHeaderValue(message));
        }
        if (title) {
            headers.set('X-Title', this.encodeHeaderValue(title));
        }
        if (priority && priority !== 3) {
            headers.set('X-Priority', priority.toString());
        }
        if (tags) {
            headers.set('X-Tags', this.encodeHeaderValue(tags));
        }
        if (markdown) {
            headers.set('X-Markdown', 'yes');
        }

        const response = await this.serverFetch(config, fullUrl, {
            method: 'POST',
            headers: headers,
            body: data
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        await this.markAsSent(response);
        return response;
    },

    /**
     * Fetch an image and send it as attachment
     * @param {Object} config - Configuration object
     * @param {string} topic - Topic to send to
     * @param {string} imageUrl - URL of the image to fetch and send
     * @param {string} [message] - Optional message
     * @param {string} [title] - Optional title
     * @returns {Promise<Response>}
     */
    async sendImageFromUrl(config, topic, imageUrl, message, title) {
        // Fetch the image
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }

        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();

        // Extract filename from URL
        let filename = 'image';
        try {
            const imgUrl = new URL(imageUrl);
            const pathParts = imgUrl.pathname.split('/');
            let lastPart = pathParts[pathParts.length - 1];
            try {
                lastPart = decodeURIComponent(lastPart); // "my%20photo.jpg" is "my photo.jpg"
            } catch (e) {
                // Not valid percent-encoding: keep it as it is
            }
            if (lastPart && lastPart.includes('.')) {
                filename = lastPart;
            } else {
                // Add extension based on mime type: "image/svg+xml" gives "svg"
                const ext = (imageBlob.type.split('/')[1] || '').split('+')[0].split(';')[0].trim() || 'png';
                filename = `image.${ext}`;
            }
        } catch (e) {
            filename = 'image.png';
        }

        return this.sendAttachment(config, topic, { data: imageBuffer, filename, message, title });
    },

    /**
     * Remember a message this extension published, so it shows as read in the message list and gets
     * no desktop notification when it comes back from the server
     * @param {Response} response - ntfy's publish response, the message as JSON
     * @returns {Promise<void>}
     */
    async markAsSent(response) {
        try {
            const { id } = await response.clone().json();
            if (!id) {
                return;
            }
            const { readMessageIds = [], sentMessageIds = [] } =
                await chrome.storage.local.get(['readMessageIds', 'sentMessageIds']);
            await chrome.storage.local.set({
                readMessageIds: this.appendIds(readMessageIds, [id]),
                sentMessageIds: [...sentMessageIds, id].slice(-200)
            });
            // The message can come back over the WebSocket before the publish response arrives
            if (chrome.notifications) {
                chrome.notifications.clear(id);
            }
        } catch (e) {
            // No message JSON in the response: nothing to remember
        }
    },

    /**
     * Check whether the configured credentials can read a topic (ntfy's GET /<topic>/auth)
     * @param {Object} config - Configuration object with apiUrl and credentials
     * @param {string} topic
     * @returns {Promise<boolean|null>} - true or false, or null if the server couldn't be asked
     * @throws {Error} - with status 429 when the server's request limit was reached
     */
    async canReadTopic(config, topic) {
        try {
            const response = await this.serverFetch(config, `${this.buildTopicUrl(config.apiUrl, topic)}/auth`, {
                method: 'GET',
                headers: this.buildAuthHeaders(config)
            });
            if (response.ok) {
                return true;
            }
            if (response.status === 401 || response.status === 403) {
                return false;
            }
            if (response.status === 429) {
                throw Object.assign(new Error('HTTP 429: Too Many Requests'), { status: 429 });
            }
            return null;
        } catch (e) {
            if (e.status === 429) {
                throw e;
            }
            return null;
        }
    },

    /**
     * Fetch cached notifications for a topic
     * @param {Object} config - Configuration object with apiUrl and credentials
     * @param {string} topic - Topic to fetch from
     * @param {string} [since] - Optional since parameter (default 'all')
     * @returns {Promise<Array>} - Array of notification objects
     */
    async getNotifications(config, topic, since = 'all') {
        const baseUrl = config.apiUrl;
        if (!baseUrl) {
            throw new Error('API URL is not configured');
        }

        const fullUrl = `${this.buildTopicUrl(baseUrl, topic)}/json?poll=1&since=${since}`;
        const headers = this.buildAuthHeaders(config);

        const response = await this.serverFetch(config, fullUrl, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw Object.assign(new Error(`HTTP ${response.status}: ${response.statusText}`), { status: response.status });
        }

        const text = await response.text();
        if (!text.trim()) {
            return [];
        }

        // Parse NDJSON
        return text.split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    console.error('Failed to parse notification line:', e, line);
                    return null;
                }
            })
            .filter(Boolean)
            // Filter out non-message events
            .filter(msg => msg.event === 'message');
    }
};
