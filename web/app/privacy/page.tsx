import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Decentralized Lottery",
  description: "What we collect, what goes on a public blockchain, and what we can and cannot delete.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-neutral-900">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-sm text-neutral-600">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Privacy</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Gambling regulation forces us to collect more about you than we would otherwise want. This page is
        specific about what that means, including the parts that are permanent.
      </p>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Draft — not reviewed by a lawyer</p>
        <p className="mt-1">
          This describes how the software actually behaves today. It is not yet a compliant privacy notice, and
          must be reviewed by counsel against GDPR, PIPEDA and your licence conditions before launch.
        </p>
      </div>

      <Section title="What goes on the blockchain — permanently">
        <p>
          A public blockchain cannot be edited or erased by anyone, including us. We have designed around that,
          so the only things written there are:
        </p>
        <ul className="ml-5 list-disc">
          <li>your wallet address</li>
          <li>your country of residence, as a two-letter code</li>
          <li>the date you were verified and when that verification expires</li>
          <li>an opaque hash that lets us find your record with our verification provider</li>
          <li>your ticket purchases, transfers, and any prize you claim</li>
        </ul>
        <p>
          Your name, date of birth, address, and identity documents are <strong>never</strong> written to the
          blockchain. The hash is one-way: it cannot be reversed to recover what it was made from.
        </p>
      </Section>

      <Section title="What we hold off-chain">
        <p>
          Identity verification is carried out by a third-party provider, who holds the documents and personal
          details you submit. We retain the decision, the country, and a reference to their record.
        </p>
        <p>
          Anti-money-laundering rules require us to keep verification and transaction records for a set period
          after your last activity — typically five to seven years depending on jurisdiction — even if you ask
          us to delete them.
        </p>
      </Section>

      <Section title="Your right to erasure, honestly explained">
        <p>
          If you ask us to delete your data, we will erase what we hold off-chain once our legal retention
          period has expired, and instruct our verification provider to do the same.
        </p>
        <p>
          We <strong>cannot</strong> delete anything already recorded on the blockchain. No operator can. What
          is there is limited by design to a wallet address, a country code and hashes — but you should
          understand before verifying that this portion is permanent and public.
        </p>
      </Section>

      <Section title="Location data">
        <p>
          We determine the country your connection originates from to check that we are licensed to serve you.
          This is done server-side from your IP address at the moment of the request. We do not store your IP
          address for marketing and we do not use precise GPS location.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          Our identity verification provider, our regulator on request, and law enforcement where legally
          compelled. We do not sell personal data.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Data protection enquiries and erasure requests should go to the operator&apos;s published contact
          address. A named data protection contact must be listed here before launch.
        </p>
      </Section>
    </div>
  );
}
