#!/bin/bash

# Create build directory
mkdir -p build

target=$1

# File list to package
FILES="manifest.json popup.html popup.js filepicker.html filepicker.js styles.css icons fonts"

build_chrome() {
  rm -f build/send-to-ntfy-chrome.zip
  echo "Building for Chrome..."
  zip -r build/send-to-ntfy-chrome.zip $FILES
  echo "Chrome build created at build/send-to-ntfy-chrome.zip"
}

build_firefox() {
  rm -f build/send-to-ntfy-firefox.xpi
  echo "Building for Firefox..."
  zip -r build/send-to-ntfy-firefox.xpi $FILES
  echo "Firefox build created at build/send-to-ntfy-firefox.xpi"
}

if [ -z "$target" ]; then
  build_chrome
  build_firefox
elif [ "$target" == "chrome" ]; then
  build_chrome
elif [ "$target" == "firefox" ]; then
  build_firefox
else
  echo "Usage: ./build.sh [chrome|firefox]"
  exit 1
fi

echo "Build complete!"
