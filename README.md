# Decentralized Lottery

Monorepo for the on-chain raffle + secondary ticket market described in the proposal.

- `contracts/` — Solidity contracts (Hardhat 2 + ethers v6), Chainlink VRF v2 for the draw
- `web/` — Next.js 16 + wagmi + RainbowKit frontend (Coinbase Smart Wallet featured for
  passkey-based, no-app-install signup)

## Payment currency

Tickets and secondary-market sales settle in **USDC** (6 decimals), not ETH. Prices read as
dollars in the UI. Buying is the standard ERC-20 two-step: approve the contract to spend USDC,
then buy. `LotteryTicket.buyTicket(maxPrice)` takes a price cap so a buyer is never charged more
than the price they were quoted, even if demand pushes the price up in the same block.

For local dev a `MockUSDC` (mintable by anyone) is deployed and seeded to the first five Hardhat
accounts. On a real network you'd pass the canonical USDC address for that chain instead.

## Running our own infrastructure

Implementing the dependency proposal: own the plumbing, keep the trust external.
The principle is that no single supplier should be able to halt the platform, **and** that
nothing we insource should require players to trust us more than they already do.

### RPC — our node first, hosted as a fallback

Set `NEXT_PUBLIC_RPC_URL` to our own node and `NEXT_PUBLIC_RPC_FALLBACK_URL` to a hosted provider.
The app uses viem's `fallback` transport, so a rate limit or outage at the hosted endpoint degrades
instead of taking the site down. With neither set it uses the chain's public default, which is fine
locally.

### Round scheduling — our keeper, not a keeper network

```bash
npx hardhat run scripts/keeper.ts --network <net>     # loops; KEEPER_ONCE=true for one pass
```

It closes rounds, retries a stalled draw once `drawRetryTimeout` has elapsed, and opens the next
round. **It is a convenience, not a dependency**: `requestDraw` and `sweepUnclaimed` are
permissionless on-chain, so if the keeper dies, is misconfigured, or the company disappears, any
player can resolve a round themselves. Only `startNewRound` needs the owner key, and a missed start
delays new sales rather than trapping money. Don't "improve" this by making the contract depend on it.

### Geolocation — a local database, not a vendor API call per request

`lib/geo.ts` resolves through an ordered chain: a locally held licensed database
(`GEOIP_DATABASE_PATH`) → CDN/proxy header → dev override. Providers sell the database as a file
precisely so it can be queried offline; refresh it on a schedule rather than depending on their
uptime for every player session. Both the `/geo` and `/verify` routes go through the same resolver,
because two implementations would eventually disagree about jurisdiction.

Install the reader package only once a database is licensed — until then that source is skipped and
the chain degrades to headers. IP location remains a deterrent, not a control: a VPN defeats it.

### Randomness fallback — no new contract code needed

`setCoordinator` is already owner-callable (inherited from `VRFConsumerBaseV2Plus`), and
`setVrfConfig` updates the key hash and subscription. So if the primary oracle fails:

1. Wait out `drawRetryTimeout` and retry — most stalls are transient.
2. If the outage persists, `setCoordinator` to an alternative VRF-compatible coordinator, then
   `setVrfConfig` for its key hash and subscription.
3. Call `requestDraw` again — the retry path accepts a new request for the same round.

The draw stays verifiable throughout. We never generate the number ourselves.

### Switching the settlement stablecoin

`paymentToken` is settable on both contracts, guarded so it cannot change while the contract holds
a balance — a pool is denominated in whatever was paid in, so switching mid-escrow would leave
prizes owed in one token and payable in another. The procedure:

