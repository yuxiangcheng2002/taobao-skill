#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ADAPTER_DIR="${TAOBAO_PROJECT_DIR:-$SKILL_DIR/assets/taobao-agent-adapter}"
ADAPTER_DIR="$(cd "$ADAPTER_DIR" && pwd -P)"
[[ -f "$ADAPTER_DIR/package.json" ]] || {
  echo "Adapter project missing package.json: $ADAPTER_DIR" >&2
  exit 1
}

# A symlinked checkout resolves to its real Git root, keeping evidence in the
# repo-local ignored workspace. A copied/read-only install has no Git root, so
# use its writable private data directory instead of writing beside the skill.
REPO_ROOT="$(git -C "$SKILL_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -n "${TAOBAO_EVIDENCE_DIR:-}" ]]; then
  RUNS_ROOT="$TAOBAO_EVIDENCE_DIR"
elif [[ -n "$REPO_ROOT" ]]; then
  RUNS_ROOT="$REPO_ROOT/taobao-workspace/runs"
else
  RUNS_ROOT="${TAOBAO_DATA_DIR:-$HOME/.taobao-agent}/taobao-workspace/runs"
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SHA="$(git -C "${REPO_ROOT:-$SKILL_DIR}" rev-parse --short HEAD 2>/dev/null || echo nogit)"
RUN_DIR="$RUNS_ROOT/$STAMP-$SHA"
DETERMINISTIC_DIR="$RUN_DIR/deterministic"
SANDBOX_DATA="$RUN_DIR/sandbox-data"

mkdir -p "$RUNS_ROOT" "$DETERMINISTIC_DIR" "$SANDBOX_DATA"
chmod 700 "$RUNS_ROOT" "$RUN_DIR" "$DETERMINISTIC_DIR" "$SANDBOX_DATA"
export TAOBAO_DATA_DIR="$SANDBOX_DATA"
printf '%s\n' '# deterministic permissions fixture' >"$SANDBOX_DATA/PREFERENCES.md"
chmod 644 "$SANDBOX_DATA/PREFERENCES.md"

run_logged() {
  local name="$1"
  shift
  "$@" >"$DETERMINISTIC_DIR/$name.stdout.log" 2>"$DETERMINISTIC_DIR/$name.stderr.log"
  chmod 600 "$DETERMINISTIC_DIR/$name.stdout.log" "$DETERMINISTIC_DIR/$name.stderr.log"
}

run_logged setup "$SKILL_DIR/scripts/setup.sh" --non-interactive
[[ "$(stat -f '%Lp' "$SANDBOX_DATA" 2>/dev/null || stat -c '%a' "$SANDBOX_DATA")" == "700" ]]
[[ "$(stat -f '%Lp' "$SANDBOX_DATA/PREFERENCES.md" 2>/dev/null || stat -c '%a' "$SANDBOX_DATA/PREFERENCES.md")" == "600" ]]

run_logged unit npm --prefix "$ADAPTER_DIR" test
run_logged browser-e2e node "$ADAPTER_DIR/scripts/deterministic-e2e.mjs" "$DETERMINISTIC_DIR/browser"
run_logged eval-schema node "$SKILL_DIR/scripts/validate-evals.mjs"

# The wrapper must keep standalone and attached browser modes distinct. Use a
# fake npm executable after dependencies exist so this gate observes dispatch
# without starting a browser or contacting a marketplace.
DISPATCH_BIN="$SANDBOX_DATA/dispatch-bin"
DISPATCH_DATA="$SANDBOX_DATA/dispatch-data"
DISPATCH_LOG="$DETERMINISTIC_DIR/wrapper-dispatch.log"
mkdir -p "$DISPATCH_BIN" "$DISPATCH_DATA"
chmod 700 "$DISPATCH_BIN" "$DISPATCH_DATA"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\t%s\n" "${TAOBAO_CDP_URL-UNSET}" "$*" >>"$TAOBAO_DISPATCH_LOG"' \
  >"$DISPATCH_BIN/npm"
