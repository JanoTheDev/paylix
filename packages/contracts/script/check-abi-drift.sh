#!/bin/bash
#
# Fails if abi/ does not match what src/ currently compiles to.
#
# The exported ABIs went three releases stale once already (eight functions and
# two events missing), and nothing caught it because regenerating them is a
# manual step. `package.json` publishes abi/*.json as export entry points, so
# drift silently breaks any consumer that decodes events or calls the newer
# functions.
#
# CI usage — add to .github/workflows/forge-test.yml after the test step:
#
#   - name: Check ABI freshness
#     run: ./script/check-abi-drift.sh
#
# NOTE: this compares the regenerated ABIs against what git has committed. In
# CI the checkout is clean, so any difference means the committed ABIs are
# stale. Run locally with uncommitted abi/ changes it will report drift by
# design — commit the regenerated files first.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# Invoked via `bash` rather than `./export-abi.sh`: the repo is authored on
# Windows with core.filemode=false, so the script is committed as mode 100644
# and would be "Permission denied" on a Linux CI runner.
bash ./export-abi.sh >/dev/null

# `git status --porcelain`, not `git diff`: a diff only sees files git already
# tracks, so adding a brand-new contract and never committing its ABI would
# leave the export *untracked* and sail straight through the gate — the ABI
# missing entirely, which is worse than the stale content this exists to catch.
# --untracked-files=all stops a new directory being collapsed to one entry.
DRIFT="$(git status --porcelain --untracked-files=all -- abi/)"

if [ -n "$DRIFT" ]; then
  echo ""
  echo "ERROR: abi/ does not match src/."
  echo ""
  echo "$DRIFT" | while read -r status path; do
    case "$status" in
      '??') echo "  MISSING FROM GIT: $path (never committed)" ;;
      'D')  echo "  DELETED:          $path" ;;
      *)    echo "  STALE:            $path" ;;
    esac
  done
  echo ""
  echo "Run ./export-abi.sh and commit the result."
  echo ""
  git --no-pager diff -- abi/ || true
  exit 1
fi

echo "abi/ is up to date with src/."
