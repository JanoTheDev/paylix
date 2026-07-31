# Smart Contracts Audit

**Scope:** `packages/contracts/{src,test,script,abi}` (vendored `lib/` excluded)
**Date:** 2026-07-31

## Summary

- The intent-binding invariant holds on every *payment* path: `createPayment*` and `createSubscription*` all run `_consumePaymentIntent` / `_consumeSubscriptionIntent` before any `safeTransferFrom`. There is, however, one fund-moving path that has no intent at all — the backup-payer wallet-walk added in `967d75e` — and it lets an attacker pull USDC out of a wallet that never consented (SC-01).
- Fee math is correct and loss-free: `fee = amount * platformFee / 10000` rounds toward the merchant, `merchantAmount = amount - fee`, so `fee + merchantAmount == amount` exactly on every path. The only accounting defect is the Permit2 fee-leg swallow in `_tryChargePermit2` (SC-07).
- Access control is `Ownable2Step` + relayer/keeper whitelists as documented, but the whole thing terminates in a single deployer EOA: `DeployMainnet.s.sol` never hands ownership to a multisig, there is no timelock, and `renounceOwnership` is live (SC-04, SC-14).
- `abi/*.json` was last regenerated 2026-04-13 (`93fa1bc`) — before the Permit2, discount, and backup-payer releases. Eight functions and two events are missing from the exported ABIs that `package.json` publishes (SC-06).
- `Status.Active` is the enum zero value, so every unwritten `subscriptions[id]` slot reads back as an active subscription owned by `address(0)` (SC-05).
- Test suite is broad on happy paths and relayer-tampering reverts, but has **zero** fuzz tests, **zero** invariant tests, **zero** reentrancy tests, and **zero** ownership-transfer tests — despite CI running `forge test --fuzz-runs 1000`.

## Finding Counts

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 3 |
| Medium | 12 |
| Low | 12 |

## Findings

### SC-01 — Backup payer can be attached to a subscription without that wallet's consent, draining any address with a standing allowance

**Severity:** Critical
**File:** `packages/contracts/src/SubscriptionManager.sol:919` (permit swallow), `:931` (unconditional push), `:787`–`:818` (the drain)
**Problem:** `addSubscriptionBackupPayer` verifies only the *primary subscriber's* `BackupPayerAuth` signature (`_verifyBackupAuth`, `:853`). The backup wallet's own consent is supposed to come from its EIP-2612 permit, but that call is wrapped in `try … {} catch {}` at `:919`–`:929` and the address is pushed onto `subscriptionBackups` unconditionally at `:931`. `p.v/p.r/p.s` can therefore be garbage. `_tryProcessPayment` then walks that list at `:795`–`:804`, picks any entry where `allowance(b, address(this)) >= amount && balanceOf(b) >= amount`, and does `token.safeTransferFrom(payer, merchant_, merchantAmount)` at `:814`. Attack: Mallory creates a subscription with `merchant` = an address she controls and `amount` = the sum she wants, signs a `BackupPayerAuth` naming victim Bob, has the relayer submit it with a junk permit, drains her own primary wallet, and calls `chargeSubscription`. Every existing Paylix subscriber is a viable Bob — `createSubscriptionWithPermit` grants a standing allowance of `permitValue` (the tests use `AMOUNT * 1000`, `test/SubscriptionManagerBackup.t.sol:209`), and `cancelSubscription` (`:602`) never revokes it, so *cancelled* subscribers who did not manually revoke are the softest targets. Note the permit even succeeding would not fix this: an EIP-2612 permit grants an allowance, it does not express consent to fund subscription *N*.
**Fix:** Require the backup's own EIP-712 consent bound to the subscription. Add a `BackupPayerConsent(uint256 subscriptionId,address subscriber,address token,uint256 maxAmount,uint256 nonce,uint256 deadline)` typehash, recover it against `p.backup` with its own nonce counter, and revert if it does not match — before `backups.push`. Separately, stop swallowing the permit: if the permit reverts, either bubble it or require `token.allowance(p.backup, address(this)) >= p.permitValue` afterwards.
**Effort:** M

---

### SC-02 — A wallet listed as a backup payer has no on-chain way to remove itself

**Severity:** High
**File:** `packages/contracts/src/SubscriptionManager.sol:938`–`:943`
**Problem:** `removeSubscriptionBackupPayer` requires `msg.sender == sub.subscriber`. The backup — the party whose funds are at risk — cannot remove itself, and neither can the owner or the relayer. Combined with SC-01 the victim's only remedy is to revoke the ERC-20 allowance on the token itself, which also breaks their own legitimate subscription. Even with SC-01 fixed, a backup who consented once is locked into the list for the life of the subscription at the primary's discretion.
**Fix:** Add `|| msg.sender == backup` to the authorization check (a backup removing itself is always safe), and emit `SubscriptionBackupPayerRemoved` as it already does at `:951`.
**Effort:** S

