"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { hardhat } from "wagmi/chains";
import { DEV_WALLETS, DEV_WALLETS_ENABLED, devConnectorId } from "@/lib/devWallets";
import { formatUsdc } from "@/lib/contracts";
import { useUsdcBalance } from "@/lib/hooks";

const STORAGE_KEY = "devWallet.address";

/// Dev-only account switcher. Renders nothing unless NEXT_PUBLIC_DEV_WALLETS=true,
/// so it can never appear in a real deployment.
export function DevWalletBar() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { balance } = useUsdcBalance();
  const restored = useRef(false);

  // wagmi can't reconnect the mock connector itself (it reports unauthorized on
  // a fresh page load), so remember the chosen dev wallet and re-connect it here.
  useEffect(() => {
    if (!DEV_WALLETS_ENABLED || restored.current) return;
    if (isConnected || isConnecting || isReconnecting) return;

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const connector = connectors.find((c) => c.id === devConnectorId(saved));
    if (!connector) return;

    restored.current = true;
    connect({ connector, chainId: hardhat.id });
  }, [connect, connectors, isConnected, isConnecting, isReconnecting]);

  function selectWallet(walletAddress: string) {
    const connector = connectors.find((c) => c.id === devConnectorId(walletAddress));
    if (!connector) return;
    restored.current = true;
    window.localStorage.setItem(STORAGE_KEY, walletAddress);
    connect({ connector, chainId: hardhat.id });
  }

  function signOut() {
    window.localStorage.removeItem(STORAGE_KEY);
    disconnect();
  }

  if (!DEV_WALLETS_ENABLED) return null;

  const activeIndex = DEV_WALLETS.findIndex(
    (wallet) => address && wallet.address.toLowerCase() === address.toLowerCase()
  );

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="rounded-md bg-amber-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
          Dev mode
        </span>
        <span className="text-amber-900">Sign in as:</span>

        {DEV_WALLETS.map((wallet, index) => {
          const active = index === activeIndex;
          const connector = connectors.find((c) => c.id === devConnectorId(wallet.address));
          return (
            <button
              key={wallet.address}
              title={`${wallet.description} — ${wallet.address}`}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition disabled:opacity-60 ${
                active
                  ? "bg-amber-900 text-white"
                  : "border border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              }`}
              disabled={isPending || !connector}
              onClick={() => selectWallet(wallet.address)}
            >
              {wallet.label}
            </button>
          );
        })}

        {isConnected && (
          <>
            <span className="font-mono text-xs text-amber-800">
              {address?.slice(0, 6)}…{address?.slice(-4)}
              {balance !== undefined && ` · $${formatUsdc(balance)} USDC`}
            </span>
            <button className="text-xs text-amber-900 underline hover:no-underline" onClick={signOut}>
              Disconnect
            </button>
          </>
        )}

        {error && <span className="text-xs text-red-700">{error.message}</span>}
      </div>
    </div>
  );
}
