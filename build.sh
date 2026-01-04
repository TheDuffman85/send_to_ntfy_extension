#!/bin/bash

# Create build directory
mkdir -p build

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
  rm -f build/send-to-ntfy-firefox.zip
  echo "Building for Firefox..."
  zip -r build/send-to-ntfy-firefox.zip $FILES
  echo "Firefox build created at build/send-to-ntfy-firefox.zip"
}

build_edge() {
  rm -f build/send-to-ntfy-edge.zip
  echo "Building for Edge..."
  zip -r build/send-to-ntfy-edge.zip $FILES
  echo "Edge build created at build/send-to-ntfy-edge.zip"
}

if [ -z "$target" ]; then
  build_chrome
  build_firefox
  build_edge
elif [ "$target" == "chrome" ]; then
  build_chrome
elif [ "$target" == "firefox" ]; then
  build_firefox
elif [ "$target" == "edge" ]; then
  build_edge
else
  echo "Usage: ./build.sh [chrome|firefox|edge]"
  exit 1
fi

echo "Build complete!"