---

### SC-03 — `setPlatformFee` applies retroactively to already-signed intents and every live subscription

**Severity:** High
**File:** `packages/contracts/src/PaymentVault.sol:416`–`:420`, `packages/contracts/src/SubscriptionManager.sol:681`–`:685`
**Problem:** `platformFee` is not a field in `PAYMENT_INTENT_TYPEHASH` (`PaymentVault.sol:43`) or `SUBSCRIPTION_INTENT_TYPEHASH` (`SubscriptionManager.sol:27`), and the fee is read from storage at settlement time (`PaymentVault.sol:227`, `SubscriptionManager.sol:745`). The owner can raise the fee from 50 bps to the 1000 bps cap in a transaction ordered immediately before a batch of relayer settlements, or at any point during the life of a subscription, and every merchant silently receives 9.5% less. There is no timelock and no per-payment cap. The buyer is unaffected (total debit is always `amount`), so nothing in the signature scheme catches it.
**Fix:** Add `platformFee` (or a `maxFeeBps`) to both intent typehashes and `require(platformFee <= p.maxFeeBps)` at settlement, so a signature is void if the fee moved. At minimum, put `setPlatformFee` behind a timelock and emit the old value in `PlatformFeeUpdated` so merchants can monitor.
**Effort:** M

---

### SC-04 — Mainnet deploy leaves both contracts owned by the deployer EOA, with no handoff and no post-deploy assertions

**Severity:** High
**File:** `packages/contracts/script/DeployMainnet.s.sol:17`–`:41`
**Problem:** The script broadcasts from `DEPLOYER_PRIVATE_KEY`, so `Ownable(msg.sender)` (`PaymentVault.sol:76`) makes that hot key the permanent owner of `setRelayer`, `setPlatformWallet`, `setPlatformFee`, `setAcceptedToken`, `pause`, and `renounceOwnership`. There is no `transferOwnership` to a multisig, no `vm.assert`/`require` that `platformWallet != address(0)` or `relayer != address(0)`, no verification that the deployed `platformFee()` is 50, and no check that `USDC_ADDRESS` is actually a contract on the target chain (a typo'd env var silently produces a vault that accepts a non-existent token). `DeployTestnet.s.sol:10`–`:34` has the same shape.
**Fix:** Read a `MULTISIG_OWNER` env var and call `vault.transferOwnership(multisig)` / `subs.transferOwnership(multisig)` at the end of the broadcast (the multisig then calls `acceptOwnership`, which `Ownable2Step` already supports). Add post-deploy `require`s: `usdc.code.length > 0`, `vault.acceptedTokens(usdc)`, `vault.relayer() == relayer`, `vault.platformFee() == platformFee`, `platformWallet != address(0)`.
**Effort:** S

---

### SC-05 — `Status.Active` is enum value 0, so nonexistent subscription IDs read back as active

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:59`, `:562`–`:599`, `:612`–`:626`
**Problem:** `enum Status { Active, PastDue, Cancelled, Expired }` puts `Active` at zero. `subscriptions[anyUnusedId]` therefore returns `{subscriber: 0, merchant: 0, amount: 0, nextChargeDate: 0, status: Active}`. `chargeSubscription(2**200)` passes the relayer branch of the auth check at `:567`, passes `require(sub.status == Status.Active)` at `:570`, passes `block.timestamp >= 0` at `:571`, falls into `_tryProcessPayment` which returns `false` at `:780` (`merchantAmount == 0`), and then writes `PastDue` and emits `SubscriptionPastDue` for a subscription that does not exist (`:585`–`:586`). `cancelSubscriptionByRelayerForSubscriber(fakeId, address(0))` is worse: `sub.subscriber == subscriber` is `0 == 0`, so it emits `SubscriptionCancelled` for an arbitrary id (`:618`–`:625`). Both feed junk into the indexer's event handlers and into `recordUnmatched`.
**Fix:** Insert a `None` member as the zero value (`enum Status { None, Active, PastDue, Cancelled, Expired }`) and set `status: Status.Active` explicitly at creation — it already is, at `:199`, `:285`, `:380`, `:502`. Alternatively add `require(subscriptionId < nextSubscriptionId, "No such subscription")` to `chargeSubscription`, both relayer-cancel helpers, `addSubscriptionBackupPayer`, and `removeSubscriptionBackupPayer`.
**Effort:** S

---

### SC-06 — Exported ABIs are 3 releases stale: 8 functions and 2 events missing

**Severity:** Medium
**File:** `packages/contracts/abi/PaymentVault.json`, `packages/contracts/abi/SubscriptionManager.json`, `packages/contracts/package.json:5`–`:9`
**Problem:** `abi/` was last committed in `93fa1bc` (2026-04-13). The backup-payer release landed in `967d75e` (2026-04-22) and the Permit2 vault release in `0f7cc9e` (2026-04-23). Diffing the exported ABIs against `src/`: `PaymentVault.json` is missing `createPaymentWithPermit2`, `createPaymentWithDaiPermit`, and `PERMIT2`. `SubscriptionManager.json` is missing `createSubscriptionWithPermitDiscount`, `createSubscriptionWithPermit2`, `addSubscriptionBackupPayer`, `removeSubscriptionBackupPayer`, `getSubscriptionBackups`, `subscriptionBackups`, `subscriptionDiscounts`, `isPermit2Subscription`, `MAX_BACKUP_PAYERS`, `PERMIT2`, and both the `SubscriptionBackupPayerAdded` and `SubscriptionBackupPayerRemoved` events. `package.json` publishes these files as the `./abi/*` export entry points, so any consumer that switches from an inline ABI to the package export silently cannot decode backup events or call the discount/Permit2 paths.
**Fix:** Re-run `./export-abi.sh` and commit. Then add an ABI-freshness gate to `.github/workflows/forge-test.yml`: run `export-abi.sh` and `git diff --exit-code abi/`, failing the build on drift.
**Effort:** S

---

### SC-07 — `_tryChargePermit2` fee-leg failure overstates `totalCharged` and misreports the event

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:542`–`:552`
**Problem:** The merchant leg transfers `merchantAmount = amount - fee`. If the platform-fee leg then reverts, the catch at `:544`–`:548` sets `fee = 0` and continues. Line `:550` does `sub.totalCharged += amount` and line `:551` emits `PaymentReceived(..., amount, fee /* now 0 */, ...)`. The subscriber was actually debited `amount - fee`, the platform received nothing, but on-chain state and the emitted event both claim a full-`amount` payment with zero fee. The indexer writes a payment row for the full amount, so merchant reporting, revenue splits, and `totalCharged` all drift by the fee on every occurrence.
**Fix:** Track what was actually pulled: `uint256 charged = merchantAmount; if (feeLegSucceeded) charged += fee; sub.totalCharged += charged;` and emit `charged` as the amount alongside the real fee. Or simply let the fee-leg failure fall through to `return false` (PastDue) so partial charges never happen.
**Effort:** S

---

### SC-08 — `PastDue` is terminal: there is no path back to `Active`

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:570`, `:585`, `:596`
**Problem:** A single failed charge sets `status = Status.PastDue`. `chargeSubscription` requires `sub.status == Status.Active` at `:570`, and no function anywhere in the contract writes `Status.Active` outside the four creation sites. So a subscriber who is momentarily short of USDC (or whose Permit2 allowance expiration lapses, SC-09) permanently loses the subscription; recovery requires a brand new EIP-712 signature and a new subscription id, which orphans the off-chain row. The README (`README.md:23`) presents PastDue as a soft state ("the keeper stays healthy"), implying a retry that does not exist.
**Fix:** Add `function reactivateSubscription(uint256 id)` callable by the subscriber (or the relayer on their behalf), requiring `status == Status.PastDue`, that sets `status = Status.Active` and re-anchors `nextChargeDate = block.timestamp`. Emit a `SubscriptionReactivated` event so the indexer can follow.
**Effort:** M

