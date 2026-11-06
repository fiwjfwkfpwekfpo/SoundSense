#!/usr/bin/env bash
# Dev helper: (re)starts the unpacked desktop build with its own XDG folders inside
# artifacts/desktop/test-home, so tests never touch ~/.config, ~/.local/share or ~/.cache.
# DevTools protocol on 127.0.0.1:9333 (see scripts/dev/cdp.mjs).
#   scripts/dev/test-desktop.sh [stable|beta] [--fresh]
set -euo pipefail
cd "$(dirname "$0")/../.."
channel="${1:-beta}"
home="$PWD/artifacts/desktop/test-home"
pidfile="$PWD/artifacts/desktop/test-app.pid"
if [[ -f "$pidfile" ]]; then kill "$(cat "$pidfile")" 2>/dev/null || true; sleep 1; rm -f "$pidfile"; fi
[[ "${2:-}" == "--fresh" ]] && rm -rf "$home"
mkdir -p "$home"
SS_DESKTOP_LOG=1 SS_FFMPEG="$PWD/.toolchain/ffmpeg/ffmpeg" XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" XDG_CACHE_HOME="$home/cache" \
  node_modules/electron/dist/electron "artifacts/desktop/$channel/app" --remote-debugging-port=9333 \
  >"$PWD/artifacts/desktop/test-app.log" 2>&1 &
echo $! >"$pidfile"
echo "started pid $(cat "$pidfile")"
