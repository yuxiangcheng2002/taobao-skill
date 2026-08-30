#!/usr/bin/env bash
set -euo pipefail
umask 077

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
TAOBAO_REMOTE_DEBUG_PORT="${TAOBAO_REMOTE_DEBUG_PORT:-9222}"
if ! [[ "$TAOBAO_REMOTE_DEBUG_PORT" =~ ^[0-9]+$ ]] || (( TAOBAO_REMOTE_DEBUG_PORT < 1 || TAOBAO_REMOTE_DEBUG_PORT > 65535 )); then
  echo "Error: TAOBAO_REMOTE_DEBUG_PORT must be an integer from 1 to 65535" >&2
  exit 2
fi
export TAOBAO_REMOTE_DEBUG_PORT
DEFAULT_TAOBAO_CDP_URL="http://127.0.0.1:$TAOBAO_REMOTE_DEBUG_PORT"
mkdir -p "$TAOBAO_DATA_DIR"
chmod 700 "$TAOBAO_DATA_DIR" 2>/dev/null || true
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

# Xianyu is a deliberately gated submode. Keep the exact token check in its
# own wrapper so a near-match exits before dependencies, CDP, or network work.
if [[ "${1:-}" == "ultrasource" ]]; then
  shift || true
  exec "$SKILL_DIR/scripts/ultrasource.sh" "$@"
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: taobao-agent-adapter not found at $PROJECT_DIR" >&2
  echo "Expected bundled project at: $BUNDLED_PROJECT_DIR" >&2
  echo "Set TAOBAO_PROJECT_DIR to override." >&2
  exit 1
fi

# Some runtimes install skills as read-only copies (Codex keeps
# ~/.codex/skills unwritable to normal tool calls), but the adapter needs to
# write node_modules/ and dist/ next to its sources. When the bundled adapter
# should not be written to, mirror its sources into the user data dir and run
# from there. Re-synced on every invocation so skill updates propagate; an
# explicit TAOBAO_PROJECT_DIR always wins and skips this entirely.
#
# "Should not be written to" is decided in two steps:
#   1. A copied install under the Codex skills dir is ALWAYS treated as a
#      read-only bundle. Writability is not a stable signal there — an
#      escalated-permission run (approved for localhost CDP access) can pass
#      the write probe against ~/.codex/skills and would pollute the install
#      (taobao-skill#4). Symlinked dev checkouts are exempt.
#   2. Otherwise, probe with a tiny temp write.
USE_RUNTIME_COPY=0
if [[ -z "${TAOBAO_PROJECT_DIR:-}" ]]; then
  SKILL_REAL="$(cd "$SKILL_DIR" && pwd -P)"
  CODEX_SKILL_DIRS=("$HOME/.agents/skills/taobao" "${CODEX_HOME:-$HOME/.codex}/skills/taobao")
  for CODEX_SKILL_DIR in "${CODEX_SKILL_DIRS[@]}"; do
    if [[ -d "$CODEX_SKILL_DIR" && ! -L "$CODEX_SKILL_DIR" ]]; then
      CODEX_REAL="$(cd "$CODEX_SKILL_DIR" 2>/dev/null && pwd -P || true)"
      if [[ -n "$CODEX_REAL" && "$SKILL_REAL" == "$CODEX_REAL" ]]; then
        USE_RUNTIME_COPY=1
        break
      fi
    fi
  done
  if (( ! USE_RUNTIME_COPY )); then
    if ( : >"$PROJECT_DIR/.taobao-write-test" ) 2>/dev/null; then
      rm -f "$PROJECT_DIR/.taobao-write-test" 2>/dev/null || true
    else
      USE_RUNTIME_COPY=1
    fi
  fi
fi

if (( USE_RUNTIME_COPY )); then
  RUNTIME_DIR="$TAOBAO_DATA_DIR/runtime/taobao-agent-adapter"
  mkdir -p "$RUNTIME_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude node_modules --exclude dist \
      --exclude npm-cache --exclude .profiles \
      "$PROJECT_DIR/" "$RUNTIME_DIR/"
  else
    # cp fallback: refreshes sources but never deletes removed files; good
    # enough given rsync ships with macOS and virtually every Linux distro.
    cp -R "$PROJECT_DIR/." "$RUNTIME_DIR/"
  fi
  # The sync preserves the source's read-only mode bits — restore ownership
  # of the copy or npm/tsc hit the same EACCES the mirror exists to avoid.
  chmod -R u+w "$RUNTIME_DIR"
  echo "Skill bundle treated as read-only; using runtime adapter copy at $RUNTIME_DIR" >&2
  PROJECT_DIR="$RUNTIME_DIR"
fi

cd "$PROJECT_DIR"

ensure_deps() {
  if [[ -d node_modules && -x node_modules/.bin/tsc ]]; then
    return 0
  fi
  echo "Installing taobao-agent-adapter dependencies in $PROJECT_DIR ..." >&2
  npm install
}