chmod 700 "$DISPATCH_BIN/npm"
(
  unset TAOBAO_CDP_URL
  env PATH="$DISPATCH_BIN:$PATH" \
    TAOBAO_PROJECT_DIR="$ADAPTER_DIR" \
    TAOBAO_DATA_DIR="$DISPATCH_DATA" \
    TAOBAO_DISPATCH_LOG="$DISPATCH_LOG" \
    "$SKILL_DIR/scripts/taobao.sh" search "fixture query"
)
(
  unset TAOBAO_CDP_URL
  env PATH="$DISPATCH_BIN:$PATH" \
    TAOBAO_PROJECT_DIR="$ADAPTER_DIR" \
    TAOBAO_DATA_DIR="$DISPATCH_DATA" \
    TAOBAO_DISPATCH_LOG="$DISPATCH_LOG" \
    TAOBAO_REMOTE_DEBUG_PORT=19224 \
    "$SKILL_DIR/scripts/taobao.sh" search-attached "fixture query"
)
env PATH="$DISPATCH_BIN:$PATH" \
  TAOBAO_PROJECT_DIR="$ADAPTER_DIR" \
  TAOBAO_DATA_DIR="$DISPATCH_DATA" \
  TAOBAO_DISPATCH_LOG="$DISPATCH_LOG" \
  TAOBAO_CDP_URL=http://127.0.0.1:19225 \
  "$SKILL_DIR/scripts/taobao.sh" search-attached "fixture query"
grep -Fqx $'UNSET\trun taobao:search -- fixture query' "$DISPATCH_LOG"
grep -Fqx $'http://127.0.0.1:19224\trun taobao:search:attached -- fixture query' "$DISPATCH_LOG"
grep -Fqx $'http://127.0.0.1:19225\trun taobao:search:attached -- fixture query' "$DISPATCH_LOG"
chmod 600 "$DISPATCH_LOG"

# The exact magic word is a deterministic execution gate, not only a prompt
# convention. Near matches must fail before the CLI can open a browser.
for BAD_TRIGGER in ultrasource ULTRASOURCE UltraSource UltrasourceX; do
  if "$SKILL_DIR/scripts/ultrasource.sh" "$BAD_TRIGGER" help \
    >"$DETERMINISTIC_DIR/ultrasource-gate-$BAD_TRIGGER.stdout.log" \
    2>"$DETERMINISTIC_DIR/ultrasource-gate-$BAD_TRIGGER.stderr.log"; then
    echo "Ultrasource gate unexpectedly accepted: $BAD_TRIGGER" >&2
    exit 1
  fi
  grep -Fq 'ULTRASOURCE_TRIGGER_REQUIRED' \
    "$DETERMINISTIC_DIR/ultrasource-gate-$BAD_TRIGGER.stderr.log"
  chmod 600 \
    "$DETERMINISTIC_DIR/ultrasource-gate-$BAD_TRIGGER.stdout.log" \
    "$DETERMINISTIC_DIR/ultrasource-gate-$BAD_TRIGGER.stderr.log"
done
run_logged ultrasource-gate-positive "$SKILL_DIR/scripts/ultrasource.sh" Ultrasource help

# A suffix host must be rejected before any Xianyu navigation.
if env ULTRASOURCE_TRIGGER=Ultrasource node "$ADAPTER_DIR/dist/src/xianyu/cli.js" open-href \
  'https://www.goofish.com.evil.example/item?id=1068945084433' \
  >"$DETERMINISTIC_DIR/ultrasource-evil.stdout.log" \
  2>"$DETERMINISTIC_DIR/ultrasource-evil.stderr.log"; then
  echo "Ultrasource URL boundary unexpectedly accepted an evil host" >&2
  exit 1
fi
grep -Fq 'requires an HTTPS www.goofish.com/item URL' \
  "$DETERMINISTIC_DIR/ultrasource-evil.stderr.log"
