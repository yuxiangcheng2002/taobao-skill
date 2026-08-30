#!/usr/bin/env bash
set -euo pipefail
umask 077

DATA_DIR="${TAOBAO_DATA_DIR:-$HOME/.taobao-agent}"
PROFILE_DIR="${TAOBAO_PROFILE_DIR:-$DATA_DIR/profiles/taobao-chromium}"
PORT="${TAOBAO_REMOTE_DEBUG_PORT:-9222}"
URL="${TAOBAO_START_URL:-https://www.taobao.com/}"
LOG_DIR="$DATA_DIR/playwright"
LOG_FILE="$LOG_DIR/taobao-browser.log"
PID_FILE="$LOG_DIR/taobao-browser.pid"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Error: TAOBAO_REMOTE_DEBUG_PORT must be an integer from 1 to 65535" >&2
  exit 2
fi

mkdir -p "$DATA_DIR" "$PROFILE_DIR" "$LOG_DIR"
chmod 700 "$DATA_DIR" "$PROFILE_DIR" "$LOG_DIR" 2>/dev/null || true

# Auto-detected: macOS, native Linux, Windows Git Bash. Under WSL, only a
# native Linux Chromium (normally via WSLg) is supported.
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
        "/usr/bin/chromium" "/usr/bin/chromium-browser" "/snap/bin/chromium"
        "/usr/bin/google-chrome" "/usr/bin/google-chrome-stable"
        "/usr/bin/microsoft-edge" "/usr/bin/brave-browser" "/opt/google/chrome/chrome"
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

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" || -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

check_port() {
  if command -v curl >/dev/null 2>&1; then
    curl -sSf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    TAOBAO_CHECK_PORT="$PORT" python3 - <<'PY' >/dev/null 2>&1
import os, sys, urllib.request
try:
    urllib.request.urlopen(f"http://127.0.0.1:{os.environ['TAOBAO_CHECK_PORT']}/json/version", timeout=1).read(200)
except Exception:
    sys.exit(1)
PY
  else
    return 1
  fi
}

process_matches() {
  local pid="$1" command
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ -n "$command" ]] || return 1
  printf '%s' "$command" | grep -Fq -- "--user-data-dir=$PROFILE_DIR" || return 1
  printf '%s' "$command" | grep -Fq -- "--remote-debugging-port=$PORT" || return 1
}

find_managed_pid() {
  local pid command
  while read -r pid command; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if printf '%s' "$command" | grep -Fq -- "--user-data-dir=$PROFILE_DIR" &&
       printf '%s' "$command" | grep -Fq -- "--remote-debugging-port=$PORT"; then
      echo "$pid"
      return 0
    fi
  done < <(ps -axo pid=,command= 2>/dev/null)
  return 1
}

write_lease() {
  printf '%s\n' "$1" >"$PID_FILE"
  chmod 600 "$PID_FILE" 2>/dev/null || true
}

read_lease() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(head -1 "$PID_FILE" 2>/dev/null | tr -d '[:space:]')"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  echo "$pid"
}

stop_managed_browser() {
  local pid
  if ! pid="$(read_lease)"; then
    rm -f "$PID_FILE"
    echo "No managed browser lease found; nothing killed."
    return 0
  fi
  if ! process_matches "$pid"; then
    rm -f "$PID_FILE"
    echo "Stale or mismatched browser lease removed; PID $pid was not killed."
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  local attempt
  for attempt in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null && process_matches "$pid"; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "Stopped managed browser PID $pid for profile: $PROFILE_DIR"
}

show_managed_process() {
  local pid
  if pid="$(read_lease)" && process_matches "$pid"; then
    ps -p "$pid" -o pid=,command= 2>/dev/null || true
  fi
}

CMD="${1:-status}"

case "$CMD" in
  status)
    echo "Profile: $PROFILE_DIR"
    echo "Port: $PORT"
    if check_port; then
      if pid="$(read_lease)" && process_matches "$pid"; then
        echo "Remote debugging: UP (managed PID $pid)"
      elif pid="$(find_managed_pid)"; then
        write_lease "$pid"
        echo "Remote debugging: UP (recovered managed PID $pid)"
      else
        echo "Remote debugging: PORT_CONFLICT (endpoint is not owned by this profile)"
        exit 1
      fi
    else
      echo "Remote debugging: DOWN"
    fi
    show_managed_process
    ;;

  stop)
    stop_managed_browser
    ;;

  start)
    if check_port; then
      if pid="$(read_lease)" && process_matches "$pid"; then
        echo "Remote debugging already UP (managed PID $pid) on port $PORT"
        exit 0
      elif pid="$(find_managed_pid)"; then
        write_lease "$pid"
        echo "Remote debugging already UP (recovered managed PID $pid) on port $PORT"
        exit 0
      fi
      echo "Error: PORT_CONFLICT on 127.0.0.1:$PORT; refusing to reuse or kill an unrelated CDP endpoint." >&2
      exit 1
    fi

    if [[ -f "$PID_FILE" ]]; then
      stop_managed_browser
    fi

    if ! CHROMIUM_BIN="$(resolve_chromium)"; then
      echo "Error: could not locate a Chromium/Chrome executable. Set CHROMIUM_PATH; see references/browsers.md." >&2
      exit 1
    fi
    echo "Using browser: $CHROMIUM_BIN"

    if [[ "$(uname -s)" == "Darwin" && "$CHROMIUM_BIN" == *.app/Contents/MacOS/* ]]; then
      APP_BUNDLE="${CHROMIUM_BIN%.app/Contents/MacOS/*}.app"
      open -na "$APP_BUNDLE" --args \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$PROFILE_DIR" \
        --no-default-browser-check \
        --disable-blink-features=AutomationControlled \
        "$URL"
    else
      nohup "$CHROMIUM_BIN" \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="$PORT" \
        --user-data-dir="$PROFILE_DIR" \
        --no-default-browser-check \
        --disable-blink-features=AutomationControlled \
        "$URL" >"$LOG_FILE" 2>&1 &
      write_lease "$!"
    fi

    for _ in $(seq 1 20); do
      if check_port; then
        if pid="$(find_managed_pid)"; then
          write_lease "$pid"
          echo "Started managed browser PID $pid with remote debugging on port $PORT"
          exit 0
        fi
        echo "Browser endpoint came up, but no matching profile process was found; refusing unmanaged state." >&2
        exit 1
      fi
      sleep 0.5
    done

    echo "Browser launched but remote debugging port did not come up in time." >&2
    if [[ "$(uname -s)" == "Darwin" ]] && command -v xattr >/dev/null 2>&1; then
      APP_BUNDLE="$CHROMIUM_BIN"
      case "$APP_BUNDLE" in
        *.app/Contents/MacOS/*) APP_BUNDLE="${APP_BUNDLE%.app/Contents/MacOS/*}.app" ;;
      esac
      if [[ -e "$APP_BUNDLE" ]] && xattr "$APP_BUNDLE" 2>/dev/null | grep -q '^com\.apple\.quarantine$'; then
        echo "Detected Gatekeeper quarantine. Remove it and retry: sudo xattr -dr com.apple.quarantine \"$APP_BUNDLE\"" >&2
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
