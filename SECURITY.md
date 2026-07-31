# Security Policy

Paylix moves other people's money on-chain. Security reports are welcome and
taken seriously.

## Reporting a Vulnerability

**Do NOT report security vulnerabilities through public GitHub issues, pull
requests, or discussions.**

### Preferred: GitHub Private Vulnerability Reporting

Open a private advisory at
<https://github.com/JanoTheDev/paylix/security/advisories/new>
(repository → **Security** tab → **Report a vulnerability**).

This is the preferred channel: the report is encrypted in transit and at rest
by GitHub, it creates a private fork we can patch in, and it gives you a CVE
and credit automatically when the advisory is published. No key exchange
needed.

### Fallback: email

If you cannot use GitHub advisories, email **security@paylix.dev**.

There is currently **no published PGP key** for this address — do not assume
the mail path is confidential. For anything involving an exploitable
fund-drain path, use the GitHub advisory channel instead, or send a
non-sensitive "please contact me" note and we will agree an encrypted channel
before you send details.

### What to include

- A description of the vulnerability and the component it affects
- Steps to reproduce, ideally a failing test or a testnet transaction
- The potential impact — in particular whether funds, keys, or merchant data
  are reachable
- Any suggested fix (optional)

## Response Expectations

This is a small-maintainer open-source project, so the timelines below are
honest targets rather than a contractual SLA:

- **Acknowledgement:** within 5 business days
- **Triage and severity assessment:** within 10 business days
- **Fix and coordinated disclosure:** timing agreed with you, based on
  severity and whether the issue is being actively exploited

If you have not heard back within 10 business days, please ping the GitHub
advisory thread — it is far more likely we missed a notification than that we
are ignoring you.

## Safe Harbour

We will not pursue or support legal action against you for security research
that follows this policy, provided you:

- Only test against your own self-hosted instance or a public testnet — never
  against another operator's production deployment
- Do not access, modify, or exfiltrate data belonging to anyone else
- Do not run denial-of-service, spam, or social-engineering attacks
- Give us a reasonable window to remediate before public disclosure
- Do not exploit a finding beyond the minimum needed to demonstrate it — in
  particular, do not move funds you do not own

If you are unsure whether an action is in scope, ask first in the advisory
thread.

## Bug Bounty

There is **no funded bug bounty programme at this time.** We do not want to
imply a reward we cannot pay. Valid reports are credited in the advisory and
in release notes unless you prefer to stay anonymous.

Operators running Paylix on mainnet are strongly encouraged to publish their
own bounty before taking real traffic — see the go-live checklist in
[SELFHOST.md](SELFHOST.md).

## Scope

The following are in scope for security reports:

- **Smart contracts** (`packages/contracts/src/`) — reentrancy, access control, fund redirection, integer overflow, permit/intent bypass
- **Relayer and gasless flows** — intent signature forgery, replay attacks, nonce manipulation, any code path that reaches `safeTransferFrom` without first consuming the payment or subscription intent
- **API and authentication** — API key leakage, `pk_`/`sk_` capability confusion, authorization bypass, webhook signature spoofing
- **Indexer and keeper** — event spoofing, reorg handling, charging a subscription that should not be charged
- **SDK** — signature construction bugs that could lead to incorrect on-chain behavior
- **Infrastructure** — secrets exposure, insecure defaults in Docker/env configuration

## Out of Scope

- Vulnerabilities in third-party dependencies (report these upstream; tell us
  if Paylix's usage makes an upstream issue exploitable here)
- Issues in the Foundry/OpenZeppelin libraries under `packages/contracts/lib/`
- Social engineering attacks
- Denial of service against public testnets
- Findings that require an operator to have already leaked their own
  `MAINNET_DEPLOYER_PRIVATE_KEY` or `.env`
- Missing security headers or best-practice warnings with no demonstrated
  impact

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest on `master` | Yes |
| Previous releases | Best effort |

Paylix is self-hosted software. Operators are responsible for deploying
patched versions to their own instances; there is no central deployment we
can fix on your behalf.
