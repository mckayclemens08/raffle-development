import { mock } from "wagmi/connectors";
import type { CreateConnectorFn } from "wagmi";

/// Dev-only wallet impersonation.
///
/// Set NEXT_PUBLIC_DEV_WALLETS=true against a local `hardhat node` to get
/// one-click "connect as…" buttons instead of needing a real wallet app.
/// It works because Hardhat unlocks its own dev accounts: the mock connector
/// forwards `eth_sendTransaction` straight to the node, which signs for us.
/// Transactions are therefore real (they mine, emit events, move test USDC).
///
/// Never enable this against a network you don't control — the accounts below
/// are Hardhat's well-known public test keys and hold nothing of value.
export const DEV_WALLETS_ENABLED = process.env.NEXT_PUBLIC_DEV_WALLETS === "true";

export interface DevWallet {
  label: string;
  description: string;
  address: `0x${string}`;
}

/// Hardhat's default accounts. #0 deploys the contracts, so it is the owner
/// (and fee recipient); #1–#3 are the ticket buyers seeded by deploy-local.
export const DEV_WALLETS: DevWallet[] = [
  {
    label: "Admin",
    description: "Contract owner — can draw, start rounds, change settings",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  },
  {
    label: "Player 1",
    description: "Holds tickets, seeded with test USDC",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  },
  {
    label: "Player 2",
    description: "Holds tickets, seeded with test USDC",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  },
  {
    label: "Player 3",
    description: "Fresh buyer, seeded with test USDC",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  },
];

export function devConnectorId(address: string): string {
  return `dev-${address.toLowerCase()}`;
}

/// One connector per dev wallet, so switching accounts is a normal
/// connect/disconnect rather than a custom account-selection concept.
///
/// The mock connector answers `eth_requestAccounts` from its own list but lets
/// `eth_accounts` fall through to the node — which would return all 20 unlocked
/// accounts and make every dev wallet resolve to account #0. Intercepting it
/// here pins each connector to exactly one address.
function devWalletConnector(wallet: DevWallet): CreateConnectorFn {
  const base = mock({ accounts: [wallet.address], features: { reconnect: true } });

  return (config) => {
    const connector = base(config as never) as ReturnType<CreateConnectorFn>;
    return {
      ...connector,
      id: devConnectorId(wallet.address),
      name: `${wallet.label} (dev)`,
      async getProvider(params?: { chainId?: number }) {
        const provider = (await connector.getProvider(params)) as {
          request: (args: { method: string; params?: unknown }) => Promise<unknown>;
        };
        return {
          ...provider,
          request: async (args: { method: string; params?: unknown }) => {
            if (args.method === "eth_accounts") return [wallet.address];
            return provider.request(args);
          },
        };
      },
    } as ReturnType<CreateConnectorFn>;
  };
}

export function devWalletConnectors(): CreateConnectorFn[] {
  if (!DEV_WALLETS_ENABLED) return [];
  return DEV_WALLETS.map(devWalletConnector);
}
