import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
// Base Sepolia is the beta target: it's Base's testnet, so the Coinbase passkey
// wallet we feature works natively, and gas is free from faucets.
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

/// Deployer key. Use a throwaway wallet funded with testnet ETH — never a
/// wallet holding anything real. Ownership is handed to the admin wallet
/// afterwards via scripts/transfer-ownership.ts, so this key does not need to
/// be the long-term owner.
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL,
      chainId: 84532,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    // Verifying source on the explorer matters for a gambling product: testers
    // should be able to read the contract that holds their money.
    apiKey: { baseSepolia: process.env.BASESCAN_API_KEY || "" },
  },
};

export default config;
