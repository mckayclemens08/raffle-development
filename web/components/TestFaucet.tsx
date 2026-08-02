"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { useUsdcBalance, useTestFaucet } from "@/lib/hooks";
import { formatUsdc, FAUCET_ENABLED, USDC_ADDRESS } from "@/lib/contracts";

/// Beta-only: mints test dollars to the connected wallet.
///
/// Testers cannot realistically obtain testnet USDC — there is no faucet for it
/// on most chains — so without this the very first step of the product is a
/// dead end. Backed by MockUSDC, whose `mint` is deliberately open.
///
/// Gated on NEXT_PUBLIC_FAUCET_ENABLED, which the testnet deploy script sets
/// only when it deployed a mock token. Against a real stablecoin this component
/// never renders, because minting would be impossible anyway.
export function TestFaucet() {
  const { isConnected } = useAccount();
  const { balance, refetch } = useUsdcBalance();
  const { mint, isPending, isConfirming, isSuccess, error } = useTestFaucet();

  useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess, refetch]);

  if (!FAUCET_ENABLED || !USDC_ADDRESS || !isConnected) return null;

  const low = balance !== undefined && balance < 20_000_000n; // under $20

  return (
    <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-900">Test dollars</p>
          <p className="mt-0.5 text-sm text-blue-800">
            {balance !== undefined ? `You have $${formatUsdc(balance)}.` : "Checking your balance…"}{" "}
            This is play money on a test network — it has no value.
          </p>
        </div>
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={isPending || isConfirming}
          onClick={() => mint()}
        >
          {isPending || isConfirming ? "Sending…" : low ? "Get $500 test USDC" : "Get $500 more"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
    </div>
  );
}