---

### SC-09 — `createSubscriptionWithPermit2` validates neither the allowance expiration, the amount, nor `sigDeadline`

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:445`–`:460`, struct comment at `:433`–`:435`
**Problem:** The function checks `permit2Permit.spender` and `permit2Permit.details.token` but never checks (a) `permit2Permit.details.expiration` — a `uint48` that can be set to `block.timestamp + 1`, so the creation charge succeeds and the very next cycle reverts inside Permit2, flipping the sub to the terminal PastDue state of SC-08; (b) `permit2Permit.details.amount >= p.amount`, so an under-sized allowance produces a revert deep inside `_chargePermit2` rather than a clear precondition failure; (c) `permit2Permit.sigDeadline == p.deadline`, even though the struct comment at `:433` explicitly says "Expected to match `permit2Permit.sigDeadline`". Only the intent signature constrains `details.amount` (bound as `permitValue` at `:474`) — nothing constrains expiration at all.
**Fix:** Add `require(permit2Permit.details.expiration >= block.timestamp + p.interval, "Permit2 expiration too short")`, `require(permit2Permit.details.amount >= p.amount, "Permit2 allowance < amount")`, and `require(permit2Permit.sigDeadline == p.deadline, "Permit2 deadline mismatch")`.
**Effort:** S

---

### SC-10 — Strictly sequential shared `intentNonces` invalidate every other outstanding signature

**Severity:** Medium
**File:** `packages/contracts/src/PaymentVault.sol:110`, `:127`; `packages/contracts/src/SubscriptionManager.sol:157`, `:176`, `:338`, `:342`, `:860`, `:876`
**Problem:** Both contracts read `intentNonces[buyer]` and consume it with `nonce + 1`, so a buyer can only ever have one valid outstanding signature. In `SubscriptionManager` a single counter is shared by `SubscriptionIntent`, `SubscriptionIntentDiscount`, and `BackupPayerAuth` — adding a backup payer silently voids a pending subscription intent and vice versa. In practice: a user who opens two checkout tabs, or retries a checkout after the first relay attempt stalls, gets "Invalid intent signature" on whichever signature is submitted second, with no way to tell from the revert string that it was a nonce race rather than tampering.
**Fix:** Switch to unordered nonces — `mapping(address => mapping(uint256 => bool)) usedIntentNonces` with the nonce supplied by the signer, `require(!used[buyer][nonce])` then `used[buyer][nonce] = true`. Or use a bitmap (`mapping(address => mapping(uint256 => uint256))` word/bit) as Permit2 does. Keep `getIntentNonce` for backwards compatibility but add an `isNonceUsed(address,uint256)` view.
**Effort:** M

---

### SC-11 — `PaymentReceived.subscriber` carries the backup payer, not the subscription's subscriber

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:821` vs `:758`
**Problem:** `_processPayment` emits `PaymentReceived(id, subscriber, merchant_, ...)` using `sub.subscriber`. `_tryProcessPayment` emits `PaymentReceived(subscriptionId, payer, merchant_, ...)` at `:821`, where `payer` may be a backup wallet selected at `:801`. `subscriber` is an *indexed* event field, so any off-chain consumer filtering `PaymentReceived` by subscriber address loses backup-funded cycles entirely, and the indexer's payment rows will attribute the charge to the wrong wallet.
**Fix:** Emit `sub.subscriber` in the `subscriber` slot for consistency, and add a separate non-indexed `address payer` field (a new event or an extended signature) so the actual funding wallet is still observable. Regenerate the ABI (SC-06) afterwards.
**Effort:** S

