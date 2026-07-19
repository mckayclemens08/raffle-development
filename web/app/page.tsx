"use client";

import { useAccount } from "wagmi";
import { useBuyTicket, useCurrentRound, useUsdc } from "@/lib/hooks";
import { formatUsdc, LOTTERY_ADDRESS } from "@/lib/contracts";

function Countdown({ endTime }: { endTime: bigint }) {
  const endMs = Number(endTime) * 1000;
  const remainingMs = Math.max(0, endMs - Date.now());
  const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remainingMs / (1000 * 60 * 60)) % 24);

  if (remainingMs === 0) return <span>Closed — awaiting draw</span>;
  return (
    <span>
      {days}d {hours}h left
    </span>
  );
}

function RoundProgressBar({ startTime, endTime }: { startTime: bigint; endTime: bigint }) {
  const start = Number(startTime) * 1000;
  const end = Number(endTime) * 1000;
  const now = Date.now();
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));

  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-neutral-100">
      <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
      <div className="h-full bg-rose-300" style={{ width: `${100 - pct}%` }} />
    </div>
  );
}

const STEPS = [
  { title: "1. Buy a ticket", body: "Price rises with demand — every purchase in the round bumps the next ticket's price." },
  { title: "2. Round closes", body: "When the window ends, anyone can trigger the draw. Chainlink VRF picks the winner on-chain." },
  { title: "3. Claim your prize", body: "Whoever holds the winning ticket NFT claims 95% of the pool. 5% funds the platform." },
];

export default function Home() {
  const { isConnected } = useAccount();
  const { roundId, round, price, refetch } = useCurrentRound();
  const { buyTicket, isPending, isConfirming, isSuccess, error } = useBuyTicket();
  const usdc = useUsdc(LOTTERY_ADDRESS);

  const needsApproval =
    price !== undefined && usdc.allowance !== undefined && usdc.allowance < price;
  const insufficientBalance =
    price !== undefined && usdc.balance !== undefined && usdc.balance < price;

  return (
    <>
      <section className="bg-blue-700 text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="text-6xl font-black leading-[0.95] tracking-tight">
              Winner
              <br />
              Takes All
            </h1>
            <p className="mt-6 max-w-md text-lg text-blue-100">
              A monthly on-chain raffle. Ticket price climbs with demand, the pool is escrowed in the contract,
              and the winner is drawn on-chain with Chainlink VRF.
            </p>
            <div className="mt-8 inline-flex items-start gap-2 rounded-2xl bg-blue-800/50 px-4 py-3 text-sm text-blue-50">
              <span aria-hidden>ⓘ</span>
              <span>5% of the pool funds the platform. The rest goes to whoever holds the winning ticket.</span>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 text-neutral-900 shadow-2xl">
            {!LOTTERY_ADDRESS ? (
              <div className="py-6 text-center text-neutral-500">
                <p className="font-semibold">Contracts not deployed yet</p>
                <p className="mt-2 text-sm">
                  Set <code className="rounded bg-neutral-100 px-1">NEXT_PUBLIC_LOTTERY_ADDRESS</code> in{" "}
                  <code className="rounded bg-neutral-100 px-1">.env.local</code>.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg">
                      🎟️
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">Round {roundId?.toString() ?? "—"} raffle</p>
                      <span className="mt-1 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        Live
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-neutral-500">Tickets sold</p>
                    <p className="font-semibold">{round?.ticketsSold?.toString() ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-neutral-500">Prize pool</p>
                    <p className="font-semibold">{round ? `$${formatUsdc(round.pool)}` : "—"}</p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-blue-700">
                      {round ? <Countdown endTime={round.endTime} /> : "—"}
                    </span>
                    <span className="text-neutral-400">Round window</span>
                  </div>
                  {round && <RoundProgressBar startTime={round.startTime} endTime={round.endTime} />}
                </div>

                <button
                  className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    !isConnected ||
                    price === undefined ||
                    insufficientBalance ||
                    isPending ||
                    isConfirming ||
                    usdc.isApproving
                  }
                  onClick={() => {
                    if (price === undefined) return;
                    if (needsApproval) {
                      usdc.approve(price);
                    } else {
                      buyTicket(price);
                    }
                  }}
                >
                  {!isConnected
                    ? "Connect wallet to buy a ticket"
                    : price === undefined
                      ? "Loading…"
                      : insufficientBalance
                        ? "Insufficient USDC balance"
                        : usdc.isApproving
                          ? "Approving USDC…"
                          : isPending || isConfirming
                            ? "Confirming…"
                            : needsApproval
                              ? `Approve $${formatUsdc(price)} USDC`
                              : `Buy ticket for $${formatUsdc(price)}`}
                </button>
                {needsApproval && !usdc.isApproving && (
                  <p className="mt-2 text-center text-xs text-neutral-400">
                    First-time purchase takes two steps: approve USDC, then buy.
                  </p>
                )}

                {isSuccess && (
                  <p className="mt-3 text-center text-sm text-emerald-600">
                    Ticket purchased!{" "}
                    <button
                      className="underline"
                      onClick={() => {
                        refetch();
                        usdc.refetch();
                      }}
                    >
                      Refresh
                    </button>
                  </p>
                )}
                {error && <p className="mt-3 text-center text-sm text-red-600">{error.message}</p>}
                {usdc.approveError && (
                  <p className="mt-3 text-center text-sm text-red-600">{usdc.approveError.message}</p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-bold text-neutral-900">How it works</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="rounded-xl border border-neutral-200 p-5">
              <p className="font-semibold text-neutral-900">{step.title}</p>
              <p className="mt-2 text-sm text-neutral-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
