"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useCompliance } from "@/lib/hooks";
import { BLOCKED_COUNTRIES, SAMPLE_ALLOWED_COUNTRIES, statusExplanation, statusLabel } from "@/lib/compliance";
import { COMPLIANCE_ADDRESS } from "@/lib/contracts";

interface GeoResult {
  country: string | null;
  region: string | null;
  blocked: boolean;
  determined: boolean;
  source: string;
}

const COUNTRY_OPTIONS = [...SAMPLE_ALLOWED_COUNTRIES, ...BLOCKED_COUNTRIES].sort();

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        type={type}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export default function VerifyPage() {
  const { address, isConnected } = useAccount();
  const compliance = useCompliance();

  const [geo, setGeo] = useState<GeoResult | null>(null);
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [country, setCountry] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  useEffect(() => {
    fetch("/api/compliance/geo")
      .then((r) => r.json())
      .then((data: GeoResult) => {
        setGeo(data);
        if (data.country && !country) setCountry(data.country);
      })
      .catch(() => setGeo(null));
    // Runs once on mount; `country` is intentionally not a dependency so we
    // never clobber a choice the user has already made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/compliance/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, fullName, dateOfBirth, country, documentNumber }),
      });
      const data = await response.json();
      setResult({ ok: Boolean(data.ok), reason: data.reason });
      if (data.ok) compliance.refetch();
    } catch {
      setResult({ ok: false, reason: "Network error. Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (!COMPLIANCE_ADDRESS) {
    return (
      <p className="mx-auto max-w-2xl px-6 py-16 text-center text-neutral-500">
        Compliance isn&apos;t configured on this deployment.
      </p>
    );
  }

  const canSubmit = isConnected && fullName && dateOfBirth && country && documentNumber && !submitting;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Identity verification</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Gaming rules require us to confirm who you are and where you&apos;re playing from before you can buy a
        ticket, trade, or claim a prize.
      </p>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Demo verification</p>
        <p className="mt-1">
          This form is a stand-in for a real KYC provider. It validates the shape of what you enter, checks your
          jurisdiction, and records the result on-chain — but it does not actually verify your identity, and no
          document is captured. Don&apos;t enter real personal data.
        </p>
      </div>

      {/* Current standing */}
      <div className="mt-6 rounded-xl border border-neutral-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-neutral-500">Your status</p>
            <p className="mt-0.5 text-lg font-semibold text-neutral-900">
              {isConnected ? statusLabel(compliance.status) : "Wallet not connected"}
            </p>
          </div>
          {compliance.isVerified && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Cleared to play
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          {isConnected ? statusExplanation(compliance.status) : "Connect a wallet to check or start verification."}
        </p>
        {compliance.isVerified && compliance.country && (
          <p className="mt-2 text-sm text-neutral-500">
            Verified from <span className="font-medium text-neutral-900">{compliance.country}</span>
            {compliance.expiresAt > 0n &&
              ` · valid until ${new Date(Number(compliance.expiresAt) * 1000).toLocaleDateString()}`}
          </p>
        )}
      </div>

      {/* Geo */}
      <div className="mt-4 rounded-xl border border-neutral-200 p-5">
        <p className="text-sm text-neutral-500">Detected location</p>
        {geo === null ? (
          <p className="mt-1 text-neutral-900">Checking…</p>
        ) : geo.determined ? (
          <>
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              {geo.country}
              {geo.region ? ` · ${geo.region}` : ""}
            </p>
            <p className={`mt-1 text-sm ${geo.blocked ? "text-red-600" : "text-neutral-500"}`}>
              {geo.blocked
                ? "We're not licensed to serve players in this jurisdiction."
                : "This jurisdiction is permitted."}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-neutral-500">
            Couldn&apos;t determine your location — there&apos;s no geo-aware proxy in front of this app locally.
            Set <code className="rounded bg-neutral-100 px-1">COMPLIANCE_DEV_COUNTRY</code> to simulate one.
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-400">
          IP location is a deterrent, not a control — a VPN defeats it. Production pairs this with a commercial
          geo database, VPN/proxy detection, and the country on your ID document.
        </p>
      </div>

      {/* Form */}
      {!compliance.isVerified && (
        <div className="mt-4 rounded-xl border border-neutral-200 p-5">
          <h2 className="font-semibold text-neutral-900">Submit your details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Full legal name" value={fullName} onChange={setFullName} placeholder="Jane Q. Example" />
            <Field label="Date of birth" type="date" value={dateOfBirth} onChange={setDateOfBirth} />
            <label className="block text-sm">
              <span className="text-neutral-500">Country of residence</span>
              <select
                className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">Select…</option>
                {COUNTRY_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="ID document number"
              value={documentNumber}
              onChange={setDocumentNumber}
              placeholder="X1234567"
            />
          </div>

          <button
            className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            disabled={!canSubmit}
            onClick={submit}
          >
            {submitting ? "Verifying…" : isConnected ? "Submit for verification" : "Connect a wallet first"}
          </button>

          {result && (
            <p className={`mt-3 text-sm ${result.ok ? "text-emerald-600" : "text-red-600"}`}>
              {result.ok ? "Verified. You're cleared to play." : result.reason}
            </p>
          )}

          <p className="mt-4 text-xs text-neutral-400">
            Only your country and an opaque reference hash are written on-chain. Your name, date of birth and
            document number are never stored on the blockchain.
          </p>
        </div>
      )}
    </div>
  );
}
