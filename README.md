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