---

### SC-12 — No token rescue on either contract, and the Permit2 vault path assumes exact-amount receipt

**Severity:** Medium
**File:** `packages/contracts/src/PaymentVault.sol:294`–`:337` (no sweep anywhere in the file), `packages/contracts/src/SubscriptionManager.sol` (same)
**Problem:** `createPaymentWithPermit2` is the one path where the vault genuinely custodies funds: `_pullViaPermit2` transfers `p.amount` to `address(this)` at `:282`, then `:330`/`:333` push `merchantAmount` and `fee` back out. The code assumes the received balance equals `p.amount`. For a fee-on-transfer or rebasing token added to `acceptedTokens`, the vault receives less than `p.amount` and the outbound `safeTransfer` either reverts (locking nothing) or, if the vault holds a residual balance from a prior transaction, drains that residual to the caller-chosen merchant. Any tokens sent directly to either contract, or left behind by a partially-failing token, are permanently unrecoverable — neither contract has a sweep/rescue function and neither is upgradeable.
**Fix:** Measure the delta in the Permit2 path (`uint256 before = IERC20(p.token).balanceOf(address(this))` … `uint256 received = after - before`) and split `received` rather than `p.amount`, or `require(received == p.amount, "Fee-on-transfer token")`. Add `function rescueToken(address token, address to, uint256 amount) external onlyOwner` guarded by an event; the contracts hold no user balances between transactions, so an owner-only sweep is safe.
**Effort:** M

---

