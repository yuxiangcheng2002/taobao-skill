#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" != "Ultrasource" ]]; then
  echo "ULTRASOURCE_TRIGGER_REQUIRED: first argument must be the exact case-sensitive token Ultrasource" >&2
  echo "Usage: $SCRIPT_NAME Ultrasource <search|open-href|e2e-live|help> [args...]" >&2
  exit 64
fi
shift

export ULTRASOURCE_TRIGGER=Ultrasource
exec "$SCRIPT_DIR/taobao.sh" _ultrasource "${1:-help}" "${@:2}"
