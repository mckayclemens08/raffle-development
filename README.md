# Decentralized Lottery

An on-chain monthly raffle with a secondary market for tickets. Tickets are NFTs whose price rises
with demand inside a round; the winner is drawn with Chainlink VRF and paid from an escrowed pool.

- `contracts/` — Solidity (Hardhat 2, ethers v6), Chainlink VRF 2.5
- `web/` — Next.js 16, wagmi + RainbowKit, passkey wallet featured for no-install signup
- `docs/` — [operations runbooks](docs/operations.md) and [compliance](docs/compliance.md)

> **Not licensed, not audited, not handling real money.** See
> [what's still missing](docs/compliance.md#what-is-not-production-ready) before going anywhere near
> a real deployment.

## Quickstart

Three terminals. From the repo root:

```bash
npx hardhat node --config contracts/hardhat.config.ts        # 1. local chain
```

```bash
cd contracts
npx hardhat run scripts/deploy-local.ts --network localhost   # 2. deploy + seed
npx hardhat run scripts/simulate-activity.ts --network localhost   # optional: buy some tickets
```

```bash
cd web && cp .env.local.example .env.local && npm run dev     # 3. app on :3000
```

`deploy-local.ts` deploys a mock VRF coordinator, a mock USDC, the compliance registry and both
contracts, mints test USDC to the first dev accounts, and writes every address into
`web/.env.local` — so the app points at the fresh deployment automatically.

### Clicking through without a wallet

`NEXT_PUBLIC_DEV_WALLETS=true` (already set by the quickstart) puts a **DEV MODE** bar at the top of
the app with one-click sign-in as Admin or one of three players. The transactions are real — Hardhat
unlocks its own accounts, so the node signs for them — which means buying, listing, drawing and
claiming all mine actual blocks.

Player 3 is deliberately left unverified so the blocked-user experience is visible.

**Never enable this on a real deployment**: those are Hardhat's well-known public test keys.

## How it settles

Tickets and resales settle in **USDC** (6 decimals), so prices read as dollars. Buying is the usual
ERC-20 two-step — approve, then buy — and `buyTicket(maxPrice)` takes a price cap so demand can
never charge a buyer more than they were quoted.

The settlement token is swappable without redeploying; see
[switching the stablecoin](docs/operations.md#switching-the-settlement-stablecoin).

## Common tasks

```bash
cd contracts
npm test                  # 49 tests (VRF, USDC and compliance mocked)
npm run compile
npm run sync-abi          # after changing contract source — the web app reads these ABIs
npx hardhat run scripts/keeper.ts --network localhost   # round scheduler; KEEPER_ONCE=true for one pass
```

```bash
cd web
npx tsc --noEmit && npx eslint .
```

Static analysis matches CI:

```bash
pip install slither-analyzer
cd contracts && slither . --exclude-dependencies \
  --filter-paths "node_modules|contracts/mocks" \
  --exclude-informational --exclude-low --fail-medium
```

## Pages

| Route | What it does |
|---|---|
| `/` | Current round — buy a ticket, live pool chart |
| `/tickets` | Your tickets, and claiming a prize |
| `/market` | Secondary market: list and buy tickets |
| `/verify` | Identity verification (stubbed — see compliance docs) |
| `/responsible-gambling` | Self-exclusion, limits, helplines |
| `/admin` | Owner only: draws, rounds, treasury, pause, compliance |
| `/rules`, `/terms`, `/privacy` | Published game rules and policies |

## Deploying to a testnet

Copy `contracts/.env.example` to `contracts/.env` and fill in an RPC URL, a funded deployer key and
a real Chainlink VRF subscription. Then write a `scripts/deploy.ts` following `deploy-local.ts`,
passing the chain's canonical USDC address instead of deploying a mock.

Read [operations](docs/operations.md) first — self-hosted RPC, the keeper, and the runbooks for
swapping the randomness oracle or the settlement token all matter more once real value is at stake.
