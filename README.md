# <img src="icons/icon48.png" alt="Logo" width="40" height="40" style="vertical-align: middle;"> Send to ntfy

[![Build Extension](https://github.com/TheDuffman85/send_to_ntfy_extension/actions/workflows/build.yml/badge.svg)](https://github.com/TheDuffman85/send_to_ntfy_extension/actions/workflows/build.yml)

A browser extension to send notifications to, and receive them from, [ntfy.sh](https://ntfy.sh) or your self-hosted ntfy server.

> [!NOTE]
> This is an unofficial extension and is not affiliated with the ntfy.sh project.

## Features

- **Context Menu**: Right-click to send the current page, selected text, an image, or a link directly to ntfy.
- **File Upload**: Select multiple files and send them as separate notifications or one ZIP to your ntfy topics.
- **Quick Sharing**: Send the current page URL or custom text to your ntfy topics, with priority and tags.
- **Receive Notifications**: Messages from your topics arrive live (WebSocket) as desktop notifications, with an unread count on the icon. Messages published while the browser was closed are fetched when it starts. Messages you send from the extension are marked as read and don't show a desktop notification.
- **Received Messages List**: The Receive tab lists the messages of all topics, with a topic list to filter them, unread counts, and mark-as-read and delete actions (stored locally). Links in messages are clickable, image attachments show a preview, and attachments can be downloaded.
- **Open in a Tab**: Open the extension in a browser tab for a larger view, or open the selected topic in the ntfy web app.
- **Keyboard Shortcuts**: Send messages quickly with `Right Ctrl + Enter`.
- **Custom Configuration**: Support for self-hosted ntfy servers.
- **Authentication**: Optional support for token-based authentication.
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

Open the settings with the gear icon. Changes are saved automatically.

1. **Server URL**: The base URL of your ntfy server, e.g. `https://ntfy.sh` or your self-hosted instance.
2. **Access Token**: Optional, for private topics or servers that require authentication. It is stored locally and is not copied to other browsers by browser sync. With a token (or credentials in the server URL), click **Allow access to this server**: ntfy's CORS headers don't allow the `Authorization` header, so the extension needs permission for the server's site.
3. **Topics**: Add the topics to send to. The extension receives from the topics your credentials can read; a topic you can only send to is used for sending only.
4. **Include current tab's URL**: Puts the page URL in the message title. In the extension's tab, **Use tab URL** fills in the page you were on last (it asks once for permission to read tabs).
5. **Default Tab**: Whether the extension opens on the **Send** or the **Receive** tab.
6. **Appearance**: Light, dark, or automatic (follows the system).

### Sending

- **Priority and Tags**: Set them under **Advanced options**. The last used priority and tags are remembered for the next message.
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
    <th>Send</th>
    <th>Settings</th>
  </tr>
  <tr>
    <td valign="top"><img src="screenshots/send.png" width="400" alt="Send tab with two attached files"></td>
    <td valign="top"><img src="screenshots/settings.png" width="400" alt="Settings"></td>
  </tr>
  <tr>
    <th>Receive</th>
    <th>Dark mode</th>
  </tr>
  <tr>
    <td valign="top"><img src="screenshots/receive.png" width="400" alt="Receive tab with the topic list, unread counts, and an image preview"></td>
    <td valign="top"><img src="screenshots/receive-dark.png" width="400" alt="Receive tab in dark mode"></td>
  </tr>
</table>