1. `pause()` the raffle and the market.
2. Let the open round finish and be claimed, or wait out the claim window and `sweepUnclaimed`.
3. `withdrawFees()` on both contracts.
4. `setPaymentToken(newToken)` on the raffle, then the market (it enforces a match with the raffle's).
5. **Update `NEXT_PUBLIC_USDC_ADDRESS` and redeploy the frontend.** Easy to forget and it fails
   confusingly: the app would keep asking players to approve the old token, so every purchase
   reverts on an allowance the contract never sees. The contracts are the source of truth; the
   frontend has to be told.
6. `unpause()`.

There is an admin panel for steps 4 and 5 at `/admin` → Settlement token, which surfaces the
outstanding-fee precondition instead of letting you discover it as a bare revert.

**Why not multiple stablecoins in one pool?** Deliberately not implemented. A pool holding a mix of
tokens has no single denomination, so a prize can't be stated or paid cleanly, and rounding across
tokens creates dust that belongs to nobody. Accepting several tokens belongs at the edge — a swap
before entry — not in the escrow contract. Swapping the settlement token is what actually solves the
issuer-freeze risk.

## Player protection & contract safety

Implemented in response to the launch-readiness review:

- **A round advances once it is *drawn*, not once it is claimed.** Requiring a claim meant one
  winner who never came back (lost keys, lost interest) halted the platform permanently.
- **Draws are retryable.** If Chainlink accepts a request but the callback never lands, the round
  would otherwise be stuck and its pool locked forever. After `drawRetryTimeout` anyone can reissue.
  A late fulfilment of a superseded request is ignored rather than reverted.
- **Unclaimed prizes are swept after 90 days** (`claimWindow`), permissionlessly.
- **Fees accrue, they aren't pushed.** USDC can freeze an address; pushing a fee on every claim
  would let a frozen fee recipient block a winner's payout. `withdrawFees()` is separate.
- **Pausable** on buying, listing and trading — never on claiming, so players can always exit.
- **Two-step ownership** on every contract, so a mistyped handover can't brick them. Move to a
  multisig with a timelock before real money.
- **Chainlink VRF 2.5** (the v2 interface is superseded).
- **Self-exclusion is on-chain and one-way.** A player can start or extend it; nobody — not the
  player, not the operator, and not by re-verifying — can shorten or lift one. Winnings already held
  stay claimable, which is why the registry separates `isAllowed` (may play) from `canClaim`
  (may be paid).
- **Session limits**: hourly reality checks and an enforced 15-minute break after four continuous
  hours, per the licence conditions.

Static analysis runs in CI:

```bash
pip install slither-analyzer
cd contracts && slither . --exclude-dependencies --filter-paths "node_modules|contracts/mocks"
```

Remaining Slither output is informational — chiefly `timestamp` (inherent to a time-based lottery,
where the tolerance is days and a miner can shift seconds) and naming conventions.

## KYC & geofencing

Participation is gated by `ComplianceRegistry`. **The gate is enforced on-chain, not in the UI** —
`buyTicket`, `listTicket`, the market's `buyTicket`, `claimPrize`, and every ERC-721 transfer all
check the registry. That matters because the contracts are permissionlessly callable: a
frontend-only check would be bypassed by anyone calling the contract directly.

- **No personal data on-chain.** The registry stores only a wallet address, an ISO 3166-1 alpha-2
  country code, timestamps, and an opaque `providerRef` hash. Names, dates of birth and document
  numbers never touch the chain.
- **Transfers are gated too**, so a ticket can't be handed to an unverified or blocked address
  via a raw `transferFrom`, and every holder is verified by construction.
- **Blocking a jurisdiction is retroactive** — flip a country off and everyone verified from it
  loses access immediately, without re-verification.
- **A lapsed winner's prize is withheld, not lost.** It stays escrowed in the round and releases
  once they re-verify.
- Verifications carry a **1-year expiry**, matching the periodic re-verification regulators expect.

The flow: `/verify` → `POST /api/compliance/verify` → geo + age + field checks → the backend
verifier key writes an attestation to the registry. `GET /api/compliance/geo` resolves the
country server-side from CDN headers (`x-vercel-ip-country`, `cf-ipcountry`, …).

Admin (`/admin`) has a Compliance panel to block/unblock a jurisdiction and revoke a wallet.

### What is NOT production-ready here

Read this before assuming the app is compliant:

1. **The identity check is a stub.** `runIdentityCheck` in `app/api/compliance/verify/route.ts`
   only sanity-checks the submitted fields. A licensed operator replaces it with a provider
   (Persona, Sumsub, Onfido, Veriff, Jumio) that captures a government ID, does a liveness/selfie
   match, and screens against sanctions and PEP lists — returning a decision by signed webhook.
2. **IP geolocation is a deterrent, not a control.** A VPN defeats it in one click. Production
   needs a commercial geo database (MaxMind GeoIP2, IP2Location) *plus* VPN/proxy/hosting-provider
   detection, cross-checked against the document country and the payment instrument.
3. **The blocked-country list in `lib/compliance.ts` is a placeholder**, not legal advice. The real
   list depends on the licence you hold and must come from gaming counsel. US restrictions in
   particular are state-by-state.
4. **The verifier key is a trusted backend signer.** It can allowlist anyone, so it needs the same
   protection as the owner key (KMS/HSM, not an env var) in production.
5. **None of this substitutes for licensing.** Identity checks are one requirement among many —
   AML program, transaction monitoring, responsible-gaming controls, segregated player funds,
   audits, and a licence for every jurisdiction served.

## Contracts

```bash
cd contracts
npm test              # run the test suite (15 tests, VRF + USDC mocked)
npm run compile
```

To try it against a local chain:

```bash
npx hardhat node                                          # terminal 1, leave running
npx hardhat run scripts/deploy-local.ts --network localhost   # terminal 2
```

`scripts/deploy-local.ts` deploys a mock VRF coordinator, MockUSDC, and both contracts, mints
test USDC to the first five dev accounts, and writes all addresses straight into
`web/.env.local`. Import one of the Hardhat node's printed private keys into MetaMask, add a
network for `http://127.0.0.1:8545` (chain id `31337`), and you can buy a ticket for real
against the running app.

### Dev wallets (no wallet app needed)

Set `NEXT_PUBLIC_DEV_WALLETS=true` in `web/.env.local` and a **DEV MODE** bar appears at the
top of the app with one-click "sign in as" buttons for Admin (the contract owner) and three
players. This exists so you can click through the wallet-gated screens — My Tickets, the
"List a ticket" form, and `/admin` — without installing MetaMask or creating a passkey.

The transactions are real: Hardhat unlocks its own dev accounts, so the node signs for them.
Buying, approving, listing, drawing and claiming all mine actual blocks and move test USDC.
The choice persists across reloads, and the `/admin` nav link only appears for the owner.

Populate the local chain with activity to look at:

```bash
npx hardhat run scripts/simulate-activity.ts --network localhost   # buys tickets (TICKETS=6)
npx hardhat run scripts/list-ticket.ts --network localhost         # lists one (TICKET=, PRICE_USD=)
```

Never set `NEXT_PUBLIC_DEV_WALLETS=true` for a real deployment — the addresses are Hardhat's
well-known public test accounts.

After changing contract source, resync the ABIs the frontend reads:

```bash
cd contracts && npm run sync-abi
```

For Sepolia, fill in `contracts/.env` (copy from `.env.example`) with an RPC URL, a funded
deployer private key, and a real Chainlink VRF subscription, then write a `scripts/deploy.ts`
following the same pattern as `deploy-local.ts` — pass Sepolia's canonical USDC address (or a
test token) instead of deploying MockUSDC.

## Web app

```bash
cd web
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID from cloud.reown.com
npm run dev
```

`NEXT_PUBLIC_LOTTERY_ADDRESS` / `NEXT_PUBLIC_MARKET_ADDRESS` / `NEXT_PUBLIC_USDC_ADDRESS` /
`NEXT_PUBLIC_CHAIN_ID` point the UI at a deployment — the local deploy script fills these in
automatically for chain `31337`.

Pages: `/` (buy a ticket for the current round), `/tickets` (your tickets + claim prize),
`/market` (list/buy tickets on the secondary market), `/admin` (owner-only: trigger draws,
start rounds, tune pricing/fees/VRF).

## Known gaps before this is production-ready

- No real Chainlink VRF subscription wired up yet (only the mock, for tests/local dev)
- No `startNewRound` automation — currently an owner-only manual call from `/admin`
- The regulatory/licensing claims in the original proposal (Section 5) are unverified — get real
  legal counsel before launching a real-money lottery
- No rate limiting / KYC / geofencing (proposal Section 3) — none of that exists yet
- WalletConnect project ID is a placeholder — create one at cloud.reown.com
