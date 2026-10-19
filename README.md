# <img src="icons/icon48.png" alt="Logo" width="40" height="40" style="vertical-align: middle;"> Send to ntfy

[![Build Extension](https://github.com/TheDuffman85/send_to_ntfy_extension/actions/workflows/build.yml/badge.svg)](https://github.com/TheDuffman85/send_to_ntfy_extension/actions/workflows/build.yml)

A browser extension to send notifications to, and receive them from, [ntfy.sh](https://ntfy.sh) or your self-hosted ntfy server.

> [!NOTE]
> This is an unofficial extension and is not affiliated with the ntfy.sh project.

## Features

- **Context Menu**: Right-click to send the current page, selected text, an image, or a link directly to ntfy. Sending an image asks for access to its site; access given this way is removed after 30 days without sending from that site.
- **File Upload**: Select multiple files and send them as separate notifications or one ZIP to your ntfy topics.
- **Quick Sharing**: Send the current page URL or custom text to your ntfy topics, with priority, tags, and optional Markdown formatting.
- **Receive Notifications**: Once switched on in the settings, messages from your topics arrive live (WebSocket) as desktop notifications, with an unread count on the icon. Messages published while the browser was closed are fetched when it starts (more than three show as one summary notification). Clicking a notification marks its message as read and opens its click URL, if it has one, or the popup. Messages you send from the extension are marked as read and don't show a desktop notification.
- **One View for Sending and Receiving**: A topic list with unread counts next to the messages of all topics or of the selected one, with mark-as-read and delete actions (stored locally). Links in messages are clickable, message text can be copied, image attachments uploaded to the server show a preview (links to files elsewhere aren't loaded by themselves), and attachments can be downloaded. With a topic selected, a message bar at the bottom sends to it, like in the ntfy web app; its arrow button opens the title, Markdown, priority, tag, and attachment options.
- **Open in ntfy**: Open the selected topic in the ntfy web app.
- **Keyboard Shortcuts**: `Enter` sends from the message bar (`Shift + Enter` for a new line). With the options open, `Enter` starts a new line and `Ctrl + Enter` sends. `Right Ctrl + Enter` sends from anywhere.
- **Custom Configuration**: Support for self-hosted ntfy servers.
- **Authentication**: Optional access token, or username and password; both are stored on the device only.
- **Privacy First**: No tracking; received messages and their read state are stored locally.
- **Modern UI**: Clean interface with light, dark, and automatic themes.
- **Rate-Limit Friendly**: When the server answers with HTTP 429, background requests pause for two minutes, so sending keeps working.
- **Cross-Browser**: Supports Chrome (116+), Firefox (142+), and Edge (Manifest V3).

## Installation

### Official Stores

| Browser | Store Link |
| :--- | :--- |
| **Firefox** | [![Firefox Add-on](https://img.shields.io/badge/Firefox-Available-238636?style=flat-square&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/firefox/addon/send-to-ntfy/) |
| **Chrome** | [![Chrome Web Store](https://img.shields.io/badge/Chrome-Available-238636?style=flat-square&logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/send-to-ntfy/kfiegffaamihidajjcingmognibehdlb) |
| **Edge** | [![Microsoft Edge Add-ons](https://img.shields.io/badge/Edge-Available-238636?style=flat-square&logo=microsoft-edge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/send-to-ntfy/nlcjgpmaicbjkjdicgiaighhlihfhafj) |

### Manual Installation
1. Download the latest release from the [Releases page](https://github.com/TheDuffman85/send_to_ntfy_extension/releases).
2. Unzip the file.
3. Load the unpacked extension in your browser's developer mode (Chrome/Edge: **Load unpacked** on the extensions page; Firefox: **Load Temporary Add-on** on `about:debugging`).

## Configuration & Usage

Open the settings with the gear icon. They are grouped into Server, Topics, Receiving, and Appearance, and changes are saved automatically.

1. **Server URL**: The base URL of your ntfy server, e.g. `https://ntfy.sh` or your self-hosted instance. If the server's CORS headers block the extension's requests (e.g. a reverse proxy in front of ntfy), the settings show **Allow access to this server** after a blocked request: it gives the extension permission for the server's site.
2. **Access Token** or **Username and password**: Optional, for private topics or servers that require authentication. They are stored locally and are not copied to other browsers by browser sync (credentials typed into the server URL, as in `https://user:password@host`, are moved to these fields). With an `http://` server they would be sent unencrypted, which the settings point out.
3. **Topics**: Add the topics to send to. On a public server like ntfy.sh, a topic without access control can be read by anyone who knows or guesses its name, so choose a name that is hard to guess, or reserve the topic, before sending page URLs or selected text to it. The extension receives from the topics your credentials can read; a topic you can only send to is used for sending only.
4. **Receive messages**: Off by default, so the extension only sends until you switch it on. Off, it keeps no live connection and doesn't poll the server, shows no desktop notifications or unread count, and the main view has no message list or **All topics** entry; the send options stay open below the selected topic.
5. **Theme**: Light, dark, or automatic (follows the system).
6. **Popup size**: Small, medium (the default), or large; smaller sizes also use smaller text. Medium and Large use the full height browsers allow for an extension popup (600 pixels), and Large also the full width (800 pixels); browsers don't let you resize a popup by dragging it.

### Sending

- **Message bar**: Select a topic to send to it from the bar at the bottom. The arrow button next to it opens the title, **Format as Markdown**, priority, tags, and attachments; the message field then moves below the title. The link button next to the message field inserts the current tab's URL. A message needs text or an attachment; a title alone isn't sent.
- **Priority and Tags**: The last used priority and tags are remembered for the next message.
- **Attachments**: When multiple files are attached, the extension sends them as separate notifications by default. Enable **Send files as one ZIP** below the attachment list to send all of them in one ZIP attachment instead. The preference is remembered and can be switched at any time.
- **Send another**: Keeps the extension open after sending, for the next message.

## Development

To build the extension locally (requires `node` and `zip`):

```bash
# Build for all browsers (Chrome, Firefox, Edge)
./build.sh

# Or build for a specific browser
./build.sh chrome # also for other Chromium-based browsers like Edge
./build.sh firefox
```

The build output (`send-to-ntfy-chrome.zip`, `send-to-ntfy-firefox.xpi`) is placed in the `build/` directory.

## Screenshots

<table>
  <tr>
    <th>Messages</th>
    <th>Sending, with the options open</th>
  </tr>
  <tr>
    <td valign="top"><img src="screenshots/receive.png" width="400" alt="All topics with the topic list, unread counts, and an image preview"></td>
    <td valign="top"><img src="screenshots/send.png" width="400" alt="Message bar of a topic with title, priority, tags, and two attached files"></td>
  </tr>
  <tr>
    <th>Markdown</th>
    <th>Dark mode</th>
  </tr>
  <tr>
    <td valign="top"><img src="screenshots/markdown.png" width="400" alt="A Markdown message with a heading, table, task list, and code"></td>
    <td valign="top"><img src="screenshots/receive-dark.png" width="400" alt="All topics in dark mode"></td>
  </tr>
  <tr>
    <th>Settings</th>
    <th></th>
  </tr>
  <tr>
    <td valign="top"><img src="screenshots/settings.png" width="400" alt="Settings"></td>
    <td></td>
  </tr>
</table>
