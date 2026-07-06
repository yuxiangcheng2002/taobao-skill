#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLED_PROJECT_DIR="$SKILL_DIR/assets/taobao-agent-adapter"
PROJECT_DIR="${TAOBAO_PROJECT_DIR:-$BUNDLED_PROJECT_DIR}"

# Per-user data dir. Single env var (TAOBAO_DATA_DIR) is the umbrella for
# everything stateful: persisted browser config, browser profile, generated
# screenshots, image dumps, browser-launch log. Default keeps it out of the
# skill folder so the skill itself can be re-extracted / replaced without
# touching the user's login state.
export TAOBAO_DATA_DIR="${TAOBAO_DATA_DIR:-$HOME/.taobao-agent}"
CONFIG_FILE="$TAOBAO_DATA_DIR/config.sh"
LEGACY_CONFIG_FILE="$SKILL_DIR/.taobao-config.sh"

# Load the browser selection persisted by `setup` unless the caller already
# provided their own CHROMIUM_PATH. Falls back to the pre-migration location
# so a stale install still works until the user re-runs setup.
if [[ -z "${CHROMIUM_PATH:-}" ]]; then
  if [[ -f "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
  elif [[ -f "$LEGACY_CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$LEGACY_CONFIG_FILE"
  fi
fi

# `setup` runs at skill level and must not require the adapter project to exist.
if [[ "${1:-}" == "setup" ]]; then
  shift || true
  exec "$SKILL_DIR/scripts/setup.sh" "$@"
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: taobao-agent-adapter not found at $PROJECT_DIR" >&2
  echo "Expected bundled project at: $BUNDLED_PROJECT_DIR" >&2
  echo "Set TAOBAO_PROJECT_DIR to override." >&2
  exit 1
fi

cd "$PROJECT_DIR"

ensure_deps() {
  if [[ -d node_modules && -x node_modules/.bin/tsc ]]; then
    return 0
  fi
  echo "Installing taobao-agent-adapter dependencies in $PROJECT_DIR ..." >&2
  npm install
}

ACTION="${1:-help}"
shift || true

case "$ACTION" in
  install)
    npm install
    ;;
  doctor)
    ensure_deps
    npm run smoke:doctor
    ;;
  test)
    ensure_deps
    npm test
    ;;
  browser-start)
    ensure_deps
    npm run taobao:browser:start
    ;;
  browser-status)
    ensure_deps
    npm run taobao:browser:status
    ;;
  browser-stop)
    ensure_deps
    npm run taobao:browser:stop
    ;;
  probe)
    ensure_deps
    npm run taobao:probe
    ;;
  probe-attached)
    ensure_deps
    npm run taobao:probe:attached
    ;;
  search)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME search <query> [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:search -- "$@"
    ;;
  search-attached)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME search-attached <query> [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:search:attached -- "$@"
    ;;
  open-result)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME open-result <query> <index> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:open-result -- "$@"
    ;;
  open-result-attached)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME open-result-attached <query> <index> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:open-result:attached -- "$@"
    ;;
  open-href)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME open-href <url> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:open-href -- "$@"
    ;;
  open-href-attached)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME open-href-attached <url> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:open-href:attached -- "$@"
    ;;
  download-images)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME download-images <query> <index> [outputDir]" >&2; exit 1; }
    ensure_deps
    npm run taobao:download-images -- "$@"
    ;;
  download-images-attached)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME download-images-attached <query> <index> [outputDir]" >&2; exit 1; }
    ensure_deps
    npm run taobao:download-images:attached -- "$@"
    ;;
  help|--help|-h)
    cat <<USAGE
Usage: $SCRIPT_NAME <action> [args...]

Project resolution order:
  1. TAOBAO_PROJECT_DIR
  2. bundled skill copy: $BUNDLED_PROJECT_DIR

Actions:
  setup        first-time environment check (safe to re-run)
  install
  doctor
  test
  browser-start
  browser-status
  browser-stop
  probe
  probe-attached
  search <query> [--brief]
  search-attached <query> [--brief]
  open-result <query> <index> [--no-screenshot] [--brief]
  open-result-attached <query> <index> [--no-screenshot] [--brief]
  open-href <url> [--no-screenshot] [--brief]
  open-href-attached <url> [--no-screenshot] [--brief]
  download-images <query> <index> [outputDir]
  download-images-attached <query> <index> [outputDir]
USAGE
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 1
    ;;
esac
