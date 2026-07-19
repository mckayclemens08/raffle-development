import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { hardhat, sepolia } from "wagmi/chains";

// `hardhat` (chain 31337) is included for local development against `npx hardhat node`.
// Drop it once the app only targets deployed testnet/mainnet contracts.
export const wagmiConfig = getDefaultConfig({
  appName: "Decentralized Lottery",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  chains: [sepolia, hardhat],
  ssr: true,
  wallets: [
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
});
