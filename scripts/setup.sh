#!/usr/bin/env bash
# Initial setup / environment check for the taobao skill.
# Safe to run repeatedly. Persists browser choice to .taobao-config.sh.
set -o pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ADAPTER_DIR="$SKILL_DIR/assets/taobao-agent-adapter"

# User-data dir — single home for everything stateful (profile, screenshots,
# image dumps, browser-launch log, persisted browser path). Lives outside
# the skill folder so the skill itself can be re-extracted / replaced
# without touching the user's login state.
DATA_DIR="${TAOBAO_DATA_DIR:-$HOME/.taobao-agent}"
CONFIG_FILE="$DATA_DIR/config.sh"
PREFERENCES_FILE="$DATA_DIR/PREFERENCES.md"

# Layout-version stamp. Bumped when the on-disk layout under DATA_DIR
# changes shape so future migrations can tell where they're starting from.
# Absent stamp means "pre-stamp" (the v1 layout shipped 2026-05); after
# any successful migration, setup writes the current version here.
LAYOUT_VERSION_FILE="$DATA_DIR/.layout-version"
CURRENT_LAYOUT_VERSION=1

# Legacy paths from the pre-2026-05 layout (everything lived under the
# skill folder). Picked up by the migration step below if found.
LEGACY_CONFIG_FILE="$SKILL_DIR/.taobao-config.sh"
LEGACY_PROFILE_DIR="$ADAPTER_DIR/.profiles/taobao-chromium"
LEGACY_PLAYWRIGHT_DIR="$ADAPTER_DIR/.playwright"
LEGACY_DOWNLOADS_DIR="$ADAPTER_DIR/downloads"

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true
for PRIVATE_FILE in "$CONFIG_FILE" "$PREFERENCES_FILE" "$LAYOUT_VERSION_FILE"; do
  [[ -f "$PRIVATE_FILE" ]] && chmod 600 "$PRIVATE_FILE" 2>/dev/null || true
done

ok()     { printf '  [ok]   %s\n' "$*"; }
warn()   { printf '  [warn] %s\n' "$*"; }
fail()   { printf '  [fail] %s\n' "$*"; }
info()   { printf '         %s\n' "$*"; }
header() { printf '\n== %s ==\n' "$*"; }

usage() {
  cat <<EOF
Usage: setup.sh [options]

Environment check + interactive browser picker. Safe to re-run.

Options:
  --browser PATH        Persist PATH as the browser to use (as if picked
                        from the interactive menu) and continue the report.
  --clear-browser       Remove any persisted browser selection.
  --non-interactive     Skip the interactive menu even on a TTY. Useful when
                        the agent runs setup via Bash and you want pure
                        report output.
  --help, -h            This message.

Persistence:
  Selections are written to \$TAOBAO_DATA_DIR/config.sh
  (default: ~/.taobao-agent/config.sh).
  The taobao.sh wrapper sources that file automatically on each invocation
  so CHROMIUM_PATH is set for every subsequent command.

See references/browsers.md for a per-browser cheat sheet.
EOF
}

NEW_BROWSER=""
CLEAR_BROWSER=0
NONINTERACTIVE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      shift
      [[ $# -gt 0 ]] || { echo "Error: --browser needs a path argument" >&2; exit 2; }
      NEW_BROWSER="$1"
      ;;
    --clear-browser)
      CLEAR_BROWSER=1
      ;;
    --non-interactive)
      NONINTERACTIVE=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

# Apply flag-driven mutations before the report so their effect is visible.
if [[ "$CLEAR_BROWSER" -eq 1 ]]; then
  if [[ -f "$CONFIG_FILE" ]]; then
    rm -f "$CONFIG_FILE"
    echo "Cleared persisted browser selection ($CONFIG_FILE removed)."
  else
    echo "No persisted browser selection to clear."
  fi
  unset CHROMIUM_PATH
fi