### SC-13 — `SubscriptionCreated` omits discount terms and the Permit2 flag

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:410`–`:421`, written at `:383`–`:386` and `:505`
**Problem:** `_emitSubscriptionCreated` emits only `(subId, subscriber, merchant, token, amount, interval, productId, customerId)`. `createSubscriptionWithPermitDiscount` writes `subscriptionDiscounts[subId]` and `createSubscriptionWithPermit2` writes `isPermit2Subscription[subId]`, and neither appears in any event. The indexer therefore records the subscription at full `amount` while the first `PaymentReceived` reports the discounted figure, and it has no way to project future cycle amounts or to know which charging path the sub uses. There is also no event when `discountCyclesRemaining` is decremented (`:731`, `:810`), so the transition from discounted to full price is invisible on-chain.
**Fix:** Add a `SubscriptionTermsSet(uint256 indexed subscriptionId, uint256 discountAmount, uint256 discountCycles, bool isPermit2)` event emitted alongside `SubscriptionCreated`, and emit `SubscriptionDiscountConsumed(uint256 indexed subscriptionId, uint256 remaining)` on each decrement.
**Effort:** S

---

### SC-14 — `renounceOwnership` is inherited and live; calling it permanently bricks both contracts

**Severity:** Medium
**File:** `packages/contracts/src/PaymentVault.sol:36`, `packages/contracts/src/SubscriptionManager.sol:20` (both inherit `Ownable2Step` → `Ownable`); present in both exported ABIs
**Problem:** `Ownable2Step` protects `transferOwnership` with a two-step accept, but `renounceOwnership()` is a single unguarded call that sets the owner to `address(0)`. Because ownership is held by a hot deploy key (SC-04), one mistaken or compromised call permanently disables `setRelayer`, `setPlatformWallet`, `setPlatformFee`, `setAcceptedToken`, `setGaslessPaused`, `pause`, and `unpause`. There is no recovery — the contracts are not upgradeable — and the relayer key could then never be rotated after a compromise.
**Fix:** Override in both contracts: `function renounceOwnership() public pure override { revert("Renounce disabled"); }`.
**Effort:** S

---

### SC-15 — Missed billing cycles accumulate and can be charged back-to-back in a single block

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:583`, `:594`
**Problem:** On success `nextChargeDate` advances by exactly one `interval` from its previous value, never clamped to `block.timestamp` — this is deliberate and tested (`test/SubscriptionManager.t.sol:213`, `test_chargeSubscription_late_anchors_to_nextChargeDate`). The consequence is that if the keeper is down for N intervals, `chargeSubscription` becomes callable N times in immediate succession, each satisfying `block.timestamp >= sub.nextChargeDate`. `chargeSubscription` is callable by `sub.merchant` (`:566`), so a merchant who lets a subscription go unbilled for a year can drain 12 months in one block, bounded only by the buyer's remaining ERC-20 allowance (typically `amount * 1000`). The subscriber has no on-chain notice window.
**Fix:** Cap the catch-up: track missed cycles and either clamp (`sub.nextChargeDate = block.timestamp + sub.interval` when more than one interval has elapsed) or add `require(block.timestamp < sub.nextChargeDate + sub.interval * MAX_CATCHUP)` and auto-PastDue beyond it. Whichever is chosen, update the test at `test/SubscriptionManager.t.sol:213` to assert the new bound.
**Effort:** M

---

### SC-16 — Wallet migration hands the subscription to a wallet that has granted no allowance

**Severity:** Medium
**File:** `packages/contracts/src/SubscriptionManager.sol:658`–`:672`
**Problem:** `acceptSubscriptionWalletUpdate` sets `sub.subscriber = msg.sender` with no check that the new wallet has any ERC-20 allowance to this contract, any balance, or — for a Permit2 subscription (`isPermit2Subscription[subId]`, `:104`) — any Permit2 allowance at all. The Permit2 case is unconditionally broken: the allowance is keyed on the *old* owner inside Permit2, and nothing in this contract can re-grant it. The next `chargeSubscription` therefore fails and, per SC-08, kills the subscription permanently. The migration succeeds silently and the failure surfaces up to one interval later.
**Fix:** Require the incoming wallet to be able to pay: `require(IERC20(sub.token).allowance(msg.sender, address(this)) >= sub.amount, "New wallet has no allowance")` for the ERC-20 path, and reject the Permit2 path outright (`require(!isPermit2Subscription[subscriptionId], "Migrate unsupported for Permit2 subs")`) until a re-permit flow exists.
**Effort:** S

---

### SC-17 — Backup payers can be added to `PastDue` subscriptions that can never be charged

**Severity:** Low
**File:** `packages/contracts/src/SubscriptionManager.sol:893`–`:896` vs `:570`
**Problem:** `addSubscriptionBackupPayer` accepts `status == Status.Active || status == Status.PastDue`, but `chargeSubscription` requires `Status.Active`. Adding a backup to a PastDue subscription consumes the subscriber's `intentNonces` slot (invalidating other outstanding signatures per SC-10), emits `SubscriptionBackupPayerAdded`, and accomplishes nothing. It reads as an intended recovery mechanism that does not work.
**Fix:** Either restrict to `Status.Active`, or — better — implement SC-08's reactivation so the PastDue branch has a purpose.
**Effort:** S

---

### SC-18 — Constructors accept `platformWallet == address(0)` while the setter rejects it

**Severity:** Low
**File:** `packages/contracts/src/PaymentVault.sol:75`–`:82` (`:80`), `packages/contracts/src/SubscriptionManager.sol:120`–`:127` (`:125`)
**Problem:** `setPlatformWallet` has `require(_wallet != address(0), "Invalid wallet")` (`PaymentVault.sol:424`), but the constructors assign `_platformWallet` with no validation. A deploy with a zero or unset `PLATFORM_WALLET` env var (`DeployMainnet.s.sol:19`) produces contracts where `platformFee > 0 && platformWallet != address(0)` is false, so `fee` stays 0 on every path (`:149`, `:227`, `:324`, `:392`) and the platform silently collects nothing. Nothing reverts and nothing logs.
**Fix:** Add `require(_platformWallet != address(0), "Invalid wallet")` to both constructors, and emit `PlatformWalletUpdated`/`PlatformFeeUpdated` from the constructor so deployments are observable in logs.
**Effort:** S

---

### SC-19 — `_consumeSubscriptionIntent` does not enforce the deadline it hashes

