# @paylix/contracts

Solidity contracts for the Paylix payment protocol. Non-custodial USDC settlement on Base.

## Contracts

### PaymentVault

One-time payment settlement. Buyers pay merchants directly in USDC with an optional platform fee split in the same transaction.

- **Direct flow** — buyer calls `createPayment` and USDC transfers directly to the merchant
- **Gasless flow** — relayer calls `createPaymentWithPermit` using the buyer's EIP-2612 permit + EIP-712 PaymentIntent signature. The buyer never needs ETH.
- Platform fee is capped at 10% (1000 bps) and deducted atomically. The fee ceiling the buyer agreed to (`maxFeeBps`) is part of the signed intent — raising `platformFee` voids outstanding signatures instead of repricing them. **The direct `createPayment` path has no signed intent and therefore no ceiling**: the fee is read from storage at settlement, so the owner can front-run a direct payment with a fee raise (bounded by 1000 bps). Direct callers should check `platformFee()`, or use the gasless path.
- Every signed intent also binds a `flow` identifier (`FLOW_EIP2612` / `FLOW_PERMIT2` / `FLOW_DAI_PERMIT`), so an intent signed for one settlement mechanism cannot be replayed through another against a residual allowance.
- `Ownable2Step`, `ReentrancyGuard`, `Pausable`. `renounceOwnership` is disabled.
- `rescueToken` (owner-only) sweeps stray tokens; the vault holds no user balance between transactions.

### SubscriptionManager

Recurring USDC billing with keeper-driven charges.

- **Direct flow** — buyer calls `createSubscription`, first charge is processed immediately
- **Gasless flow** — relayer calls `createSubscriptionWithPermit` with buyer's permit (sized for many cycles) + EIP-712 SubscriptionIntent signature
- `chargeSubscription` is called by the keeper/relayer when `nextChargeDate` is reached
- Charge failures split two ways. **Pre-checkable** ones — no balance, no/expired allowance — are detected by view calls before any transfer, so `chargeSubscription` flips the subscription to `PastDue` and returns normally. **Token-level** ones the views cannot see — a blacklisted subscriber (USDC on Base implements blacklisting), a paused token — revert the whole transaction, leaving the subscription `Active` with an unchanged `nextChargeDate`. That is the price of making partial charges impossible; **the keeper must escalate a reverting charge to dunning rather than retrying it forever**. No funds are at risk in either case, and cancellation works in both.
- `PastDue` is **terminal** — there is no path back to `Active`. This is a deliberate product decision, not an oversight: re-activation would let a subscription resume charging after an arbitrary gap without fresh consent. A subscriber who recovers signs a new subscription.
- Subscribers can request wallet updates (two-step: request → accept by new wallet). The new wallet must already hold an allowance, and Permit2-backed subscriptions cannot be migrated.
- Relayer-scoped cancel helpers for gasless cancellation on behalf of subscribers or merchants
- Per-subscription fee ceiling: the `maxFeeBps` the subscriber signed is stored at creation and clamps `platformFee` on every future charge.
- **Backup payers** — a subscription can list up to `MAX_BACKUP_PAYERS` fallback wallets. Adding one needs *two* signatures: the primary's `BackupPayerAuth` and the backup wallet's own `BackupPayerConsent` (binding subscription id + subscriber + token + a per-charge `maxAmount` + nonce + deadline). A backup can remove itself at any time, and migrating the subscription to a new wallet clears the whole backup list — consent named the *old* subscriber.

  > **`maxAmount` is a per-charge cap, not a lifetime cap.** `nextChargeDate` advances by exactly one interval per successful charge and is never clamped to `block.timestamp`, so if a subscription goes unbilled for N intervals it becomes chargeable N times back to back — in the same block, by the merchant. A backup payer consenting to `maxAmount` is therefore exposed to `N × maxAmount` in the worst case, bounded by their token allowance. Size the ERC-20 allowance you grant accordingly, and prefer a `maxAmount` close to the subscription amount.
- `Status.None` is the enum zero value, so an id that was never issued can never read back as active.

### MockUSDC

ERC-20 + ERC-2612 permit token for testnet. 6 decimals, owner-only minting.

## Security Model

- **Non-custodial**: contracts never hold user balances. USDC moves directly from buyer to merchant via `safeTransferFrom`. The one exception is `createPaymentWithPermit2`, which takes custody for the duration of a single transaction and asserts the received balance delta equals the requested amount (fee-on-transfer tokens are rejected).
- **Intent binding**: gasless paths require an EIP-712 signed intent from the buyer, binding the exact merchant, amount, token, fee ceiling, and nonce. A compromised relayer cannot redirect funds or settle at a worse fee than was signed.
- **Consent, not allowance**: an ERC-20 allowance is never treated as agreement to fund a specific subscription. Backup payers must sign `BackupPayerConsent` themselves.
- **Permit front-run safety**: permit calls are wrapped in `try/catch` so an already-consumed permit doesn't revert the entire transaction if allowance is sufficient. On the backup-payer path the failure is *not* swallowed: if the permit reverts, the wallet must already carry at least `permitValue` of allowance or the whole call reverts.
- **Access control**: admin functions use `Ownable2Step` (two-step ownership transfer). Emergency `pause`/`unpause` is owner-only. `renounceOwnership` reverts on both contracts — renouncing would permanently brick relayer rotation and the pause switch.
- **Known residual approval**: `createPaymentWithDaiPermit` uses DAI's legacy `allowed = true` permit, which grants the vault an *unlimited standing allowance* on the buyer's DAI. Nothing in the vault can move it without a fresh buyer intent signature, but it survives the checkout; buyers who want it gone must revoke on the token.