# Only attached actions receive the managed browser endpoint. Non-attached
# actions must remain able to launch their own persistent context; exporting a
# default TAOBAO_CDP_URL globally collapses the two workflows and makes every
# action depend on a listening CDP browser. Preserve an explicit caller
# override for advanced/private endpoints.
run_attached() {
  TAOBAO_CDP_URL="${TAOBAO_CDP_URL:-$DEFAULT_TAOBAO_CDP_URL}" "$@"
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
  verify)
    ensure_deps
    exec env TAOBAO_PROJECT_DIR="$PROJECT_DIR" "$SKILL_DIR/scripts/verify.sh"
    ;;
  e2e-live)
    ensure_deps
    LIVE_ROOT="${TAOBAO_EVIDENCE_DIR:-$(cd "$SKILL_DIR/.." && pwd)/taobao-workspace/runs}"
    LIVE_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    LIVE_SHA="$(git -C "$(cd "$SKILL_DIR/.." && pwd)" rev-parse --short HEAD 2>/dev/null || echo nogit)"
    LIVE_DIR="${1:-$LIVE_ROOT/$LIVE_STAMP-$LIVE_SHA/live}"
    mkdir -p "$LIVE_DIR"
    chmod 700 "$LIVE_DIR"
    npm run build
    TAOBAO_CDP_URL="${TAOBAO_CDP_URL:-$DEFAULT_TAOBAO_CDP_URL}" \
      exec node scripts/live-e2e.mjs "$LIVE_DIR"
    ;;
  _ultrasource)
    ensure_deps
    [[ "${ULTRASOURCE_TRIGGER:-}" == "Ultrasource" ]] || {
      echo "ULTRASOURCE_TRIGGER_REQUIRED: use scripts/ultrasource.sh Ultrasource ..." >&2
      exit 64
    }
    SUBACTION="${1:-help}"
    shift || true
    case "$SUBACTION" in
      search)
        [[ $# -ge 1 ]] || { echo "Usage: ultrasource.sh Ultrasource search <query> [--brief]" >&2; exit 1; }
        run_attached npm run ultrasource:search -- "$@"
        ;;
      open-href)
        [[ $# -ge 1 ]] || { echo "Usage: ultrasource.sh Ultrasource open-href <url> [--no-screenshot] [--brief]" >&2; exit 1; }
        run_attached npm run ultrasource:open-href -- "$@"
        ;;
      e2e-live)
        LIVE_ROOT="${TAOBAO_EVIDENCE_DIR:-$(cd "$SKILL_DIR/.." && pwd)/taobao-workspace/runs}"
        LIVE_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
        LIVE_SHA="$(git -C "$(cd "$SKILL_DIR/.." && pwd)" rev-parse --short HEAD 2>/dev/null || echo nogit)"
        LIVE_DIR="${1:-$LIVE_ROOT/$LIVE_STAMP-$LIVE_SHA/ultrasource-live}"
        mkdir -p "$LIVE_DIR"
        chmod 700 "$LIVE_DIR"
        npm run build
        TAOBAO_CDP_URL="${TAOBAO_CDP_URL:-$DEFAULT_TAOBAO_CDP_URL}" \
          exec node scripts/ultrasource-live-e2e.mjs "$LIVE_DIR"
        ;;
      help|--help|-h)
        npm run build >/dev/null
        node dist/src/xianyu/cli.js help
        ;;
      *)
        echo "Unknown Ultrasource action: $SUBACTION" >&2
        exit 1
        ;;
    esac
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
    run_attached npm run taobao:probe:attached
    ;;
  search)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME search <query> [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:search -- "$@"
    ;;
  search-attached)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME search-attached <query> [--brief]" >&2; exit 1; }
    ensure_deps
    run_attached npm run taobao:search:attached -- "$@"
    ;;
  open-result)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME open-result <query> <index> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:open-result -- "$@"
    ;;
  open-result-attached)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME open-result-attached <query> <index> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    run_attached npm run taobao:open-result:attached -- "$@"
    ;;
  open-href)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME open-href <url> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    npm run taobao:open-href -- "$@"
    ;;
  open-href-attached)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME open-href-attached <url> [--no-screenshot] [--brief]" >&2; exit 1; }
    ensure_deps
    run_attached npm run taobao:open-href:attached -- "$@"
    ;;
  visual-open-attached)
    [[ $# -ge 1 ]] || { echo "Usage: $SCRIPT_NAME visual-open-attached <url> [--brief]" >&2; exit 1; }
    ensure_deps
    run_attached npm run taobao:visual-open:attached -- "$@"
    ;;
  visual-resume-attached)
    ensure_deps
    run_attached npm run taobao:visual-resume:attached -- "$@"
    ;;
  visual-close-attached)
    [[ $# -eq 0 ]] || { echo "Usage: $SCRIPT_NAME visual-close-attached" >&2; exit 1; }
    ensure_deps
    run_attached npm run taobao:visual-close:attached
    ;;
  download-images)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME download-images <query> <index> [outputDir]" >&2; exit 1; }
    ensure_deps
    npm run taobao:download-images -- "$@"
    ;;
  download-images-attached)
    [[ $# -ge 2 ]] || { echo "Usage: $SCRIPT_NAME download-images-attached <query> <index> [outputDir]" >&2; exit 1; }
    ensure_deps
    run_attached npm run taobao:download-images:attached -- "$@"
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
  verify       deterministic unit + browser + CLI + permission/PID gates
  e2e-live [outputDir]
  ultrasource Ultrasource <search|open-href|e2e-live|help> [args...]
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
  visual-open-attached <url> [--brief]
  visual-resume-attached [--brief]
  visual-close-attached
  download-images <query> <index> [outputDir]
  download-images-attached <query> <index> [outputDir]
USAGE
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 1
    ;;
esac