**Severity:** Low
**File:** `packages/contracts/src/SubscriptionManager.sol:153`–`:177`
**Problem:** `p.deadline` is folded into the struct hash at `:170` but never compared against `block.timestamp`. The three call sites all check it independently (`:241`, `:361`, `:458`), so today the behavior is correct — but this is a load-bearing check living outside the function that owns it, unlike `PaymentVault._consumePaymentIntent` which does enforce it internally at `:109`. A fourth caller added later that forgets the check accepts arbitrarily old signatures.
**Fix:** Move the check inside: `require(block.timestamp <= p.deadline, "Intent expired");` as the first line of `_consumeSubscriptionIntent`, and the same for `_consumeSubscriptionIntentDiscount` (`:334`). The call-site checks become redundant but harmless.
**Effort:** S

---

### SC-20 — Silent `uint160` truncation in the Permit2 charge paths

**Severity:** Low
**File:** `packages/contracts/src/SubscriptionManager.sol:521`, `:524`, `:542`, `:544`
**Problem:** `PERMIT2.transferFrom(..., uint160(merchantAmount), ...)` and `uint160(fee)` are unchecked downcasts from `uint256`. Nothing bounds `p.amount` to `type(uint160).max` in `createSubscriptionWithPermit2` (`:445`). For an amount above 2^160 the transfer silently moves the truncated value while `sub.totalCharged += amount` (`:526`, `:550`) records the full one. Unreachable for 6-decimal USDC, but the contract accepts arbitrary `acceptedTokens`.
**Fix:** Add `require(p.amount <= type(uint160).max, "Amount too large for Permit2")` in `createSubscriptionWithPermit2`, or use OpenZeppelin's `SafeCast.toUint160`.
**Effort:** S

---

### SC-21 — `Status.Expired` is declared but never assigned

**Severity:** Low
**File:** `packages/contracts/src/SubscriptionManager.sol:59`
**Problem:** `enum Status { Active, PastDue, Cancelled, Expired }` — `Expired` appears nowhere else in `src/`. Off-chain consumers decoding the enum will map value 3 to a state the contract can never reach, and its presence implies an expiry mechanism that does not exist (subscriptions run forever until cancelled or PastDue).
**Fix:** Remove `Expired`, or implement it (an optional `endsAt` on the subscription, checked in `chargeSubscription`). Note that removing it shifts nothing since it is the last member — but do coordinate with the DB enum in `packages/db`.
**Effort:** S

---

### SC-22 — A failed Permit2 charge still burns a discount cycle

**Severity:** Low
**File:** `packages/contracts/src/SubscriptionManager.sol:578`–`:587`, `:725`–`:734`
**Problem:** The Permit2 branch calls `_resolveChargeAmount` at `:578`, which decrements `d.discountCyclesRemaining` at `:731` *before* the pull is attempted. If `_tryChargePermit2` then returns false at `:580`, the subscription goes PastDue but the discount cycle is already consumed and is not restored. The ERC-20 branch deliberately avoids this by previewing without decrementing (`_tryProcessPayment`, `:768`–`:771`, decrement deferred to `:809`). Currently latent: `createSubscriptionWithPermitDiscount` never sets `isPermit2Subscription`, so no subscription has both a discount and the Permit2 path — but nothing in the code enforces that.
**Fix:** Mirror the `_tryProcessPayment` pattern in the Permit2 branch: compute the discounted amount without mutating, and decrement only after `_tryChargePermit2` returns true.
**Effort:** S

---

### SC-23 — One signed `PaymentIntent` is executable through any of the three gasless settlement paths

**Severity:** Low
**File:** `packages/contracts/src/PaymentVault.sol:43`, consumed at `:202`, `:310`, `:371`
**Problem:** `createPaymentWithPermit`, `createPaymentWithPermit2`, and `createPaymentWithDaiPermit` all call `_consumePaymentIntent` with the same `PAYMENT_INTENT_TYPEHASH` and the same field set. The intent does not commit to a settlement mechanism, so a relayer holding a buyer's intent signed for the Permit2 flow can execute it through the EIP-2612 or DAI flow instead — relevant when the buyer already carries a standing allowance to the vault (notably after any DAI `allowed=true` permit, SC-24), because the `try/catch` at `:216`/`:385` means the missing permit signature is not a blocker. The buyer's economic outcome is identical (same merchant, same amount, same nonce), so this is a correctness/observability issue rather than a loss of funds.
**Fix:** Add a `uint8 flow` (or `bytes32 method`) field to the typehash and `require` it matches the entry point being used, so the intent is bound to the mechanism the buyer's wallet actually presented.
**Effort:** M

---

### SC-24 — The DAI path leaves the vault with an unlimited standing allowance and offers no revoke helper

