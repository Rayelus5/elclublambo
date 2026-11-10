#!/usr/bin/env bash
# Each captured scene (capture/frames/<scene>/f00000.png…, 60 fps) becomes public/footage/<scene>.mp4 for the edit:
# H.264 at near-lossless quality with a keyframe every half second, so Remotion seeks fast.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/footage
for dir in capture/frames/*/; do
  name=$(basename "$dir")
  [ -f "$dir/f00000.png" ] || continue
  if [ "${1:-}" != "" ] && [ "$1" != "$name" ]; then continue; fi
  ffmpeg -v error -y -framerate 60 -i "$dir/f%05d.png" -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -g 30 -movflags +faststart "public/footage/$name.mp4"
  echo "$name: $(ls "$dir" | wc -l) frames -> public/footage/$name.mp4"
done
