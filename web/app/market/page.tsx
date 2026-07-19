"use client";

import { useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { useBuyListing, useListTicket, useMarketListings, useMyTickets } from "@/lib/hooks";
import { LOTTERY_ADDRESS, MARKET_ADDRESS } from "@/lib/contracts";

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
          placeholder="Price in ETH"
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
          onClick={() => listTicket(BigInt(ticketId), parseEther(price))}
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
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => listings.filter((listing) => listing.ticketId.toString().includes(search.trim())),
    [listings, search]
  );

  if (!LOTTERY_ADDRESS || !MARKET_ADDRESS) {
    return <p className="mx-auto max-w-5xl px-6 py-16 text-center text-neutral-500">Contracts not deployed yet.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Secondary Market</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Buy and sell raffle tickets before the round is drawn. A 2% fee applies to every sale.
      </p>

      {isConnected && (
        <div className="mt-6">
          <ListTicketForm />
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

      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200">
        <table className="w-full text-left text-sm">
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
                  <td className="px-4 py-3 font-medium">{formatEther(listing.price)} ETH</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      disabled={!isConnected || isPending || isConfirming}
                      onClick={() => buyListing(listing.ticketId, listing.price)}
                    >
                      Buy
                    </button>
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
