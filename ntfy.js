// Shared ntfy API utilities
// Used by both popup.js and background.js

const NtfyAPI = {
    /**
     * Get configuration from storage
     * @returns {Promise<{apiUrl: string, accessToken: string, topics: string[]}>}
     */
    async getConfig() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['apiUrl', 'accessToken', 'topics'], (items) => {
                resolve({
                    apiUrl: items.apiUrl || '',
                    accessToken: items.accessToken || '',
                    topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : []
                });
            });
        });
    },

    /**
     * Build authorization headers for ntfy API
     * @param {string} accessToken - Bearer token for authentication
     * @returns {Headers}
     */
    buildAuthHeaders(accessToken) {
        const headers = new Headers();
        if (accessToken) {
            headers.set('Authorization', `Bearer ${accessToken}`);
        }
        return headers;
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
        const headers = this.buildAuthHeaders(config.accessToken);

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
        const headers = this.buildAuthHeaders(config.accessToken);

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
    async sendImageFromUrl(config, topic, imageUrl) {
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

        return this.sendAttachment(config, topic, { data: imageBuffer, filename });
    }
};