chmod 600 \
  "$DETERMINISTIC_DIR/ultrasource-evil.stdout.log" \
  "$DETERMINISTIC_DIR/ultrasource-evil.stderr.log"

# CLI must reject an evil suffix before any browser is launched.
if node "$ADAPTER_DIR/dist/src/cli.js" open-href \
  'https://item.taobao.com.evil.example/item.htm?id=1' \
  >"$DETERMINISTIC_DIR/cli-evil.stdout.log" 2>"$DETERMINISTIC_DIR/cli-evil.stderr.log"; then
  echo "CLI URL boundary unexpectedly accepted an evil host" >&2
  exit 1
fi
grep -Fq 'requires an https product URL' "$DETERMINISTIC_DIR/cli-evil.stderr.log"
chmod 600 "$DETERMINISTIC_DIR/cli-evil.stdout.log" "$DETERMINISTIC_DIR/cli-evil.stderr.log"

# A stale/mismatched lease must never kill the referenced process.
node -e 'setTimeout(() => {}, 30000)' -- "--user-data-dir=$SANDBOX_DATA/profiles/taobao-chromium" --decoy &
DECOY_PID=$!
cleanup() {
  kill "$DECOY_PID" 2>/dev/null || true
  wait "$DECOY_PID" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$SANDBOX_DATA/playwright"
printf '%s\n' "$DECOY_PID" >"$SANDBOX_DATA/playwright/taobao-browser.pid"
run_logged pid-safety env TAOBAO_REMOTE_DEBUG_PORT=19222 \
  bash "$ADAPTER_DIR/scripts/remote-browser.sh" stop
kill -0 "$DECOY_PID"
cleanup
trap - EXIT

# A live CDP-shaped endpoint without a matching profile process is a conflict,
# never an owned browser. The lifecycle script must refuse it without killing.
CONFLICT_PORT="${TAOBAO_TEST_CONFLICT_PORT:-19223}"
node -e '
const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200, {"content-type": "application/json"});
  res.end("{\"Browser\":\"decoy\"}");
});
server.listen(Number(process.argv[1]), "127.0.0.1");
' "$CONFLICT_PORT" &
CONFLICT_PID=$!
cleanup_conflict() {
  kill "$CONFLICT_PID" 2>/dev/null || true
  wait "$CONFLICT_PID" 2>/dev/null || true
}
trap cleanup_conflict EXIT
for _ in $(seq 1 20); do
  curl -sSf --max-time 1 "http://127.0.0.1:$CONFLICT_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.1
done
if env TAOBAO_REMOTE_DEBUG_PORT="$CONFLICT_PORT" \
  bash "$ADAPTER_DIR/scripts/remote-browser.sh" status \
  >"$DETERMINISTIC_DIR/port-conflict.stdout.log" 2>"$DETERMINISTIC_DIR/port-conflict.stderr.log"; then
  echo "Unmanaged CDP endpoint was accepted" >&2
  exit 1
fi
grep -Fq 'PORT_CONFLICT' "$DETERMINISTIC_DIR/port-conflict.stdout.log"
chmod 600 "$DETERMINISTIC_DIR/port-conflict.stdout.log" "$DETERMINISTIC_DIR/port-conflict.stderr.log"
cleanup_conflict
trap - EXIT

node -e '
const fs = require("fs");
const path = require("path");
const out = process.argv[1];
const summary = {
  status: "pass",
  gates: {
    unit: "pass",
    deterministicBrowserE2E: "pass",
    codexVisualTabContract: "pass",
    ultrasourceExactTrigger: "pass",
    ultrasourceUrlBoundary: "pass",
    ultrasourceBrowserE2E: "pass",
    skillEvalSchema: "pass",
    wrapperBrowserModes: "pass",
    cliUrlBoundary: "pass",
    privateDataMode: "pass",
    privateFileMode: "pass",
    pidOwnership: "pass",
    portOwnership: "pass"
  }
};
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
' "$RUN_DIR"

echo "VERIFY PASS"
echo "Evidence: $RUN_DIR"
