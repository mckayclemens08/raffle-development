"use client";

import { useAccount } from "wagmi";
import { useClaimPrize, useCurrentRound, useMyTickets } from "@/lib/hooks";
import { LOTTERY_ADDRESS } from "@/lib/contracts";

export default function TicketsPage() {
  const { isConnected } = useAccount();
  const { ticketIds } = useMyTickets();
  const { roundId, round } = useCurrentRound();
  const { claimPrize, isPending, isConfirming, isSuccess } = useClaimPrize();

  if (!LOTTERY_ADDRESS) {
    return <p className="mx-auto max-w-4xl px-6 py-16 text-center text-neutral-500">Contracts not deployed yet.</p>;
  }

  if (!isConnected) {
    return (
      <p className="mx-auto max-w-4xl px-6 py-16 text-center text-neutral-500">
        Connect your wallet to see your tickets.
      </p>
    );
  }

  const isWinningTicket = round?.drawn && ticketIds.includes(round.winnerTicketId);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">My Tickets</h1>

      {isWinningTicket && !round?.paid && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-medium text-emerald-700">One of your tickets won round {roundId?.toString()}!</p>
          <button
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={isPending || isConfirming}
            onClick={() => roundId !== undefined && claimPrize(roundId)}
          >
            {isPending || isConfirming ? "Confirming…" : "Claim prize"}
          </button>
          {isSuccess && <p className="mt-2 text-sm text-emerald-700">Prize claimed.</p>}
        </div>
      )}

      {ticketIds.length === 0 ? (
        <p className="mt-6 text-neutral-500">You don&apos;t own any tickets yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ticketIds.map((id) => (
            <li
              key={id.toString()}
              className="rounded-xl border border-neutral-200 bg-white p-4 text-center font-mono text-neutral-900 shadow-sm"
            >
              #{id.toString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
