import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — Decentralized Lottery",
  description: "The agreement between players and the operator, including disputes and account closure.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-neutral-900">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-sm text-neutral-600">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Terms of service</h1>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Draft — not reviewed by a lawyer</p>
        <p className="mt-1">
          A skeleton reflecting how the product behaves, so the gaps are visible. It is not an enforceable
          agreement and must be drafted properly by gaming counsel before launch. Sections marked{" "}
          <strong>[needs counsel]</strong> cannot be written from the code alone.
        </p>
      </div>

      <Section title="Eligibility">
        <p>
          You must be at least 18, have completed identity verification, and be resident in a jurisdiction the
          operator is licensed to serve. Accessing the service through a VPN or other means of disguising your
          location to circumvent these restrictions is a breach of these terms and may void your winnings.
        </p>
      </Section>

      <Section title="One account per person">
        <p>
          Verification is tied to a wallet address. Verifying multiple wallets to evade limits, exclusions or
          jurisdiction rules is prohibited. <strong>[needs counsel]</strong> — the consequences of breach, and
          how they interact with funds already staked, need legal drafting.
        </p>
      </Section>

      <Section title="Play and payouts">
        <p>
          The rules of the game, including odds, fees and claim deadlines, are published at{" "}
          <a className="text-blue-600 underline" href="/rules">
            Game rules &amp; odds
          </a>{" "}
          and form part of these terms. Prize funds are held by a smart contract and paid on claim. Unclaimed
          prizes may be swept after 90 days.
        </p>
      </Section>

      <Section title="Self-exclusion is irreversible">
        <p>
          If you self-exclude, neither you nor the operator can shorten or lift it — the contract has no such
          function. Prizes already won remain claimable during an exclusion. Please be certain before you
          confirm.
        </p>
      </Section>

      <Section title="Suspension and revocation">
        <p>
          The operator may withdraw a verification where required by law, sanctions screening or a provider
          recall. This blocks further play. Any prize already won is withheld rather than forfeited, and is
          released if the verification is restored within the claim window.
        </p>
      </Section>

      <Section title="Risks you accept">
        <p>
          Smart contracts can contain defects. The service depends on third parties — a randomness oracle, a
          stablecoin issuer, a blockchain network — any of which can fail or freeze funds outside the
          operator&apos;s control. The stablecoin issuer can freeze addresses, including yours. Losing access
          to your wallet means losing access to your tickets and prizes; nobody can recover them for you.
        </p>
      </Section>

      <Section title="Complaints and disputes">
        <p>
          <strong>[needs counsel]</strong> — a complaints procedure, response times, escalation path, and an
          alternative dispute resolution provider are licence conditions and must be named here.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          <strong>[needs counsel]</strong> — governing law and jurisdiction depend on the licence held and the
          operating entity.
        </p>
      </Section>
    </div>
  );
}
