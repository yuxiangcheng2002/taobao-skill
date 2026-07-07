#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${TAOBAO_DATA_DIR:-$HOME/.taobao-agent}"
PROFILE_DIR="${TAOBAO_PROFILE_DIR:-$DATA_DIR/profiles/taobao-chromium}"
PORT="${TAOBAO_REMOTE_DEBUG_PORT:-9222}"
URL="${TAOBAO_START_URL:-https://www.taobao.com/}"
LOG_DIR="$DATA_DIR/playwright"
LOG_FILE="$LOG_DIR/taobao-browser.log"

# Resolve a Chromium-family browser across macOS, Linux, and Windows (Git Bash / WSL).
# Priority: CHROMIUM_PATH env > OS-specific candidate list.
resolve_chromium() {
  if [[ -n "${CHROMIUM_PATH:-}" ]]; then
    if [[ -x "$CHROMIUM_PATH" || -f "$CHROMIUM_PATH" ]]; then
      echo "$CHROMIUM_PATH"
      return 0
    fi
    echo "Warning: CHROMIUM_PATH is set but not executable: $CHROMIUM_PATH" >&2
  fi

  local candidates=()
  case "$(uname -s)" in
    Darwin)
      candidates=(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        "/Applications/Chromium.app/Contents/MacOS/Chromium"
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
      )
      ;;
    Linux)
      candidates=(
        "/usr/bin/chromium"
        "/usr/bin/chromium-browser"
        "/snap/bin/chromium"
        "/usr/bin/google-chrome"
        "/usr/bin/google-chrome-stable"
        "/usr/bin/microsoft-edge"
        "/usr/bin/brave-browser"
        "/opt/google/chrome/chrome"
      )
      ;;
    MINGW*|MSYS*|CYGWIN*)
      candidates=(
        "/c/Program Files/Google/Chrome/Application/chrome.exe"
        "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
        "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
        "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      )
      ;;
  esac

  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" || -f "$c" ]]; then
      echo "$c"
      return 0
    fi
  done

  return 1
}

mkdir -p "$PROFILE_DIR" "$LOG_DIR"

check_port() {
  if command -v curl >/dev/null 2>&1; then
    curl -sSf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    PORT="$PORT" python3 - <<'PY' >/dev/null 2>&1
import os, sys, urllib.request
port = os.environ['PORT']
try:
    urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1).read(200)
except Exception:
    sys.exit(1)
PY
  else
    return 1
  fi
}

show_ps() {
  ps -ef 2>/dev/null | grep -F "$PROFILE_DIR" | grep -v grep || true
}

kill_browser() {
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "$PROFILE_DIR" 2>/dev/null || true
  else
    ps -ef 2>/dev/null | grep -F "$PROFILE_DIR" | grep -v grep | awk '{print $2}' | xargs -I{} kill {} 2>/dev/null || true
  fi
}

CMD="${1:-status}"
shift || true

case "$CMD" in
  status)
    echo "Profile: $PROFILE_DIR"
    echo "Port: $PORT"
    if check_port; then
      echo "Remote debugging: UP"
    else
      echo "Remote debugging: DOWN"
    fi
    show_ps
    ;;

  stop)
    kill_browser
    sleep 1
    echo "Stopped browser for profile: $PROFILE_DIR"
    ;;

  start)
    if ! CHROMIUM_BIN="$(resolve_chromium)"; then
      {
        echo "Error: could not locate a Chromium/Chrome executable."
        echo "Set CHROMIUM_PATH explicitly, for example:"
        echo "  macOS:   export CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'"
        echo "  Linux:   export CHROMIUM_PATH=/usr/bin/google-chrome"
        echo "  Windows: export CHROMIUM_PATH='/c/Program Files/Google/Chrome/Application/chrome.exe'"
      } >&2
      exit 1
    fi
    echo "Using browser: $CHROMIUM_BIN"
    kill_browser
    sleep 1
    if [[ "$(uname -s)" == "Darwin" && "$CHROMIUM_BIN" == *.app/Contents/MacOS/* ]]; then
      APP_BUNDLE="${CHROMIUM_BIN%.app/Contents/MacOS/*}.app"
      # LaunchServices keeps GUI apps alive after the invoking shell exits.
      open -na "$APP_BUNDLE" --args \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$PROFILE_DIR" \
        --no-default-browser-check \
        --disable-blink-features=AutomationControlled \
        "$URL"
    else
      nohup "$CHROMIUM_BIN" \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$PROFILE_DIR" \
        --no-default-browser-check \
        --disable-blink-features=AutomationControlled \
        "$URL" >"$LOG_FILE" 2>&1 &
    fi

    for _ in $(seq 1 20); do
      if check_port; then
        echo "Started browser with remote debugging on port $PORT"
        exit 0
      fi
      sleep 0.5
    done

    echo "Browser launched but remote debugging port did not come up in time." >&2

    # On macOS the most common cause is Gatekeeper quarantine on an unsigned
    # Chromium. Detect it and print the exact fix instead of leaving the
    # caller to dig through .playwright/taobao-browser.log.
    if [[ "$(uname -s)" == "Darwin" ]] && command -v xattr >/dev/null 2>&1; then
      APP_BUNDLE="$CHROMIUM_BIN"
      case "$APP_BUNDLE" in
        *.app/Contents/MacOS/*)
          APP_BUNDLE="${APP_BUNDLE%.app/Contents/MacOS/*}.app"
          ;;
      esac
      if [[ -e "$APP_BUNDLE" ]] && xattr "$APP_BUNDLE" 2>/dev/null | grep -q '^com\.apple\.quarantine$'; then
        {
          echo
          echo "Detected Gatekeeper quarantine on: $APP_BUNDLE"
          echo "Remove it and retry:"
          echo "  sudo xattr -dr com.apple.quarantine \"$APP_BUNDLE\""
          echo
          echo "Alternative: use an already-trusted browser such as Google Chrome"
          echo "by unsetting CHROMIUM_PATH, or pointing it somewhere else."
        } >&2
      fi
    fi

    echo "Check $LOG_FILE for details." >&2
    exit 1
    ;;

  *)
    echo "Usage: $0 {status|start|stop}" >&2
    exit 1
    ;;
esac
