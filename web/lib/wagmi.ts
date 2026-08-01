import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { base, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { hardhat, sepolia } from "wagmi/chains";
import { DEV_WALLETS_ENABLED, devWalletConnectors } from "./devWallets";

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
    [hardhat.id]: http(),
    [sepolia.id]: http(),
  },
  ssr: true,
});
