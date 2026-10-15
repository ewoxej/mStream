#!/bin/sh
# mstream-zenelo container start: write a first config into the /config
# volume when there is none (every writable path under /config, so the
# database, covers, logs and the downloaded ffmpeg survive a new container;
# the library at /music), then run mStream on it. An existing config is
# never touched: edit /config/config.json, or use the admin panel.
set -e

CONFIG="${MSTREAM_CONFIG:-/config/config.json}"

if [ ! -f "$CONFIG" ]; then
  mkdir -p "$(dirname "$CONFIG")"
  cat > "$CONFIG" <<JSON
{
  "port": ${MSTREAM_PORT:-3000},
  "storage": {
    "albumArtDirectory": "/config/image-cache",
    "dbDirectory": "/config/db",
    "logsDirectory": "/config/logs",
    "waveformCacheDirectory": "/config/waveform-cache"
  },
  "transcode": {
    "ffmpegDirectory": "/config/ffmpeg"
  },
  "folders": {
    "music": { "root": "/music" }
  }
}
JSON
  echo "mstream-zenelo: wrote a first config to $CONFIG (library: /music)"
fi

# Server audio through the host's PulseAudio / PipeWire (its socket mounted,
# PULSE_SERVER pointing at it): ALSA's default device is the pulse plugin.
# A ~/.asoundrc of the user's own (mounted) is left alone.
if [ -n "$PULSE_SERVER" ] && [ ! -e "$HOME/.asoundrc" ]; then
  printf 'pcm.!default { type pulse }\nctl.!default { type pulse }\n' > "$HOME/.asoundrc" 2>/dev/null || true
fi

exec node /app/cli-boot-wrapper.js -j "$CONFIG" "$@"
