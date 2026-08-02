# Running a beta

Getting off the local machine and in front of real testers, on a public test network with
worthless money. Nothing here involves real funds, and nothing here needs a gambling licence —
that only becomes necessary the moment real money is involved.

**Target:** Base Sepolia (chain `84532`). It's Base's test network, so the Coinbase passkey wallet
the app features works natively, and gas is free from faucets.

---

## What you need first

| Thing | Where | Cost |
|---|---|---|
| A **deployer wallet** — throwaway, not your real one | Any wallet; export the private key | free |
| Base Sepolia ETH for that wallet | A Base Sepolia faucet | free |
| Your **admin wallet address** — the one you'll actually use | Your normal wallet | free |
| A **WalletConnect project ID** | cloud.reown.com | free |
| A Vercel account | vercel.com | free tier is fine |

> **Use a throwaway wallet to deploy.** Its private key goes in a `.env` file and later into Vercel.
> Your admin wallet's key never touches either — ownership is handed over separately, which is the
> whole point of the two-step design.

Optional, for a more realistic beta: a **Chainlink VRF subscription** (coordinator address, key hash,
subscription ID from [the supported-networks list](https://docs.chain.link/vrf/v2-5/supported-networks),
funded with test LINK). Without it the deploy falls back to a mock coordinator and you fulfil draws
yourself — fine for testing the product, but say so to testers, because the draw is then trusted
rather than provable.

---

## 1. Deploy the contracts

```bash
cd contracts
cp .env.example .env      # fill in PRIVATE_KEY and ADMIN_ADDRESS
```

```bash
PRIVATE_KEY=<deployer key> \
ADMIN_ADDRESS=<your real wallet address> \
ROUND_DURATION_SECONDS=172800 \
npx hardhat run scripts/deploy-testnet.ts --network baseSepolia
```

Add `VRF_COORDINATOR`, `VRF_KEY_HASH` and `VRF_SUBSCRIPTION_ID` if you set up a subscription;
omit them to use the mock. Add `USDC_ADDRESS` to settle in a real token; omit it to get a mintable
test token plus the in-app faucet, which is what you want for a beta.

**Set a short round.** `172800` is two days. The default month means testers never see a draw, and
the draw is the most important thing to test.

The script prints a block of environment variables at the end. Keep it.

## 2. Take ownership with your real wallet

The deploy only *offers* you ownership. Accept it from the wallet you'll actually administer with:

```bash
PRIVATE_KEY=<your admin key> \
LOTTERY_ADDRESS=0x... MARKET_ADDRESS=0x... COMPLIANCE_ADDRESS=0x... \
npx hardhat run scripts/accept-ownership.ts --network baseSepolia
```

Prefer not to put your admin key in a file at all? Reasonable. Call `acceptOwnership()` on each of
the three contracts from a wallet UI or from the contract page on the block explorer — identical
effect, key never leaves your wallet.

Accepting is what proves you can sign with that wallet *while the deployer can still fix a mistake*.
A one-step transfer to a mistyped address would brick the contracts permanently.

Afterwards, connect that wallet on the deployed site and `/admin` appears. There's no password and no
account — the page checks whether your connected address matches the contract owner.

## 3. Deploy the site to Vercel

Push to GitHub, then in Vercel: **New Project** → import the repo.

- **Root directory:** `web`
- Framework preset: Next.js (auto-detected)

Environment variables — paste the block the deploy script printed, plus:

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=   # from cloud.reown.com
COMPLIANCE_VERIFIER_KEY=                # deployer key, or a dedicated signer
NEXT_PUBLIC_DEV_WALLETS=false           # must be false
```

`COMPLIANCE_VERIFIER_KEY` is server-side only — it signs identity attestations. It must belong to an
address registered as a verifier in `ComplianceRegistry` (the deployer is, by default).

**`NEXT_PUBLIC_DEV_WALLETS` must be `false`.** True would expose one-click sign-in as Hardhat's
publicly known test accounts.

Deploy. The app comes up with a beta banner, and the faucet appears if you deployed the mock token.

## 4. Dry-run it yourself before inviting anyone

Do a complete round alone, in a browser you've never connected before:

1. Connect a wallet you've never used here — the passkey option is the one testers will pick.
2. Get test dollars from the faucet.
3. Verify identity at `/verify` (the stub approves anything well-formed).
4. Buy a ticket. Buy a second so the price visibly moves.
5. List one on the market from a second wallet, and buy it from a third.
6. Wait out the round, then trigger the draw — `/admin`, or let the keeper do it.
7. Claim the prize as the winner.
8. Withdraw fees from `/admin`.

If any step confuses *you*, it will stop a tester cold.

## 5. Keep rounds moving

Rounds don't advance themselves. Either run the keeper somewhere always-on:

```bash
npx hardhat run scripts/keeper.ts --network baseSepolia
```

…or do it by hand from `/admin`. If you're using the mock coordinator you must also fulfil each
draw, so the keeper alone isn't enough there.

---

## What to ask testers

Give them the URL, and this:

> This is a test on a fake network. The dollars are play money and prizes are worthless — please
> don't send real funds anywhere. You'll need a wallet; the passkey option needs no app install.
> Tap "Get $500 test USDC" to fund yourself.

The three questions worth asking:

1. **Where did you get stuck or confused?** Especially anything before your first ticket — wallet,
   faucet, verification. That funnel is where a real product loses people.
2. **Did anything behave unexpectedly, or look wrong on your phone?**
3. **Would you have used real money here? Why not?**

The third one is the one that matters. Everything else is fixable.

## What this beta does *not* test

- **Real money behaviour.** People are more careful, and more upset, with their own funds.
- **Identity verification.** The check is a stub; it approves anything well-formed.
- **Load.** A handful of testers on a test network proves nothing about hundreds of concurrent
  players.
- **Security.** A clean beta is not an audit. Nothing here substitutes for one.

## Turning off the local development environment

Once the beta is live you don't need the Hardhat node running. To go back to local work:

```bash
npx hardhat node                                             # terminal 1
npx hardhat run scripts/deploy-local.ts --network localhost  # terminal 2
```

That rewrites `web/.env.local` to point at the local chain again. The two environments are only ever
distinguished by environment variables, so nothing needs to be uninstalled — Vercel keeps its own
copy of the settings and is unaffected by anything you do locally.
