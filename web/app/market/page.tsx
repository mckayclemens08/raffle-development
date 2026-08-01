"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  useBuyListing,
  useCurrentRound,
  useListTicket,
  useMarketListings,
  useMyTickets,
  useUsdc,
} from "@/lib/hooks";
import { useRoundActivity } from "@/lib/useRoundActivity";
import { formatUsdc, parseUsdc, LOTTERY_ADDRESS, MARKET_ADDRESS } from "@/lib/contracts";
import { LiveChartCard } from "@/components/LiveChartCard";
import { type ChartPoint } from "@/components/LineAreaChart";
import { ComplianceGate } from "@/components/ComplianceGate";
import { useNow } from "@/lib/useNow";

function formatAxisUsd(value: number): string {
  if (value >= 1000) {
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function ListTicketForm() {
  const { ticketIds } = useMyTickets();
  const { approveMarket, listTicket, isPending, isConfirming, isSuccess } = useListTicket();
  const [ticketId, setTicketId] = useState("");
  const [price, setPrice] = useState("");

  if (ticketIds.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6">
      <h2 className="font-semibold text-neutral-900">List a ticket</h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <select
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900"
          value={ticketId}
          onChange={(e) => setTicketId(e.target.value)}
        >
          <option value="">Select ticket…</option>
          {ticketIds.map((id) => (
            <option key={id.toString()} value={id.toString()}>
              #{id.toString()}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900"
          placeholder="Price in USD"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <button
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 font-semibold text-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
          disabled={!ticketId || !price || isPending || isConfirming}
          onClick={() => approveMarket(BigInt(ticketId))}
        >
          1. Approve
        </button>
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!ticketId || !price || isPending || isConfirming}
          onClick={() => listTicket(BigInt(ticketId), parseUsdc(price))}
        >
          2. List
        </button>
      </div>
      {isSuccess && <p className="mt-2 text-sm text-emerald-600">Transaction confirmed.</p>}
    </div>
  );
}

export default function MarketPage() {
  const { isConnected } = useAccount();
  const { listings, refetch } = useMarketListings();
  const { buyListing, isPending, isConfirming, isSuccess } = useBuyListing();
  const usdc = useUsdc(MARKET_ADDRESS);
  const { roundId, round, price } = useCurrentRound();
  const { points } = useRoundActivity(roundId);
  const [search, setSearch] = useState("");
  const now = useNow(30_000);

  const filtered = useMemo(
    () => listings.filter((listing) => listing.ticketId.toString().includes(search.trim())),
    [listings, search]
  );

  // Primary ticket price over time: each purchase records the price paid, and
  // the current (next-ticket) price closes out the series. The x-domain starts
  // at first activity, not round creation, so a quiet lead-in doesn't crush it.
  const pricePoints = useMemo<ChartPoint[]>(() => {
    if (!round || price === undefined || now === null) return [];
    const series: ChartPoint[] = points.map((p) => ({ timestamp: p.timestamp, value: Number(p.price) / 1e6 }));
    const anchorTs = series.length > 0 ? series[0].timestamp - 60 : Number(round.startTime);
    const anchorValue = series.length > 0 ? series[0].value : Number(price) / 1e6;
    return [
      { timestamp: anchorTs, value: anchorValue },
      ...series,
      { timestamp: Math.floor(now / 1000), value: Number(price) / 1e6 },
    ];
  }, [round, price, points, now]);

  if (!LOTTERY_ADDRESS || !MARKET_ADDRESS) {
    return <p className="mx-auto max-w-5xl px-6 py-16 text-center text-neutral-500">Contracts not deployed yet.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Secondary Market</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Buy and sell raffle tickets before the round is drawn. A 3% fee applies to every sale — 2% to the
        platform, 1% added straight to the prize pool.
      </p>

      <div className="mt-6">
        <LiveChartCard
          label="Ticket price this round"
          value={price !== undefined ? `$${formatUsdc(price)}` : "—"}
          points={pricePoints}
          formatValue={formatAxisUsd}
          emptyLabel="The price chart appears once the round opens."
          ariaLabel="Raffle ticket price over time for the current round"
        />
      </div>

      {isConnected && (
        <div className="mt-6">
          <ComplianceGate connected={isConnected}>
            <ListTicketForm />
          </ComplianceGate>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-4">
        <input
          className="w-full max-w-xs rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          placeholder="Search by ticket #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="text-sm text-neutral-500 underline hover:text-neutral-900" onClick={() => refetch()}>
          Refresh
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Seller</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-neutral-400">
                  No tickets listed right now.
                </td>
              </tr>
            ) : (
              filtered.map((listing) => (
                <tr key={listing.ticketId.toString()} className="text-neutral-900">
                  <td className="px-4 py-3 font-mono">#{listing.ticketId.toString()}</td>
                  <td className="px-4 py-3 text-neutral-500">
                    {listing.seller.slice(0, 6)}…{listing.seller.slice(-4)}
                  </td>
                  <td className="px-4 py-3 font-medium">${formatUsdc(listing.price)}</td>
                  <td className="px-4 py-3 text-right">
                    <ComplianceGate connected={isConnected} compact>
                      <button
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        disabled={!isConnected || isPending || isConfirming || usdc.isApproving}
                        onClick={() => {
                          if (usdc.allowance !== undefined && usdc.allowance < listing.price) {
                            usdc.approve(listing.price);
                          } else {
                            buyListing(listing.ticketId);
                          }
                        }}
                      >
                        {usdc.allowance !== undefined && usdc.allowance < listing.price
                          ? usdc.isApproving
                            ? "Approving…"
                            : "Approve USDC"
                          : "Buy"}
                      </button>
                    </ComplianceGate>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {isSuccess && <p className="mt-3 text-sm text-emerald-600">Purchase confirmed.</p>}
    </div>
  );
}
