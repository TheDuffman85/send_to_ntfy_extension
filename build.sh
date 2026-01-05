#!/bin/bash

# Create build directory
mkdir -p build

target=$1

# File list to package
FILES="manifest.json popup.html popup.js filepicker.html filepicker.js background.js ntfy.js styles.css icons fonts"

build_chrome() {
  rm -f build/send-to-ntfy-chrome.zip
  echo "Building for Chrome..."
  
  # Create temp config
  TEMP_DIR=$(mktemp -d)
  cp -r $FILES "$TEMP_DIR/"
  
  # create manifest
  node build-manifest.js chrome > "$TEMP_DIR/manifest.json"
  
  # zip
  (cd "$TEMP_DIR" && zip -r "$OLDPWD/build/send-to-ntfy-chrome.zip" .)
  
  rm -rf "$TEMP_DIR"
  echo "Chrome build created at build/send-to-ntfy-chrome.zip"
}

build_firefox() {
  rm -f build/send-to-ntfy-firefox.xpi
  echo "Building for Firefox..."
  
  # Create temp config
  TEMP_DIR=$(mktemp -d)
  cp -r $FILES "$TEMP_DIR/"
  
  # create manifest
  node build-manifest.js firefox > "$TEMP_DIR/manifest.json"
  
  # zip
  (cd "$TEMP_DIR" && zip -r "$OLDPWD/build/send-to-ntfy-firefox.xpi" .)
  
  rm -rf "$TEMP_DIR"
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
