// Shared ntfy API utilities
// Used by both popup.js and background.js

const NtfyAPI = {
    /**
     * Get configuration from storage
     * @returns {Promise<{apiUrl: string, accessToken: string, topics: string[]}>}
     */
    async getConfig() {
        const accessToken = await this.getAccessToken();
        return new Promise((resolve) => {
            chrome.storage.sync.get(['apiUrl', 'topics', 'includeUrl'], (items) => {
                resolve({
                    apiUrl: items.apiUrl || '',
                    accessToken: accessToken,
                    topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : [],
                    includeUrl: items.includeUrl === true
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
     * @param {string} accessToken - Bearer token for authentication
     * @returns {Headers}
     */
    buildAuthHeaders(accessToken, apiUrl) {
        const headers = new Headers();
        const auth = this.buildAuthHeaderValue(accessToken, apiUrl);
        if (auth) {
            headers.set('Authorization', auth);
        }
        return headers;
    },

    /**
     * Build the Authorization header value: Bearer token, or Basic from credentials embedded in the URL
     * @param {string} accessToken - Bearer token for authentication
     * @param {string} apiUrl - Server URL, may contain user:password@
     * @returns {string} - Header value, or '' when there is no authentication
     */
    buildAuthHeaderValue(accessToken, apiUrl) {
        if (accessToken) {
            return `Bearer ${accessToken}`;
        }
        if (apiUrl) {
            try {
                const url = new URL(apiUrl);
                if (url.username || url.password) {
                    const username = decodeURIComponent(url.username);
                    const password = decodeURIComponent(url.password);
                    return `Basic ${this.base64Encode(`${username}:${password}`)}`;
                }
            } catch (e) {
                // Invalid URL: no authentication
            }
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
     * Build the full ntfy URL for a topic
     * @param {string} apiUrl - Base ntfy server URL
     * @param {string} topic - Topic name
     * @returns {string}
     */
    buildTopicUrl(apiUrl, topic) {
        const urlObj = new URL(apiUrl);
        return `${urlObj.origin}/${topic}`;
    },

    /**
     * Send a text notification
     * @param {Object} config - Configuration object with apiUrl and accessToken
     * @param {string} topic - Topic to send to
     * @param {Object} options - Notification options
     * @param {string} [options.message] - Message body
     * @param {string} [options.title] - Optional title
     * @param {number} [options.priority] - Optional priority (1-5, default 3)
     * @param {string} [options.tags] - Optional comma-separated tags
     * @returns {Promise<Response>}
     */
    /**
     * Encode header value using RFC 2047 if it contains non-ASCII characters
     * @param {string} value - Header value to check and encode
     * @returns {string}
     */
    encodeHeaderValue(value) {
        if (!value) return '';
        // Check for non-ASCII characters
        if (/[^\x00-\x7F]/.test(value)) {
            // Encode using RFC 2047: =?utf-8?B?base64_encoded_value?=
            // btoa(unescape(encodeURIComponent(value))) is the robust way to b64 encode utf8 strings in browser
            const encoded = btoa(unescape(encodeURIComponent(value)));
            return `=?utf-8?B?${encoded}?=`;
        }
        return value;
    },

    /**
     * Send a text notification
     * @param {Object} config - Configuration object with apiUrl and accessToken
     * @param {string} topic - Topic to send to
     * @param {Object} options - Notification options
     * @param {string} [options.message] - Message body
     * @param {string} [options.title] - Optional title
     * @param {number} [options.priority] - Optional priority (1-5, default 3)
     * @param {string} [options.tags] - Optional comma-separated tags
     * @returns {Promise<Response>}
     */
    async sendNotification(config, topic, { message, title, priority, tags }) {
        const fullUrl = this.buildTopicUrl(config.apiUrl, topic);
        const headers = this.buildAuthHeaders(config.accessToken, config.apiUrl);

        if (title) {
            headers.set('X-Title', this.encodeHeaderValue(title));
        }
        if (priority && priority !== 3) {
            headers.set('X-Priority', priority.toString());
        }
        if (tags) {
            headers.set('X-Tags', this.encodeHeaderValue(tags));
        }

        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: headers,
            body: message || ''
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
    },

    /**
     * Send a file/image as attachment
     * @param {Object} config - Configuration object with apiUrl and accessToken
     * @param {string} topic - Topic to send to
     * @param {Object} options - Attachment options
     * @param {ArrayBuffer} options.data - File data as ArrayBuffer
     * @param {string} options.filename - Filename for the attachment
     * @param {string} [options.message] - Optional message
     * @param {string} [options.title] - Optional title
     * @param {number} [options.priority] - Optional priority (1-5, default 3)
     * @param {string} [options.tags] - Optional comma-separated tags
     * @returns {Promise<Response>}
     */
    async sendAttachment(config, topic, { data, filename, message, title, priority, tags }) {
        const fullUrl = this.buildTopicUrl(config.apiUrl, topic);
        const headers = this.buildAuthHeaders(config.accessToken, config.apiUrl);

        headers.set('X-Filename', this.encodeHeaderValue(filename));

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

        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: headers,
            body: data
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
    },

    /**
     * Fetch an image and send it as attachment
     * @param {Object} config - Configuration object
     * @param {string} topic - Topic to send to
     * @param {string} imageUrl - URL of the image to fetch and send
     * @returns {Promise<Response>}
     */
    async sendImageFromUrl(config, topic, imageUrl, message) {
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
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart && lastPart.includes('.')) {
                filename = lastPart;
            } else {
                // Add extension based on mime type
                const ext = imageBlob.type.split('/')[1] || 'png';
                filename = `image.${ext}`;
            }
        } catch (e) {
            filename = 'image.png';
        }

        return this.sendAttachment(config, topic, { data: imageBuffer, filename, message });
    },

    /**
     * Check whether the configured credentials can read a topic (ntfy's GET /<topic>/auth)
     * @param {Object} config - Configuration object with apiUrl and accessToken
     * @param {string} topic
     * @returns {Promise<boolean|null>} - true or false, or null if the server couldn't be asked
     */
    async canReadTopic(config, topic) {
        try {
            const response = await fetch(`${this.buildTopicUrl(config.apiUrl, topic)}/auth`, {
                method: 'GET',
                headers: this.buildAuthHeaders(config.accessToken, config.apiUrl)
            });
            if (response.ok) {
                return true;
            }
            if (response.status === 401 || response.status === 403) {
                return false;
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    /**
     * Fetch cached notifications for a topic
     * @param {Object} config - Configuration object with apiUrl and accessToken
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
        const headers = this.buildAuthHeaders(config.accessToken, baseUrl);

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
