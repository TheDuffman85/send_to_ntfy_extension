// Markdown rendering for received messages (ntfy marks them with content_type "text/markdown").
//
// Safety: the renderer builds the DOM itself and never parses HTML. Message text only ever
// reaches the page as text nodes, element names are fixed in this file, and the only attributes
// set from message content are link targets, which must be http(s) URLs. Raw HTML in a message
// therefore shows as text. Images are not loaded (no tracking pixels or requests to other hosts),
// they become links. Nesting and input size are bounded, and every scan is linear or cached, so
// a crafted message can't hang the popup.
//
// Loaded by the popup and by the background (Chrome and Edge service worker, Firefox background
// scripts), so it must not touch the DOM when loaded; only render() uses document.

const Markdown = (() => {
    const MAX_LENGTH = 32 * 1024; // Longer messages are shown as plain text
    const MAX_DEPTH = 8; // Nesting of quotes, lists and inline formatting
    const MAX_DESTINATION_LENGTH = 2048; // Of a link's "(url "title")", so failed links can't make parsing quadratic

    const FENCE = /^ {0,3}(`{3,}|~{3,})/;
    const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
    const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
    const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
    const BLOCKQUOTE = /^ {0,3}> ?/;
    const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
    const TASK_MARKER = /^\[([ xX])\][ \t]+/;
    const DELIMITER_CELL = /^:?-+:?$/;
    const BARE_URL = /https?:\/\/[^\s<>"']+/y;
    const AUTOLINK = /<(https?:\/\/[^\s<>]*)>/y;
    const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

    function el(options, tag, className) {
        const node = options.dom.createElement(tag);
        if (className) {
            node.className = className;
        }
        return node;
    }

    function safeHttpUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
        } catch (e) {
            return null;
        }
    }

    function indentOf(line) {
        return line.length - line.trimStart().length;
    }

    function isBlank(line) {
        return !line.trim();
    }

    // ==================
    // Blocks
    // ==================

    function isFenceClose(line, fence) {
        const match = FENCE.exec(line);
        return Boolean(match) && match[1][0] === fence[0] && match[1].length >= fence.length &&
            isBlank(line.slice(match[0].length));
    }

    // Lines that end a paragraph without a blank line in between
    function interruptsParagraph(line) {
        if (FENCE.test(line) || HEADING.test(line) || THEMATIC_BREAK.test(line) || BLOCKQUOTE.test(line)) {
            return true;
        }
        // Like CommonMark: only non-empty items, and numbered ones only from 1, so "2024. was ..." stays text
        const item = LIST_ITEM.exec(line);
        return Boolean(item) && Boolean(item[3]) && !isBlank(line.slice(item[0].length)) &&
            (!/\d/.test(item[2][0]) || parseInt(item[2], 10) === 1);
    }

    // Cells of a table row; "\|" is a literal pipe
    function splitRow(line) {
        let row = line.trim();
        if (row.startsWith('|')) {
            row = row.slice(1);
        }
        if (row.endsWith('|') && !row.endsWith('\\|')) {
            row = row.slice(0, -1);
        }
        const cells = [];
        let cell = '';
        for (let i = 0; i < row.length; i++) {
            if (row[i] === '\\' && row[i + 1] === '|') {
                cell += '|';
                i++;
            } else if (row[i] === '|') {
                cells.push(cell.trim());
                cell = '';
            } else {
                cell += row[i];
            }
        }
        cells.push(cell.trim());
        return cells;
    }

    // Column alignments if the lines at index start a table (header row, then a delimiter row)
    function tableAlignments(lines, index) {
        if (index + 1 >= lines.length || !lines[index].includes('|') || !lines[index + 1].includes('-')) {
            return null;
        }
        const delimiters = splitRow(lines[index + 1]);
        if (!delimiters.every(cell => DELIMITER_CELL.test(cell)) ||
            delimiters.length !== splitRow(lines[index]).length) {
            return null;
        }
        return delimiters.map(cell => {
            const left = cell.startsWith(':');
            const right = cell.endsWith(':');
            return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
        });
    }

    function renderBlocks(lines, depth, options) {
        if (depth >= MAX_DEPTH) {
            const paragraph = el(options, 'p');
            paragraph.textContent = lines.join('\n');
            return [paragraph];
        }

        const nodes = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            let match;

            if (isBlank(line)) {
                i++;
                continue;
            }

            if ((match = FENCE.exec(line))) {
                const fence = match[1];
                const indent = indentOf(line);
                const body = [];
                for (i++; i < lines.length && !isFenceClose(lines[i], fence); i++) {
                    body.push(lines[i].slice(Math.min(indent, indentOf(lines[i]))));
                }
                i++; // Closing fence; an unclosed block runs to the end
                const pre = el(options, 'pre');
                const code = el(options, 'code');
                code.textContent = body.join('\n');
                pre.appendChild(code);
                nodes.push(pre);
                continue;
            }

            if ((match = HEADING.exec(line))) {
                const heading = el(options, `h${match[1].length}`);
                heading.append(...renderInline(stripClosingHashes(match[2] || ''), depth, options));
                nodes.push(heading);
                i++;
                continue;
            }

            if (THEMATIC_BREAK.test(line)) {
                nodes.push(el(options, 'hr'));
                i++;
                continue;
            }

            if (BLOCKQUOTE.test(line)) {
                const inner = [];
                for (; i < lines.length && BLOCKQUOTE.test(lines[i]); i++) {
                    inner.push(lines[i].replace(BLOCKQUOTE, ''));
                }
                const quote = el(options, 'blockquote');
                quote.append(...renderBlocks(inner, depth + 1, options));
                nodes.push(quote);
                continue;
            }

            if (LIST_ITEM.test(line)) {
                i = renderList(lines, i, depth, options, nodes);
                continue;
            }

            const alignments = tableAlignments(lines, i);
            if (alignments) {
                i = renderTable(lines, i, alignments, depth, options, nodes);
                continue;
            }

            // Paragraph, or a heading underlined with === or ---
            const paragraph = [line.trim()];
            let headingLevel = 0;
            for (i++; i < lines.length && !isBlank(lines[i]); i++) {
                if ((match = SETEXT_UNDERLINE.exec(lines[i]))) {
                    headingLevel = match[1][0] === '=' ? 1 : 2;
                    i++;
                    break;
                }
                if (interruptsParagraph(lines[i]) || tableAlignments(lines, i)) {
                    break;
                }
                paragraph.push(lines[i].trim());
            }
            const block = el(options, headingLevel ? `h${headingLevel}` : 'p');
            block.append(...renderInline(paragraph.join('\n'), depth, options));
            nodes.push(block);
        }
        return nodes;
    }

    function stripClosingHashes(text) {
        const trimmed = text.trim();
        let end = trimmed.length;
        while (end > 0 && trimmed[end - 1] === '#') {
            end--;
        }
        if (end === 0) {
            return '';
        }
        return end < trimmed.length && /[ \t]/.test(trimmed[end - 1]) ? trimmed.slice(0, end).trim() : trimmed;
    }

    // Renders the list starting at lines[start] into nodes; returns the index after it
    function renderList(lines, start, depth, options, nodes) {
        const first = LIST_ITEM.exec(lines[start]);
        const ordered = /\d/.test(first[2][0]);
        const marker = first[2].slice(-1); // A different bullet or delimiter starts a new list
        const list = el(options, ordered ? 'ol' : 'ul');
        if (ordered && parseInt(first[2], 10) !== 1) {
            list.start = parseInt(first[2], 10);
        }

        let i = start;
        while (i < lines.length) {
            // Blank lines between items keep the list going
            let next = i;
            while (next < lines.length && isBlank(lines[next])) {
                next++;
            }
            const match = next < lines.length ? LIST_ITEM.exec(lines[next]) : null;
            if (!match || match[2].slice(-1) !== marker || /\d/.test(match[2][0]) !== ordered) {
                break;
            }
            i = next;

            // Content starts after the marker and its spaces (one space if there are more than four)
            const spaces = match[3].length;
            const contentIndent = match[1].length + match[2].length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
            const itemLines = [lines[i].slice(Math.min(contentIndent, lines[i].length))];
            for (i++; i < lines.length;) {
                const line = lines[i];
                if (isBlank(line)) {
                    // A blank line continues the item only if indented content follows
                    let after = i + 1;
                    while (after < lines.length && isBlank(lines[after])) {
                        after++;
                    }
                    if (after < lines.length && indentOf(lines[after]) >= contentIndent) {
                        for (; i < after; i++) {
                            itemLines.push('');
                        }
                        continue;
                    }
                    break;
                }
                if (indentOf(line) >= contentIndent) {
                    itemLines.push(line.slice(contentIndent));
                } else if (!isBlank(itemLines[itemLines.length - 1]) && !interruptsParagraph(line) &&
                    !LIST_ITEM.test(line)) {
                    itemLines.push(line); // Lazy continuation of the item's text
                } else {
                    break;
                }
                i++;
            }

            const item = el(options, 'li');
            const task = TASK_MARKER.exec(itemLines[0]);
            if (task) {
                itemLines[0] = itemLines[0].slice(task[0].length);
                item.className = 'task-item';
            }
            item.append(...renderBlocks(itemLines, depth + 1, options));
            if (task) {
                const checkbox = el(options, 'input');
                checkbox.type = 'checkbox';
                checkbox.disabled = true;
                checkbox.checked = task[1] !== ' ';
                const target = item.firstChild && item.firstChild.nodeName === 'P' ? item.firstChild : item;
                target.prepend(checkbox);
            }
            list.appendChild(item);
        }
        nodes.push(list);
        return i;
    }

    // Renders the table starting at lines[start] into nodes; returns the index after it
    function renderTable(lines, start, alignments, depth, options, nodes) {
        const table = el(options, 'table');
        const addRow = (parent, cells, tag) => {
            const row = el(options, 'tr');
            alignments.forEach((alignment, column) => {
                const cell = el(options, tag);
                if (alignment) {
                    cell.style.textAlign = alignment;
                }
                cell.append(...renderInline(cells[column] || '', depth, options));
                row.appendChild(cell);
            });
            parent.appendChild(row);
        };

        const head = el(options, 'thead');
        addRow(head, splitRow(lines[start]), 'th');
        table.appendChild(head);

        const body = el(options, 'tbody');
        let i = start + 2;
        for (; i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines[i]); i++) {
            addRow(body, splitRow(lines[i]), 'td');
        }
        if (body.childNodes.length > 0) {
            table.appendChild(body);
        }

        const wrapper = el(options, 'div', 'markdown-table'); // Scrolls sideways instead of widening the popup
        wrapper.appendChild(table);
        nodes.push(wrapper);
        return i;
    }

    // ==================
    // Inline
    // ==================

    // Index of the matching "]" for each "[" (escaped brackets don't count), in one pass
    function matchBrackets(text) {
        const matches = new Map();
        const open = [];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\\') {
                i++;
            } else if (text[i] === '[') {
                open.push(i);
            } else if (text[i] === ']' && open.length > 0) {
                matches.set(open.pop(), i);
            }
        }
        return matches;
    }

    // The "(destination "title")" right after a link's "]"; returns { url, end } or null
    function parseDestination(fullText, start) {
        if (fullText[start] !== '(') {
            return null;
        }
        const text = fullText.slice(0, start + MAX_DESTINATION_LENGTH);
        let i = start + 1;
        while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') {
            i++;
        }

        let destination = '';
        if (text[i] === '<') {
            for (i++; i < text.length && text[i] !== '>'; i++) {
                if (text[i] === '\n' || text[i] === '<') {
                    return null;
                }
                if (text[i] === '\\' && ASCII_PUNCTUATION.includes(text[i + 1])) {
                    i++;
                }
                destination += text[i];
            }
            if (text[i] !== '>') {
                return null;
            }
            i++;
        } else {
            let parentheses = 0;
            for (; i < text.length && !isWhitespace(text[i]); i++) {
                if (text[i] === '\\' && ASCII_PUNCTUATION.includes(text[i + 1])) {
                    i++;
                } else if (text[i] === '(') {
                    parentheses++;
                } else if (text[i] === ')') {
                    if (parentheses === 0) {
                        break;
                    }
                    parentheses--;
                }
                destination += text[i];
            }
        }

        // Optional title, which isn't used: links show their target URL as tooltip instead
        let afterDestination = i;
        while (text[afterDestination] === ' ' || text[afterDestination] === '\t' || text[afterDestination] === '\n') {
            afterDestination++;
        }
        const quote = { '"': '"', '\'': '\'', '(': ')' }[text[afterDestination]];
        if (quote && afterDestination > i) {
            i = afterDestination + 1;
            while (i < text.length && text[i] !== quote) {
                i += text[i] === '\\' ? 2 : 1;
            }
            if (i >= text.length) {
                return null;
            }
            i++;
        }
        while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') {
            i++;
        }
        return text[i] === ')' ? { url: destination, end: i + 1 } : null;
    }

    function isWhitespace(char) {
        return char === ' ' || char === '\t' || char === '\n';
    }

    function runLength(text, start, char) {
        let end = start;
        while (text[end] === char) {
            end++;
        }
        return end - start;
    }

    function isWordChar(char) {
        return Boolean(char) && /[\p{L}\p{N}]/u.test(char);
    }

    function renderInline(text, depth, options) {
        if (depth >= MAX_DEPTH) {
            return [options.dom.createTextNode(text)];
        }

        const nodes = [];
        let buffer = '';
        const flush = () => {
            if (buffer) {
                nodes.push(options.dom.createTextNode(buffer));
                buffer = '';
            }
        };
        const brackets = matchBrackets(text);
        // Delimiters with no closer after some position have none after any later one either
        const unclosed = new Set();

        let i = 0;
        while (i < text.length) {
            const char = text[i];

            if (char === '\\' && text[i + 1] === '\n') {
                flush();
                nodes.push(el(options, 'br'));
                i += 2;
                continue;
            }
            if (char === '\\' && ASCII_PUNCTUATION.includes(text[i + 1])) {
                buffer += text[i + 1];
                i += 2;
                continue;
            }
            if (char === '\n') {
                flush();
                nodes.push(el(options, 'br'));
                i++;
                continue;
            }

            if (char === '`') {
                const length = runLength(text, i, '`');
                const close = unclosed.has(`\`${length}`) ? -1 : findBacktickClose(text, i + length, length);
                if (close === -1) {
                    unclosed.add(`\`${length}`);
                    buffer += text.slice(i, i + length);
                    i += length;
                    continue;
                }
                let content = text.slice(i + length, close).replace(/\n/g, ' ');
                if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim()) {
                    content = content.slice(1, -1);
                }
                flush();
                const code = el(options, 'code');
                code.textContent = content;
                nodes.push(code);
                i = close + length;
                continue;
            }

            if (char === '[' || (char === '!' && text[i + 1] === '[')) {
                const isImage = char === '!';
                const open = isImage ? i + 1 : i;
                const close = brackets.get(open);
                const destination = close !== undefined ? parseDestination(text, close + 1) : null;
                if (destination) {
                    const label = text.slice(open + 1, close);
                    const url = options.links ? safeHttpUrl(destination.url) : null;
                    // Image labels are plain alt text; link labels can't contain further links
                    const labelNodes = isImage
                        ? [options.dom.createTextNode(label.trim() || destination.url)]
                        : renderInline(label, depth + 1, { ...options, links: false });
                    flush();
                    if (url) {
                        nodes.push(options.createLink(url, labelNodes));
                    } else {
                        nodes.push(...labelNodes); // Not an http(s) link: keep only its text
                    }
                    i = destination.end;
                    continue;
                }
            }

            if (char === '<' && options.links) {
                AUTOLINK.lastIndex = i;
                const match = AUTOLINK.exec(text);
                const url = match && safeHttpUrl(match[1]);
                if (url) {
                    flush();
                    nodes.push(options.createLink(url, [options.dom.createTextNode(match[1])]));
                    i += match[0].length;
                    continue;
                }
            }

            if (char === 'h' && options.links && !isWordChar(text[i - 1])) {
                BARE_URL.lastIndex = i;
                const match = BARE_URL.exec(text);
                // Leave trailing punctuation and formatting out of the link, e.g. a full stop after the URL
                const raw = match ? match[0].replace(/[.,;:!?)\]}*_~]+$/, '') : '';
                const url = raw && safeHttpUrl(raw);
                if (url) {
                    flush();
                    nodes.push(options.createLink(url, [options.dom.createTextNode(raw)]));
                    i += raw.length;
                    continue;
                }
            }

            if (char === '*' || char === '_' || char === '~') {
                const length = runLength(text, i, char);
                const emphasis = findEmphasis(text, i, length, unclosed);
                if (emphasis) {
                    flush();
                    const tag = char === '~' ? 'del' : emphasis.size === 2 ? 'strong' : 'em';
                    const element = el(options, tag);
                    element.append(...renderInline(text.slice(i + emphasis.size, emphasis.close), depth + 1, options));
                    nodes.push(element);
                    i = emphasis.close + emphasis.size;
                    continue;
                }
                buffer += text.slice(i, i + length);
                i += length;
                continue;
            }

            buffer += char;
            i++;
        }
        flush();
        return nodes;
    }

    // Start of the next run of exactly length backticks at or after from, or -1
    function findBacktickClose(text, from, length) {
        let index = text.indexOf('`', from);
        while (index !== -1) {
            const run = runLength(text, index, '`');
            if (run === length) {
                return index;
            }
            index = text.indexOf('`', index + run);
        }
        return -1;
    }

    // Emphasis opened by the delimiter run at start: ** or __ (strong), * or _ (em), ~~ (strikethrough).
    // Returns { size, close } with the index of the closing delimiter, or null.
    function findEmphasis(text, start, length, unclosed) {
        const char = text[start];
        const sizes = char === '~' ? (length === 2 ? [2] : []) : length >= 2 ? [2, 1] : [1];
        // An opener is followed by non-space; "_" doesn't open inside a word (snake_case)
        if (!text[start + length] || /\s/.test(text[start + length]) || (char === '_' && isWordChar(text[start - 1]))) {
            return null;
        }
        for (const size of sizes) {
            const delimiter = char.repeat(size);
            if (unclosed.has(delimiter)) {
                continue;
            }
            let index = text.indexOf(delimiter, start + length);
            while (index !== -1) {
                const runEnd = index + runLength(text, index, char);
                const close = runEnd - size; // Close with the end of a longer run, e.g. ***bold italic***
                const valid = !/\s/.test(text[index - 1]) && (char !== '_' || !isWordChar(text[runEnd])) &&
                    (char !== '~' || runEnd - index === 2);
                if (valid && close > start + size) {
                    return { size, close };
                }
                index = text.indexOf(delimiter, runEnd);
            }
            unclosed.add(delimiter);
        }
        return null;
    }

    // ==================
    // Plain text
    // ==================

    // Just enough of the DOM for the renderer, so plain text also works without a document
    // (Chrome's and Edge's background service worker has none)
    class PlainNode {
        constructor(nodeName, value = '') {
            this.nodeName = nodeName;
            this.value = value;
            this.childNodes = [];
            this.style = {};
        }

        get firstChild() {
            return this.childNodes[0] || null;
        }

        append(...nodes) {
            this.childNodes.push(...nodes);
        }

        appendChild(node) {
            this.childNodes.push(node);
            return node;
        }

        prepend(node) {
            this.childNodes.unshift(node);
        }

        set textContent(value) {
            this.childNodes = [new PlainNode('#text', String(value))];
        }
    }

    const plainDom = {
        createElement: tag => new PlainNode(tag.toUpperCase()),
        createTextNode: value => new PlainNode('#text', String(value))
    };

    // Elements whose children are blocks, one per line
    const CONTAINERS = new Set(['#root', 'BLOCKQUOTE', 'LI', 'DIV', 'TABLE', 'THEAD', 'TBODY']);

    function plainText(node) {
        switch (node.nodeName) {
            case '#text':
                return node.value;
            case 'BR':
                return '\n';
            case 'HR':
                return '———';
            case 'INPUT':
                return node.checked ? '☑ ' : '☐ ';
            case 'UL':
            case 'OL':
                return node.childNodes.map((item, index) => {
                    const marker = node.nodeName === 'OL' ? `${(node.start || 1) + index}. ` : '• ';
                    // Nested lines line up under the item's text
                    return marker + plainText(item).replace(/\n/g, `\n${' '.repeat(marker.length)}`);
                }).join('\n');
            case 'TR':
                return node.childNodes.map(plainText).join(' | ');
        }
        if (CONTAINERS.has(node.nodeName)) {
            return node.childNodes.map(plainText).filter(Boolean).join('\n');
        }
        return node.childNodes.map(plainText).join('');
    }

    function toLines(text) {
        return text.replace(/\r\n?/g, '\n').split('\n')
            .map(line => line.replace(/^\t+/, tabs => '    '.repeat(tabs.length)));
    }

    /**
     * Renders Markdown into DOM nodes.
     * @param {string} text
     * @param {Object} options
     * @param {function(string, Node[]): Node} options.createLink - Builds a link to an http(s) URL with the given content
     * @returns {Node[]|null} The nodes, or null if the text is too long to render
     */
    function render(text, { createLink }) {
        if (text.length > MAX_LENGTH) {
            return null;
        }
        return renderBlocks(toLines(text), 0, { dom: document, createLink, links: true });
    }

    /**
     * The text of a Markdown message without its formatting, e.g. for a desktop notification.
     * Links become their text. Works without a DOM.
     * @param {string} text
     * @returns {string} The plain text, or the text unchanged if it is too long to render
     */
    function toPlainText(text) {
        if (text.length > MAX_LENGTH) {
            return text;
        }
        const root = new PlainNode('#root');
        const createLink = (url, content) => {
            const link = plainDom.createElement('a');
            link.append(...content);
            return link;
        };
        root.append(...renderBlocks(toLines(text), 0, { dom: plainDom, createLink, links: true }));
        return plainText(root).trim();
    }

    return { render, toPlainText };
})();

globalThis.Markdown = Markdown;