# Read the on-disk layout stamp (absent = pre-stamp v1 install).
read_layout_version() {
  if [[ -f "$LAYOUT_VERSION_FILE" ]]; then
    cat "$LAYOUT_VERSION_FILE" 2>/dev/null | head -1 | tr -d '[:space:]'
  else
    echo ""
  fi
}

# One-shot migration: pre-2026-05 layout kept user data inside the skill
# folder (under .profiles/, .playwright/, downloads/, .taobao-config.sh).
# If those paths exist and the new data-dir slot is empty, move them.
# Login cookies survive — only the file location changes.
migrate_path() {
  local label="$1" old="$2" new="$3"
  [[ -e "$old" ]] || return 0
  [[ -e "$new" ]] && return 0
  mkdir -p "$(dirname "$new")"
  if mv "$old" "$new" 2>/dev/null; then
    echo "Migrated $label: $old → $new"
  fi
}

INSTALLED_VERSION="$(read_layout_version)"
if [[ "$INSTALLED_VERSION" != "$CURRENT_LAYOUT_VERSION" ]]; then
  migrate_path "browser config"  "$LEGACY_CONFIG_FILE"     "$CONFIG_FILE"
  migrate_path "browser profile" "$LEGACY_PROFILE_DIR"     "$DATA_DIR/profiles/taobao-chromium"
  migrate_path "browser log"     "$LEGACY_PLAYWRIGHT_DIR"  "$DATA_DIR/playwright"
  migrate_path "downloads"       "$LEGACY_DOWNLOADS_DIR"   "$DATA_DIR/downloads"

  # After moving taobao-chromium out, the parent .profiles/ dir is left
  # empty. Same for any other empty husks. Remove them quietly.
  rmdir "$ADAPTER_DIR/.profiles" 2>/dev/null || true

  # Stamp the data dir with the now-installed layout version. Future
  # migrations check this before re-running the move logic, so a
  # half-migrated state can't be repeatedly clobbered.
  echo "$CURRENT_LAYOUT_VERSION" > "$LAYOUT_VERSION_FILE"
fi

persist_browser() {
  local path="$1"
  local quoted
  quoted="$(printf '%q' "$path")"
  cat > "$CONFIG_FILE" <<EOF
# Generated by scripts/setup.sh — re-run setup to change, or edit CHROMIUM_PATH.
export CHROMIUM_PATH=$quoted
EOF
  export CHROMIUM_PATH="$path"
}

if [[ -n "$NEW_BROWSER" ]]; then
  if [[ ! -x "$NEW_BROWSER" && ! -f "$NEW_BROWSER" ]]; then
    echo "Error: --browser path does not exist: $NEW_BROWSER" >&2
    exit 1
  fi
  persist_browser "$NEW_BROWSER"
  echo "Persisted browser selection: $NEW_BROWSER"
fi

# Load persisted config if CHROMIUM_PATH isn't already set in this environment.
if [[ -z "${CHROMIUM_PATH:-}" && -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

FAILED=0

header "Platform"
UNAME="$(uname -s)"
ARCH="$(uname -m)"
info "OS:   $UNAME"
info "Arch: $ARCH"

header "Tools"
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v)"
  NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "${NODE_MAJOR:-0}" -ge 22 ]]; then
    ok "node $NODE_VER"
  else
    warn "node $NODE_VER (recommended: 22+)"
  fi
else
  fail "node not found — install Node.js 22+"
  FAILED=1
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm $(npm -v)"
else
  fail "npm not found"
  FAILED=1
fi

if command -v curl >/dev/null 2>&1; then
  ok "curl present"
elif command -v python3 >/dev/null 2>&1; then
  ok "python3 present (curl fallback)"
else
  warn "neither curl nor python3 found — browser-status port check will fail"
fi

# --- Browser detection -------------------------------------------------------