## Development

Contracts are built and tested with [Foundry](https://book.getfoundry.sh/).

```shell
forge build
forge test
forge test --fuzz-runs 1000    # CI fuzz level
forge fmt
```

On Windows (via WSL):

```shell
wsl bash -lc "cd /mnt/c/path/to/paykit/packages/contracts && ~/.foundry/bin/forge test"
```

### Test Suite

| File | Coverage |
|------|----------|
| `PaymentVault.t.sol` | Core payment flows, fee math, access control |
| `PaymentVaultPause.t.sol` | Pause/unpause behavior |
| `PaymentVaultPermit.t.sol` | Gasless permit + intent verification, relayer restrictions |
| `PaymentVaultPermit2.t.sol` | Permit2 settlement path (stubbed Permit2) |
| `PaymentVaultDaiPermit.t.sol` | DAI legacy-permit settlement path |
| `SubscriptionManager.t.sol` | Subscription lifecycle, charging, cancellation, wallet updates |
| `SubscriptionManagerPause.t.sol` | Pause/unpause behavior |
| `SubscriptionManagerPermit.t.sol` | Gasless subscription creation, intent binding |
| `SubscriptionManagerPermit2.t.sol` | Permit2 recurring-charge path |
| `SubscriptionManagerDiscount.t.sol` | On-chain coupon shapes |
| `SubscriptionManagerBackup.t.sol` | Wallet-walk, two-sided backup consent, self-removal |
| `SubscriptionManagerPhantom.t.sol` | Nonexistent subscription ids, migration preconditions |
| `PlatformFeeBinding.t.sol` | Signed fee ceilings vs. mid-lifecycle `setPlatformFee` |
| `Ownership.t.sol` | `Ownable2Step` handoff, disabled renounce, onlyOwner revert paths |
| `Reentrancy.t.sol` | Malicious-token reentrancy against both contracts |
| `FeeMath.t.sol` | Fuzzed fee split, non-custody / value-conservation invariants, and a deterministic reachability test proving the invariant handler visits PastDue, wallet-walk, discount and Permit2 states |
| `HostileTokens.t.sol` | Fee-on-transfer token rejection, residual-balance safety, rescue |
| `MockUSDC.t.sol` | Token minting, decimals |
| `mainnet-fork/PaymentVaultMainnetFork.t.sol` | Fork tests against real USDC on Base |

### Static Analysis

Slither runs in CI with `fail-on: medium`. Config is in `slither.config.json`. Low and informational detectors are **enabled** (they surface in the SARIF upload and PR annotations without blocking the build); only optimization detectors are excluded.

> Slither is not installed in this repo's WSL toolchain, so the current changes have **not** been statically analysed. The EIP-712 `BackupPayerConsent` verification is new signature-handling code; run Slither and an external review of the EIP-712 additions before any mainnet deploy.

### Deployment

```shell
# Testnet (Base Sepolia) — MULTISIG_OWNER optional
forge script script/DeployTestnet.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast

# Mainnet (Base) — MULTISIG_OWNER required
forge script script/DeployMainnet.s.sol --rpc-url $BASE_RPC_URL --broadcast
```

`DeployMainnet` requires `DEPLOYER_PRIVATE_KEY`, `PLATFORM_WALLET`, `RELAYER_ADDRESS`, `USDC_ADDRESS` and `MULTISIG_OWNER`. It asserts `USDC_ADDRESS` is a contract before deploying, and after deploying asserts the accepted token, relayer, platform wallet, fee, and that `transferOwnership(MULTISIG_OWNER)` is pending.

**The deploy is not finished until the multisig calls `acceptOwnership()` on both contracts** — `Ownable2Step` keeps the deployer EOA as owner until it does.

### ABIs

`abi/*.json` is generated from `src/` and published via the package `exports` map. Regenerate after any contract change:

```shell
./export-abi.sh
```

`script/check-abi-drift.sh` regenerates and then runs `git diff --exit-code abi/`, so drift fails loudly. **This still needs wiring into `.github/workflows/forge-test.yml`** as a step after the test run — the ABIs went three releases stale once precisely because regeneration is a manual step with no gate.

## License

[AGPL-3.0](../../LICENSE)
