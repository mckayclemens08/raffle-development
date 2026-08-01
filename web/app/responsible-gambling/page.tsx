"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useCompliance, useSelfExclude } from "@/lib/hooks";
import { COMPLIANCE_ADDRESS } from "@/lib/contracts";

/// Support lines are listed by region because a single national number is
/// useless to most of the world. Sourced from the operators' own public
/// listings; verify each before launch and add one per licensed market.
const HELPLINES = [
  { region: "Canada", name: "ConnexOntario", contact: "1-866-531-2600", url: "https://www.connexontario.ca" },
  {
    region: "United States",
    name: "National Problem Gambling Helpline",
    contact: "1-800-522-4700",
    url: "https://www.ncpgambling.org",
  },
  { region: "United Kingdom", name: "GamCare", contact: "0808 8020 133", url: "https://www.gamcare.org.uk" },
  { region: "International", name: "Gamblers Anonymous", contact: "—", url: "https://www.gamblersanonymous.org" },
];

const DURATIONS = [
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "1 week", seconds: 7 * 24 * 60 * 60 },
  { label: "1 month", seconds: 30 * 24 * 60 * 60 },
  { label: "6 months", seconds: 182 * 24 * 60 * 60 },
  { label: "Permanently", seconds: null },
];

export default function ResponsibleGamblingPage() {
  const { isConnected } = useAccount();
  const compliance = useCompliance();
  const { selfExclude, isPending, isConfirming, isSuccess, error } = useSelfExclude();
  const [choice, setChoice] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);

  const selected = DURATIONS.find((d) => d.label === choice);

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Responsible gambling</h1>
      <p className="mt-1 text-sm text-neutral-500">
        This is a game of chance. The house keeps 5% of every pool, which means players collectively get back
        less than they put in. Please only play with money you can afford to lose.
      </p>

      <section className="mt-8">
        <h2 className="font-semibold text-neutral-900">The odds, stated plainly</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-600">
          <li>Your chance of winning a round is your ticket count divided by all tickets sold.</li>
          <li>95% of the pool goes to one winner; 5% goes to the platform.</li>
          <li>Ticket prices rise as a round fills, so later tickets cost more for the same single chance.</li>
          <li>Buying more tickets increases your chance and your loss if you don&apos;t win.</li>
          <li>Past results tell you nothing about future draws. Each draw is independent.</li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-neutral-900">Session limits we enforce</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-600">
          <li>A reality check every hour telling you how long you&apos;ve been playing.</li>
          <li>A mandatory 15-minute break after four continuous hours.</li>
          <li>Self-exclusion, below — enforced by the contract, not just the website.</li>
        </ul>
      </section>

      {/* Self-exclusion */}
      <section className="mt-8 rounded-xl border border-neutral-200 p-6">
        <h2 className="font-semibold text-neutral-900">Take a break from playing</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Self-exclusion blocks your wallet from buying, receiving or trading tickets. It is recorded on-chain
          and <strong>cannot be undone or shortened by anyone</strong>, including our support team. Any prize
          you have already won remains claimable.
        </p>

        {!COMPLIANCE_ADDRESS ? (
          <p className="mt-4 text-sm text-neutral-500">Not available on this deployment.</p>
        ) : !isConnected ? (
          <p className="mt-4 text-sm text-neutral-500">Connect your wallet to set an exclusion.</p>
        ) : compliance.isSelfExcluded ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">You are currently self-excluded.</p>
            <p className="mt-1 text-sm text-amber-800">
              {compliance.selfExcludedUntil > 0n
                ? `Until ${new Date(Number(compliance.selfExcludedUntil) * 1000).toLocaleString()}.`
                : ""}{" "}
              You can extend this at any time, but it cannot be shortened.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    choice === d.label
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 text-neutral-900 hover:bg-neutral-100"
                  }`}
                  onClick={() => {
                    setChoice(d.label);
                    setConfirmed(false);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {choice && (
              <label className="mt-4 flex items-start gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  I understand this {selected?.seconds === null ? "permanent " : ""}exclusion cannot be
                  reversed, shortened, or lifted on request.
                </span>
              </label>
            )}

            <button
              className="mt-4 rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              disabled={!choice || !confirmed || isPending || isConfirming}
              onClick={() => selected && selfExclude(selected.seconds)}
            >
              {isPending || isConfirming ? "Confirming…" : "Exclude myself"}
            </button>

            {isSuccess && (
              <p className="mt-3 text-sm text-emerald-600">
                Exclusion recorded. You can no longer buy or trade tickets.
              </p>
            )}
            {error && <p className="mt-3 text-sm text-red-600">{error.message}</p>}
          </>
        )}
      </section>

      {/* Helplines */}
      <section className="mt-8">
        <h2 className="font-semibold text-neutral-900">Free, confidential help</h2>
        <p className="mt-1 text-sm text-neutral-500">
          These services are independent of us. They will not try to sell you anything.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Region</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {HELPLINES.map((line) => (
                <tr key={line.name} className="text-neutral-900">
                  <td className="px-4 py-3 text-neutral-500">{line.region}</td>
                  <td className="px-4 py-3">
                    <a className="text-blue-600 underline" href={line.url} target="_blank" rel="noreferrer">
                      {line.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 font-mono">{line.contact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