CANDIDATES=()
case "$UNAME" in
  Darwin)
    CANDIDATES=(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    )
    ;;
  Linux)
    CANDIDATES=(
      "/usr/bin/google-chrome"
      "/usr/bin/google-chrome-stable"
      "/opt/google/chrome/chrome"
      "/usr/bin/chromium"
      "/usr/bin/chromium-browser"
      "/snap/bin/chromium"
      "/usr/bin/microsoft-edge"
      "/usr/bin/brave-browser"
    )
    ;;
  MINGW*|MSYS*|CYGWIN*)
    CANDIDATES=(
      "/c/Program Files/Google/Chrome/Application/chrome.exe"
      "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
      "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
      "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    )
    ;;
esac

# Browsers bundled or cached by terminal tools / Node projects (Playwright,
# Puppeteer, Chrome for Testing). These are usually the fastest path to a
# working browser: already downloaded, not Gatekeeper-quarantined, and isolated
# from the user's daily browsing profile. Print to stdout one path per line.
discover_bundled_browsers() {
  (
    shopt -s nullglob 2>/dev/null || true

    # Playwright cache — macOS
    for app in "$HOME/Library/Caches/ms-playwright/chromium-"*/chrome-mac/Chromium.app; do
      [[ -x "$app/Contents/MacOS/Chromium" ]] && echo "$app/Contents/MacOS/Chromium"
    done
    # Playwright cache — Linux
    for bin in "$HOME/.cache/ms-playwright/chromium-"*/chrome-linux/chrome; do
      [[ -x "$bin" ]] && echo "$bin"
    done
    # Playwright cache — Windows (Git Bash exposes LOCALAPPDATA via /c/...)
    if [[ -n "${LOCALAPPDATA:-}" ]]; then
      local la="$LOCALAPPDATA"
      case "$la" in
        [A-Za-z]:*) la="/$(echo "${la:0:1}" | tr 'A-Z' 'a-z')${la:2}" ;;
      esac
      la="${la//\\//}"
      for bin in "$la/ms-playwright/chromium-"*/chrome-win/chrome.exe; do
        [[ -f "$bin" ]] && echo "$bin"
      done
    fi

    # Puppeteer / Chrome for Testing cache — macOS (arm64 + x64)
    for app in "$HOME/.cache/puppeteer/chrome/"mac*/chrome-mac*/"Google Chrome for Testing.app"; do
      local bin="$app/Contents/MacOS/Google Chrome for Testing"
      [[ -x "$bin" ]] && echo "$bin"
    done
    # Puppeteer / Chrome for Testing cache — Linux
    for bin in "$HOME/.cache/puppeteer/chrome/linux-"*/chrome-linux64/chrome; do
      [[ -x "$bin" ]] && echo "$bin"
    done

    # Escape hatch: user-supplied extras, colon-separated paths.
    if [[ -n "${TAOBAO_EXTRA_BROWSERS:-}" ]]; then
      local IFS=:
      for bin in $TAOBAO_EXTRA_BROWSERS; do
        [[ -n "$bin" && ( -x "$bin" || -f "$bin" ) ]] && echo "$bin"
      done
    fi
  )
}

label_for_path() {
  local p="$1"
  case "$p" in
    *"/ms-playwright/"*)                    echo "Chromium (Playwright cache)" ;;
    *"/.cache/puppeteer/"*)                 echo "Chrome for Testing (Puppeteer cache)" ;;
    *"Google Chrome Canary"*)               echo "Google Chrome Canary" ;;
    *"Google Chrome for Testing"*)          echo "Chrome for Testing" ;;
    *"Google Chrome"*)                      echo "Google Chrome" ;;
    *Chromium*)                             echo "Chromium" ;;
    *"Microsoft Edge"*|*msedge*)            echo "Microsoft Edge" ;;
    *"Brave Browser"*|*brave*)              echo "Brave" ;;
    *)                                      echo "$(basename "$p")" ;;
  esac
}

