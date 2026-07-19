# Decentralized Lottery

Monorepo for the on-chain raffle + secondary ticket market described in the proposal.

- `contracts/` — Solidity contracts (Hardhat 2 + ethers v6), Chainlink VRF v2 for the draw
- `web/` — Next.js 16 + wagmi + RainbowKit frontend

## Contracts

```bash
cd contracts
npm test              # run the test suite (14 tests, VRF mocked)
npm run compile
```

To try it against a local chain:

```bash
npx hardhat node                         # terminal 1, leave running
npm run --prefix ../ ... # (or) cd contracts && npx hardhat run scripts/deploy-local.ts --network localhost
```

`scripts/deploy-local.ts` deploys a mock VRF coordinator + both contracts and writes their
addresses straight into `web/.env.local`. Import one of the Hardhat node's printed private keys
into MetaMask, add a network for `http://127.0.0.1:8545` (chain id `31337`), and you can buy a
ticket for real against the running app.

After changing contract source, resync the ABIs the frontend reads:

```bash
cd contracts && npm run sync-abi
```

For Sepolia, fill in `contracts/.env` (copy from `.env.example`) with an RPC URL, a funded
deployer private key, and a real Chainlink VRF subscription, then write a `scripts/deploy.ts`
following the same pattern as `deploy-local.ts` but pointed at the real coordinator address/key
hash for Sepolia.

## Web app

```bash
cd web
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID from cloud.reown.com
npm run dev
```

`NEXT_PUBLIC_LOTTERY_ADDRESS` / `NEXT_PUBLIC_MARKET_ADDRESS` / `NEXT_PUBLIC_CHAIN_ID` point the
UI at a deployment — the local deploy script fills these in automatically for chain `31337`.

Pages: `/` (buy a ticket for the current round), `/tickets` (your tickets + claim prize),
`/market` (list/buy tickets on the secondary market).

## Known gaps before this is production-ready

- No real Chainlink VRF subscription wired up yet (only the mock, for tests/local dev)
- No `startNewRound` automation — currently an owner-only manual call
- The regulatory/licensing claims in the original proposal (Section 5) are unverified — get real
  legal counsel before launching a real-money lottery
- No rate limiting / KYC / geofencing (proposal Section 3) — none of that exists yet
