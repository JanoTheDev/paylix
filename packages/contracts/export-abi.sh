#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/abi"

mkdir -p "$OUT_DIR"

cd "$SCRIPT_DIR"
~/.foundry/bin/forge build

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
