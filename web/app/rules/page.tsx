import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Game rules & odds — Decentralized Lottery",
  description: "How the raffle works, what it costs, how the winner is chosen, and how prizes are paid.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-neutral-900">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-sm text-neutral-600">{children}</div>
    </section>
  );
}

export default function RulesPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Game rules &amp; odds</h1>
      <p className="mt-1 text-sm text-neutral-500">
        The complete rules of play. Everything here is enforced by the smart contract, which anyone can read.
      </p>

      <Section title="How a round works">
        <p>
          Each round runs for a fixed window (30 days by default). During the window anyone verified can buy
          tickets. When the window closes, no more tickets are sold and the draw can be triggered by anyone —
          it does not depend on us doing it.
        </p>
      </Section>

      <Section title="What a ticket costs">
        <p>
          Tickets start at a base price and rise by a fixed increment with every ticket sold in that round. The
          current price is always shown before you buy, and your purchase includes a maximum price so you can
          never be charged more than you were quoted.
        </p>
        <p>
          Because the price rises, a ticket bought late costs more than one bought early while carrying the
          same single chance of winning.
        </p>
      </Section>

      <Section title="Your odds">
        <p>
          Your chance of winning a round is the number of tickets you hold divided by the total tickets sold in
          that round. If 200 tickets are sold and you hold 4, your chance is 4 in 200 — 2%.
        </p>
        <p>
          Every draw is independent. Previous results have no effect on future ones, and no ticket number is
          luckier than another.
        </p>
      </Section>

      <Section title="How the winner is chosen">
        <p>
          The winning ticket is selected using Chainlink VRF, a verifiable random function. The randomness is
          produced off-chain with a cryptographic proof, and the contract rejects any result whose proof does
          not check out. Neither we nor a player can predict or influence it.
        </p>
        <p>
          If the randomness provider fails to respond, the draw can be retried after a short delay. A round can
          never be left permanently undrawn.
        </p>
      </Section>

      <Section title="Prizes and fees">
        <p>
          The prize pool is every payment made for tickets in that round, plus 1% of every secondary-market
          sale. The holder of the winning ticket at the moment of the draw receives 95% of the pool. The
          remaining 5% is the platform&apos;s fee.
        </p>
        <p>
          Prize money is held by the contract, not by us, and is paid directly to the winner when they claim.
        </p>
      </Section>

      <Section title="Claiming, and what happens if you don't">
        <p>
          Prizes are claimed, not pushed: the winner submits a claim and the contract pays them. You have 90
          days from the draw to claim. After that the prize may be swept to the platform and can no longer be
          claimed.
        </p>
        <p>
          Your identity verification must be current when you claim. If it has lapsed, the prize is held — not
          forfeited — until you re-verify, subject to the 90-day window.
        </p>
      </Section>

      <Section title="The secondary market">
        <p>
          Tickets are transferable and can be listed for resale until the round is drawn. A 3% fee applies to
          every sale: 2% to the platform and 1% added to the prize pool. The seller receives 97%.
        </p>
        <p>
          A resale transfers the entire chance of winning to the buyer. Nobody will pay more than the current
          primary price for a resold ticket, because a new one can always be bought at that price.
        </p>
      </Section>

      <Section title="Who can play">
        <p>
          You must be 18 or over, have completed identity verification, and be resident in a jurisdiction we
          are licensed to serve. Tickets cannot be bought, received or traded by an unverified wallet — this is
          enforced by the contract on every transfer, not just at checkout.
        </p>
      </Section>

      <Section title="Changes to these rules">
        <p>
          Pricing, round length and fee recipients can be changed by the operator, and take effect from the
          next round. Fee percentages are fixed in the contract and cannot be changed without deploying a new
          one.
        </p>
      </Section>
    </div>
  );
}
