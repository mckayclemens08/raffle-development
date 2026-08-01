import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { base, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, fallback, http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { DEV_WALLETS_ENABLED, devWalletConnectors } from "./devWallets";

/// Our own node first, a public endpoint behind it.
///
/// Reading and writing through a single hosted RPC means a rate limit, outage
/// or account suspension there takes the app down while the chain itself is
/// perfectly healthy. `fallback` tries each transport in order, so the hosted
/// endpoint becomes a safety net rather than the critical path.
///
/// Set NEXT_PUBLIC_RPC_URL to our node and NEXT_PUBLIC_RPC_FALLBACK_URL to a
/// hosted provider. With neither set this collapses to the chain's default
/// public RPC, which is fine for local and preview work.
///
/// These are read as literal `process.env.X` references on purpose: Next only
/// inlines statically-analysable lookups into the client bundle, so a computed
/// key like process.env[`RPC_${id}`] would silently be undefined in the browser.
function transportFor() {
  const endpoints = [
    process.env.NEXT_PUBLIC_RPC_URL,
    process.env.NEXT_PUBLIC_RPC_FALLBACK_URL,
  ].filter((url): url is string => Boolean(url));

  if (endpoints.length === 0) return http();
  // The trailing `http()` keeps the chain's public default as a last resort.
  return fallback([...endpoints.map((url) => http(url)), http()]);
}

// `hardhat` (chain 31337) is included for local development against `npx hardhat node`.
// Drop it once the app only targets deployed testnet/mainnet contracts.
// In dev-wallet mode hardhat goes first so any request that falls back to
// `chains[0]` still resolves to the local node rather than a public RPC.
const chains = DEV_WALLETS_ENABLED ? ([hardhat, sepolia] as const) : ([sepolia, hardhat] as const);

const walletConnectors = connectorsForWallets(
  [
    {
      // Base Account (Coinbase's Smart Wallet): passkey-based, created instantly in the
      // browser via Face ID/Touch ID — no extension or app install. Featured first so it's
      // the default path for non-crypto-native users.
      groupName: "Recommended",
      wallets: [base],
    },
    {
      groupName: "More options",
      wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  {
    appName: "Decentralized Lottery",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  }
);

// Built with createConfig rather than RainbowKit's getDefaultConfig because that
// helper omits `connectors` — and the dev wallets have to be registered here (not
// passed ad hoc to connect()) for wagmi to reconnect them after a page reload.
export const wagmiConfig = createConfig({
  connectors: [...walletConnectors, ...devWalletConnectors()],
  chains,
  transports: {
    // Local dev always talks to the hardhat node directly; only the public
    // chain benefits from the failover chain.
    [hardhat.id]: http(),
    [sepolia.id]: transportFor(),
  },
  ssr: true,
});