**Severity:** Low
**File:** `packages/contracts/src/PaymentVault.sol:385`–`:389`
**Problem:** DAI's legacy permit with `allowed = true` grants `type(uint256).max` allowance to the spender, as the comment at `:382` acknowledges. After a single one-time payment the vault retains unlimited allowance on the buyer's DAI indefinitely. Nothing in `PaymentVault` can misuse it without a fresh buyer intent signature, so this is not directly exploitable — but it is a permanent, invisible standing approval created by what the user experiences as a one-off checkout, and it is precisely the residual-allowance condition that makes SC-01 and SC-23 practical.
**Fix:** After the transfers at `:399`–`:404`, call `IDaiLikePermit(p.token).permit(p.buyer, address(this), p.daiNonce + 1, p.permitExpiry, false, ...)` if a revoke signature is supplied, or expose `function revokeDaiAllowance(address token)` that the buyer can call. At minimum document the residual allowance in `README.md`.
**Effort:** M

---

### SC-25 — `PaymentReceived` carries no unique payment identifier

**Severity:** Low
**File:** `packages/contracts/src/PaymentVault.sol:59`–`:68`
**Problem:** The event exposes `(payer, merchant, token, amount, fee, productId, customerId, timestamp)` with no payment id and no intent nonce. The indexer matches on `(merchant, customerId)` (`packages/indexer/src/handlers.ts:162`–`:190`), where `customerId` is `keccak256(session.id)` — workable, but it means two payments against the same checkout session are indistinguishable at the event level, and the nonce that uniquely orders a buyer's intents is consumed at `:127` and then thrown away.
**Fix:** Add the consumed nonce as an indexed field: have `_consumePaymentIntent` return `nonce` and include it in `PaymentReceived`. That gives every gasless payment a `(payer, nonce)` primary key with no extra storage cost. Regenerate the ABI (SC-06).
**Effort:** S

---

### SC-26 — Storage packing: `Subscription.status` wastes a full slot per subscription

**Severity:** Low
**File:** `packages/contracts/src/SubscriptionManager.sol:61`–`:73`
**Problem:** Fields are laid out `subscriber(20) | merchant(20) | token(20) | amount(32) | interval(32) | nextChargeDate(32) | productId(32) | customerId(32) | createdAt(32) | status(1) | totalCharged(32)`. Because `status` follows a full 32-byte word it opens a fresh slot and uses one byte of it — 11 slots where 10 suffice. Moving `Status status` to immediately after `address token` packs it into that slot's remaining 12 bytes, saving one `SSTORE` (~20k gas cold) on every subscription creation, of which there are four sites (`:195`, `:275`, `:370`, `:492`). Similarly `platformFee` is capped at 1000 (`:124`) yet occupies a full word at `:76`; as `uint16` it packs with `platformWallet` at `:75`.
**Fix:** Reorder the struct to `address subscriber; address merchant; address token; Status status; uint256 amount; …` and narrow `platformFee` to `uint16` in both contracts. Both are layout changes — only safe as part of a redeploy, which the comment at `:84` indicates is already the model.
**Effort:** S

---

### SC-27 — Slither config suppresses all low and informational detectors

**Severity:** Low
**File:** `packages/contracts/slither.config.json:3`–`:5`
**Problem:** `"exclude_low": true`, `"exclude_informational": true`, `"exclude_optimization": true` combined with the workflow's `fail-on: medium` (`.github/workflows/slither.yml`) means the CI gate never surfaces low-severity findings at all — not even as non-blocking output. Several issues in this report (unchecked downcasts SC-20, missing zero-address validation SC-18, the dead enum SC-21) sit in exactly that band. `"filter_paths": "lib/|test/"` is correct for `lib/` but also silences everything in `test/`.
**Fix:** Set `exclude_low` and `exclude_informational` to `false` and keep `fail-on: medium` — findings then appear in the SARIF upload and PR annotations without blocking the build. Keep `exclude_optimization: true`.
**Effort:** S

---

### SC-28 — Fuzz and invariant testing is configured but never used

**Severity:** Low
**File:** `packages/contracts/foundry.toml:13`–`:14`, `.github/workflows/forge-test.yml` (`--fuzz-runs 1000`)
**Problem:** `[profile.default.fuzz] runs = 256` is set and CI runs `forge test --fuzz-runs 1000 -vv` with a comment claiming fuzzing catches "arithmetic edge cases the unit tests won't hit". Grepping `test/` for `testFuzz`, `invariant_`, and `StdInvariant` returns zero matches across all 13 test files (2952 lines). The fuzz configuration and the CI flag are inert.
**Fix:** Add at minimum `testFuzz_feeSplitIsLossless(uint256 amount, uint256 feeBps)` asserting `fee + merchantAmount == amount` for the full input range, and a `StdInvariant` handler asserting neither contract ever holds a non-zero token balance between transactions (the documented non-custodial invariant, `README.md:33`).
**Effort:** M

## Test Coverage Gaps