check_quarantined() {
  local p="$1"
  [[ "$UNAME" == "Darwin" ]] || { echo 0; return; }
  command -v xattr >/dev/null 2>&1 || { echo 0; return; }
  local bundle="$p"
  case "$bundle" in
    *.app/Contents/MacOS/*) bundle="${bundle%.app/Contents/MacOS/*}.app" ;;
  esac
  if [[ -e "$bundle" ]] && xattr "$bundle" 2>/dev/null | grep -q '^com\.apple\.quarantine$'; then
    echo 1
  else
    echo 0
  fi
}

# Collect all present candidates with human labels + quarantine flag.
PRESENT_PATHS=()
PRESENT_LABELS=()
PRESENT_QUARANTINED=()

add_candidate() {
  local c="$1"
  [[ -x "$c" || -f "$c" ]] || return 0
  # De-duplicate
  local existing
  for existing in ${PRESENT_PATHS[@]+"${PRESENT_PATHS[@]}"}; do
    [[ "$existing" == "$c" ]] && return 0
  done
  PRESENT_PATHS+=("$c")
  PRESENT_LABELS+=("$(label_for_path "$c")")
  PRESENT_QUARANTINED+=("$(check_quarantined "$c")")
}

# System-installed browsers first (likely what the user expects in the menu).
for c in ${CANDIDATES[@]+"${CANDIDATES[@]}"}; do
  add_candidate "$c"
done

# Then bundled/cached browsers.
while IFS= read -r bundled; do
  [[ -n "$bundled" ]] && add_candidate "$bundled"
done < <(discover_bundled_browsers)

header "Browser"
if [[ -n "${CHROMIUM_PATH:-}" ]]; then
  if [[ -x "$CHROMIUM_PATH" || -f "$CHROMIUM_PATH" ]]; then
    ok "CHROMIUM_PATH → $CHROMIUM_PATH"
    if [[ -f "$CONFIG_FILE" ]]; then
      info "(persisted in $CONFIG_FILE)"
    fi
  else
    warn "CHROMIUM_PATH set but not executable: $CHROMIUM_PATH"
    info "run with --clear-browser to reset, or pick another one below."
  fi
fi

if [[ ${#PRESENT_PATHS[@]} -eq 0 ]]; then
  fail "no Chromium-family browser found"
  info "install Google Chrome / Chromium / Edge / Brave, or:"
  info "  export CHROMIUM_PATH=/path/to/browser"
  info "note: 'brew install --cask chromium' is deprecated on macOS and ships"
  info "      an unsigned build that Gatekeeper will quarantine — prefer Chrome."
  info "see references/browsers.md for per-browser install guidance."
  FAILED=1
else
  info "Found on this machine:"
  i=0
  while [[ $i -lt ${#PRESENT_PATHS[@]} ]]; do
    n=$((i + 1))
    qtag=""
    if [[ "${PRESENT_QUARANTINED[$i]}" == "1" ]]; then
      qtag="  [quarantined — needs sudo xattr]"
    fi
    printf '           %d) %-20s %s%s\n' "$n" "${PRESENT_LABELS[$i]}" "${PRESENT_PATHS[$i]}" "$qtag"
    i=$((i + 1))
  done
fi

# Quarantine warning for the currently selected browser (even if not in the menu).
if [[ -n "${CHROMIUM_PATH:-}" && "$UNAME" == "Darwin" ]]; then
  APP_BUNDLE="$CHROMIUM_PATH"
  case "$APP_BUNDLE" in
    *.app/Contents/MacOS/*)
      APP_BUNDLE="${APP_BUNDLE%.app/Contents/MacOS/*}.app"
      ;;
  esac
  if [[ -e "$APP_BUNDLE" ]] && command -v xattr >/dev/null 2>&1; then
    if xattr "$APP_BUNDLE" 2>/dev/null | grep -q '^com\.apple\.quarantine$'; then
      warn "selected browser is quarantined: $APP_BUNDLE"
      info "remote debugging will not bind until the flag is removed. Run:"
      info "  sudo xattr -dr com.apple.quarantine \"$APP_BUNDLE\""
      info "(sudo is required because the app lives under /Applications)"
    fi
  fi
fi

# --- Interactive browser picker ---------------------------------------------

is_tty() { [[ -t 0 && -t 1 ]]; }

prompt_browser_selection() {
  [[ ${#PRESENT_PATHS[@]} -gt 0 ]] || return 0
  is_tty || return 0
  [[ "$NONINTERACTIVE" -eq 0 ]] || return 0
  [[ -z "$NEW_BROWSER" ]] || return 0  # already picked via flag

  echo
  echo "== Choose browser =="
  echo "See references/browsers.md for a quick cheat sheet per browser."
  echo
  local i=0
  while [[ $i -lt ${#PRESENT_PATHS[@]} ]]; do
    local n=$((i + 1))
    local qtag=""
    [[ "${PRESENT_QUARANTINED[$i]}" == "1" ]] && qtag="  [quarantined]"
    printf '  %d) %s%s\n' "$n" "${PRESENT_LABELS[$i]}" "$qtag"
    i=$((i + 1))
  done
  local custom_idx=$((${#PRESENT_PATHS[@]} + 1))
  local skip_idx=$((${#PRESENT_PATHS[@]} + 2))
  printf '  %d) Enter a custom path\n' "$custom_idx"
  printf '  %d) Keep current / skip\n' "$skip_idx"

  local default="$skip_idx"
  [[ -z "${CHROMIUM_PATH:-}" ]] && default=1

  echo
  printf 'Choice [%s]: ' "$default"
  local choice=""
  read -r choice || choice=""
  [[ -z "$choice" ]] && choice="$default"

  if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
    warn "invalid choice '$choice' — keeping current selection"
    return 0
  fi

  if (( choice >= 1 && choice <= ${#PRESENT_PATHS[@]} )); then
    local idx=$((choice - 1))
    local picked="${PRESENT_PATHS[$idx]}"
    if [[ "${PRESENT_QUARANTINED[$idx]}" == "1" ]]; then
      echo
      warn "this browser is quarantined; remote debugging will fail until you run:"
      info "  sudo xattr -dr com.apple.quarantine \"${picked%.app/Contents/MacOS/*}.app\""
      printf 'Persist this selection anyway? [y/N]: '
      local confirm=""
      read -r confirm || confirm=""
      [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Left selection unchanged."; return 0; }
    fi
    persist_browser "$picked"
    echo "Persisted: $picked"
  elif (( choice == custom_idx )); then
    printf 'Enter the full path to the browser binary: '
    local custom=""
    read -r custom || custom=""
    if [[ -z "$custom" ]]; then
      echo "Empty path — left selection unchanged."
      return 0
    fi
    if [[ ! -x "$custom" && ! -f "$custom" ]]; then
      warn "path does not exist or is not executable: $custom"
      return 0
    fi
    persist_browser "$custom"
    echo "Persisted: $custom"
  elif (( choice == skip_idx )); then
    echo "Kept current selection."
  else
    warn "choice '$choice' out of range — keeping current selection"
  fi
}

prompt_browser_selection

header "Skill installation"
# Canonical homes: Claude Code (~/.claude/skills) and current Codex
# (~/.agents/skills). The old $CODEX_HOME/skills path remains detectable so
# existing copies keep working while setup tells the user how to migrate.
SKILL_REAL="$(cd "$SKILL_DIR" && pwd -P)"
TARGETS=("$HOME/.claude/skills/taobao" "$HOME/.agents/skills/taobao" "${CODEX_HOME:-$HOME/.codex}/skills/taobao")
INSTALLED=0
for TARGET in "${TARGETS[@]}"; do
  if [[ -L "$TARGET" ]]; then
    RESOLVED="$(cd "$TARGET" 2>/dev/null && pwd -P || true)"
    if [[ "$RESOLVED" == "$SKILL_REAL" ]]; then
      ok "symlinked: $TARGET → $SKILL_REAL"
    else
      warn "symlink exists but points elsewhere:"
      info "  $TARGET → $RESOLVED"
      info "  expected: $SKILL_REAL"
    fi
    INSTALLED=1
  elif [[ -d "$TARGET" ]]; then
    warn "$TARGET exists but is not a symlink (copied install, updates won't propagate)"
    INSTALLED=1
  fi
done
LEGACY_CODEX_TARGET="${CODEX_HOME:-$HOME/.codex}/skills/taobao"
CURRENT_CODEX_TARGET="$HOME/.agents/skills/taobao"
if [[ -e "$LEGACY_CODEX_TARGET" && ! -e "$CURRENT_CODEX_TARGET" ]]; then
  warn "legacy Codex install detected without current Codex install"
  info "  current path: $CURRENT_CODEX_TARGET"
fi
if (( ! INSTALLED )); then
  fail "not installed in any skill directory"
  info "Claude Code: ln -s \"$SKILL_DIR\" \"$HOME/.claude/skills/taobao\""
  info "Codex:       ln -s \"$SKILL_DIR\" \"$HOME/.agents/skills/taobao\""
  FAILED=1
fi

header "Adapter project"
if [[ ! -d "$ADAPTER_DIR" ]]; then
  fail "bundled project missing: $ADAPTER_DIR"
  FAILED=1
else
  ok "project dir: $ADAPTER_DIR"
  if [[ -d "$ADAPTER_DIR/node_modules" && -x "$ADAPTER_DIR/node_modules/.bin/tsc" ]]; then
    ok "node_modules installed"
  else
    warn "node_modules missing — will be installed on first command"
  fi
fi

header "Data directory"
ok "data dir: $DATA_DIR"
DATA_MODE="$(stat -f '%Lp' "$DATA_DIR" 2>/dev/null || stat -c '%a' "$DATA_DIR" 2>/dev/null || true)"
if [[ "$DATA_MODE" == "700" ]]; then
  ok "data dir permissions: 700"
else
  warn "could not confirm data dir mode 700 (reported: ${DATA_MODE:-unknown})"
fi
if [[ "$DATA_DIR" != "$HOME/.taobao-agent" ]]; then
  info "(overridden via TAOBAO_DATA_DIR)"
fi
if [[ -f "$LAYOUT_VERSION_FILE" ]]; then
  info "layout version: $(cat "$LAYOUT_VERSION_FILE" 2>/dev/null | head -1)"
fi

header "Personalization"
if [[ -f "$PREFERENCES_FILE" ]]; then
  chmod 600 "$PREFERENCES_FILE" 2>/dev/null || true
  ok "PREFERENCES.md present: $PREFERENCES_FILE"
  info "(read by the agent on activation; edit to record vendors / defaults)"
else
  info "no PREFERENCES.md yet — agent will run with skill defaults only"
  info "create $PREFERENCES_FILE to record trusted shops, shipping defaults,"
  info "buying-decision heuristics, and other per-user guidance"
fi

header "Browser profile"
PROFILE="${TAOBAO_PROFILE_DIR:-$DATA_DIR/profiles/taobao-chromium}"
if [[ -d "$PROFILE" ]]; then
  ok "profile exists: $PROFILE"
  if [[ -f "$PROFILE/Default/Cookies" || -f "$PROFILE/Default/Login Data" ]]; then
    ok "profile has session data (likely already logged in)"
  else
    info "profile empty — run 'browser-start' and log in once"
  fi
else
  info "no profile yet — will be created on first 'browser-start'"
fi

header "What happens next"
if [[ "$FAILED" -eq 0 ]]; then
  cat <<'EOF'
  The agent should now run these directly, without asking you to copy-paste:

    1. ./scripts/taobao.sh doctor           (first build + env summary)
    2. ./scripts/taobao.sh browser-start    (only if profile had no session)
    3. ./scripts/taobao.sh probe-attached   (verify attached workflow)

  You (the user) only need to act once: after browser-start opens the
  dedicated Chrome window, log into Taobao there and leave the window open.
EOF
else
  cat <<'EOF'
  Setup cannot proceed. The agent should resolve each [fail] line above
  before running doctor / browser-start / probe-attached. Items that need
  your permission (installing Node, installing a browser) will be surfaced
  to you explicitly; everything else the agent handles itself.
EOF
fi

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "Setup check: OK"
  exit 0
else
  echo "Setup check: address the [fail] items above before running real commands."
  exit 1
fi
