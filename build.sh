#!/bin/bash
# Install yt-dlp and ffmpeg on Render
echo "Installing yt-dlp..."
pip install --user yt-dlp 2>/dev/null || pip3 install --user yt-dlp 2>/dev/null || {
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
}

echo "Installing ffmpeg..."
apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null || {
  echo "ffmpeg already available or using alternative method"
}

echo "yt-dlp version:"
yt-dlp --version 2>/dev/null || ~/.local/bin/yt-dlp --version

echo "ffmpeg version:"
ffmpeg -version 2>/dev/null | head -1

echo "Build complete!"
