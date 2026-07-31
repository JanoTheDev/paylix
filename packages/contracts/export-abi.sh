#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/abi"

# Resolve forge from PATH first (foundryup, package managers, and CI's
# foundry-toolchain action all put it there), falling back to foundryup's
# default install dir for shells that never sourced the profile. Hardcoding
# ~/.foundry/bin/forge broke this script on macOS, on package-manager installs,
# and in CI.
FORGE="${FORGE:-}"
if [ -z "$FORGE" ]; then
  FORGE="$(command -v forge || true)"
fi
if [ -z "$FORGE" ] && [ -x "$HOME/.foundry/bin/forge" ]; then
  FORGE="$HOME/.foundry/bin/forge"
fi
if [ -z "$FORGE" ]; then
  echo "forge not found. Install Foundry: https://getfoundry.sh" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

cd "$SCRIPT_DIR"
"$FORGE" build

extract_abi() {
  node -e "
    const data = JSON.parse(require('fs').readFileSync('$1', 'utf8'));
    process.stdout.write(JSON.stringify(data.abi, null, 2));
  " > "$2"
}

extract_abi "out/PaymentVault.sol/PaymentVault.json" "$OUT_DIR/PaymentVault.json"
extract_abi "out/SubscriptionManager.sol/SubscriptionManager.json" "$OUT_DIR/SubscriptionManager.json"
extract_abi "out/MockUSDC.sol/MockUSDC.json" "$OUT_DIR/MockUSDC.json"

echo "ABIs exported to $OUT_DIR/"
