# Operations

Runbooks for running the platform, and the reasoning behind which suppliers we depend on.

The principle: **own the plumbing, keep the trust external.** No single supplier should be able to
halt the platform — but nothing we bring in-house should require players to trust us more than they
already do. That second half is why the draw stays with an oracle.

## Self-hosted infrastructure

### RPC — our node first, hosted as a fallback

Set `NEXT_PUBLIC_RPC_URL` to our own node and `NEXT_PUBLIC_RPC_FALLBACK_URL` to a hosted provider.
The app uses viem's `fallback` transport, so a rate limit or outage at a hosted endpoint degrades
instead of taking the site down. With neither set it uses the chain's public default, which is fine
locally.

### Round scheduling — our keeper, not a keeper network

```bash
npx hardhat run scripts/keeper.ts --network <net>     # loops; KEEPER_ONCE=true for one pass
```

It closes rounds, retries a stalled draw once `drawRetryTimeout` has elapsed, and opens the next one.

**It is a convenience, not a dependency.** `requestDraw` and `sweepUnclaimed` are permissionless
on-chain, so if the keeper dies, is misconfigured, or the company disappears, any player can resolve
a round themselves. Only `startNewRound` needs the owner key, and a missed start delays new sales
rather than trapping anyone's money. Don't "improve" this by making the contract depend on it.

### Geolocation — a local database, not a vendor call per request

`web/lib/geo.ts` resolves through an ordered chain: a locally held licensed database
(`GEOIP_DATABASE_PATH`) → CDN/proxy header → dev override. Providers sell the database as a
downloadable file precisely so it can be queried offline; refresh it on a schedule rather than
depending on their uptime for every player session.

Both `/api/compliance/geo` and `/api/compliance/verify` go through the same resolver, because two
implementations would eventually disagree about jurisdiction — and disagreeing about jurisdiction is
a compliance failure, not a bug.

Install the reader package only once a database is licensed; until then that source is skipped and
the chain degrades to headers. IP location is a deterrent, never a control — a VPN defeats it.

## Runbook: the randomness oracle fails

No contract changes needed. `setCoordinator` is owner-callable (inherited from
`VRFConsumerBaseV2Plus`) and `setVrfConfig` updates the key hash and subscription.

1. Wait out `drawRetryTimeout` and call `requestDraw` again — most stalls are transient.
2. If the outage persists, `setCoordinator` to an alternative VRF-compatible coordinator, then
   `setVrfConfig` for its key hash and subscription.
3. Call `requestDraw` again; the retry path accepts a new request for the same round.

The draw stays verifiable throughout. **We never generate the winning number ourselves** — if we
did, we would be choosing the winner, and no player or regulator would have reason to believe
otherwise.

## Runbook: switching the settlement stablecoin

`paymentToken` is settable on both contracts, guarded so it cannot change while either still owes
anyone money. A pool is denominated in whatever was paid into it, so switching mid-escrow would
leave prizes owed in one token and payable in another.

1. `pause()` the raffle and the market.
2. Let the open round finish and be claimed — or wait out the claim window and `sweepUnclaimed`.
3. `withdrawFees()` on both contracts.
4. `setPaymentToken(newToken)` on the raffle, then the market (it enforces a match with the raffle's).
5. **Update `NEXT_PUBLIC_USDC_ADDRESS` and redeploy the frontend.** Easy to forget, and it fails
   confusingly: the app would keep asking players to approve the old token, so every purchase
   reverts on an allowance the contract never sees. The contracts are the source of truth; the
   frontend has to be told.
6. `unpause()`.

`/admin` → **Settlement token** drives steps 4 and 5 and surfaces the outstanding-fee precondition,
rather than letting you discover it as a bare revert.

### Why the guard reads internal accounting, not `balanceOf`

An earlier version required `paymentToken.balanceOf(address(this)) == 0`. That is griefable: anyone
can send the contract a single token unit and block the migration permanently. The contracts track
`totalEscrowed` and `accruedFees` themselves, so dust inflates the balance without affecting what is
actually owed.

### Why not accept several stablecoins at once

Deliberately not implemented. A pool holding a mix of tokens has no single denomination, so a prize
can't be stated or paid cleanly, and rounding across tokens creates dust that belongs to nobody.
Accepting several tokens belongs at the edge — a swap before entry — not in the escrow contract.
Swapping the settlement token is what actually solves issuer-freeze risk.

## Contract safety properties

Worth knowing before changing any of it:

- **A round advances once *drawn*, not once claimed.** Requiring a claim meant one winner who never
  came back — lost keys, lost interest — halted the platform permanently.
- **Draws are retryable.** If the oracle accepts a request but the callback never lands, the round
  would otherwise be stuck and its pool locked forever. A late fulfilment of a superseded request is
  ignored rather than reverted, so it can't burn the subscription's gas.
- **Unclaimed prizes are sweepable after 90 days** (`claimWindow`), permissionlessly.
- **Fees accrue, they aren't pushed.** USDC can freeze an address; pushing a fee on every claim would
  let a frozen fee recipient block a winner's payout. `withdrawFees()` is separate.
- **Pausable** on buying, listing and trading — never on claiming, so players can always exit.
- **Two-step ownership** everywhere, so a mistyped handover can't brick a contract. Move to a
  multisig with a timelock before handling real money.

## Static analysis

Slither runs in CI and must stay clean at medium severity and above:

```bash
pip install slither-analyzer
cd contracts && slither . --exclude-dependencies \
  --filter-paths "node_modules|contracts/mocks" \
  --exclude-informational --exclude-low --fail-medium
```

Informational and low detectors are excluded deliberately — `timestamp` fires on every comparison in
a lottery measured in days, where a miner's few seconds of leeway is irrelevant. Genuine false
positives are annotated inline with `slither-disable-next-line` and a justification, rather than
being silenced globally.