| Contract / function | Untested branch | Why it matters |
|---|---|---|
| `SubscriptionManager.addSubscriptionBackupPayer` `:919`–`:931` | Backup added with a **junk or already-consumed permit** — the `catch` branch is never exercised. `test/SubscriptionManagerBackup.t.sol` always supplies a valid permit via `_buildBackupParams` (`:290`–`:306`). | This is exactly the branch that makes SC-01 (Critical) exploitable. A test asserting `getSubscriptionBackups` is unchanged when the permit fails would have caught it. |
| `SubscriptionManager._tryProcessPayment` `:814` | A backup wallet **that never signed anything** funding a charge. No test asserts the backup consented. | SC-01. |
| `SubscriptionManager.removeSubscriptionBackupPayer` `:938` | Backup attempting self-removal — `test_remove_reverts_for_non_subscriber` (`:188`) actually *asserts* the victim cannot remove itself, encoding SC-02 as intended behavior. | The test locks in the bug. |
| `SubscriptionManager.chargeSubscription` `:562` | Any call with `subscriptionId >= nextSubscriptionId`. | SC-05 — phantom PastDue/Cancelled events reach the indexer. |
| `SubscriptionManager` PastDue state `:585` | No test attempts to charge or recover a subscription after it goes PastDue; `test_past_due_when_all_payers_empty` (`:118`) stops at the status assertion. | SC-08 — nothing documents or verifies that PastDue is terminal. |
| `SubscriptionManager._tryChargePermit2` `:544`–`:548` | The fee-leg-fails-after-merchant-leg-succeeds path. The `StubPermit2Allowance` in `test/SubscriptionManagerPermit2.t.sol:26` cannot fail one leg and not the other. | SC-07 — silent accounting corruption. |
| `SubscriptionManager.createSubscriptionWithPermit2` `:445` | `details.expiration` shorter than one interval; `details.amount < p.amount`; `sigDeadline != p.deadline`. | SC-09 — each produces a subscription that dies on cycle 2. |
| `SubscriptionManager.acceptSubscriptionWalletUpdate` `:658` | Migration of a **Permit2** subscription, and migration to a wallet with zero allowance. `test_requestAndAcceptSubscriptionWalletUpdate` only covers the funded ERC-20 case. | SC-16 — silent guaranteed failure one interval later. |
| Both contracts, `transferOwnership` / `acceptOwnership` / `renounceOwnership` | Zero tests. Grep for `transferOwnership` in `test/` returns nothing. | `Ownable2Step` is the entire admin security story (SC-04, SC-14) and none of it is verified. |
| Both contracts, `ReentrancyGuard` | Zero tests. No malicious-token or malicious-merchant reentrancy harness exists. | `nonReentrant` is claimed in `README.md:14` but never demonstrated; the Permit2 vault path holds real balances mid-transaction (`PaymentVault.sol:321`–`:330`). |
| `PaymentVault` / `SubscriptionManager` fee math | No fuzz test over `(amount, feeBps)`. All fee assertions use the single hardcoded `(10e6, 50)` pair. | SC-28 — the `fee + merchantAmount == amount` invariant and the `"Amount too small for fee"` boundary (`PaymentVault.sol:153`) are unverified across the range. |
| `setPlatformFee` mid-lifecycle | No test changes the fee between a subscription's creation and its next charge, or between intent signing and settlement. | SC-03 — the retroactive-fee behavior is undocumented and unasserted. |
| `PaymentVault.createPaymentWithPermit2` / `createPaymentWithDaiPermit` | Real Permit2 signature verification. `test/PaymentVaultPermit2.t.sol` and `test/SubscriptionManagerPermit2.t.sol:9`–`:12` both `vm.etch` a stub that skips EIP-712 verification entirely ("that's Uniswap's problem"). | Defensible for Permit2's internals, but it means no test proves the vault passes the right `owner`/`spender`/`nonce` to a real Permit2. Only `test/mainnet-fork/PaymentVaultMainnetFork.t.sol` hits a real token, and only on the EIP-2612 path. |
| Fee-on-transfer / rebasing token behavior | Zero tests. `MockUSDC` is a plain OZ ERC20. | SC-12 — the Permit2 vault path's exact-amount assumption is unverified. |

## Quick Wins

- **SC-02** — one `||` clause; removes the victim's lock-in.
- **SC-06** — run `./export-abi.sh`, commit, add a `git diff --exit-code abi/` step to `forge-test.yml`.
- **SC-14** — three-line `renounceOwnership` override in each contract.
- **SC-04** — add `transferOwnership(MULTISIG_OWNER)` plus four post-deploy `require`s to `DeployMainnet.s.sol`.
- **SC-05** — add `Status.None` as the zero member, or `require(subscriptionId < nextSubscriptionId)` on the five entry points.
- **SC-09** — three `require` statements in `createSubscriptionWithPermit2`.
- **SC-18** — one `require` per constructor.
- **SC-19** — move the deadline check inside `_consumeSubscriptionIntent`.
- **SC-27** — flip two booleans in `slither.config.json`.
