import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { hardhat, sepolia } from "wagmi/chains";

// `hardhat` (chain 31337) is included for local development against `npx hardhat node`.
// Drop it once the app only targets deployed testnet/mainnet contracts.
export const wagmiConfig = getDefaultConfig({
  appName: "Decentralized Lottery",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  chains: [sepolia, hardhat],
  ssr: true,
});
