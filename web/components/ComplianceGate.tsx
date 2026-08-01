"use client";

import Link from "next/link";
import { useCompliance } from "@/lib/hooks";
import { isTerminalStatus, statusExplanation, statusLabel } from "@/lib/compliance";

/// Renders `children` only when the connected wallet is cleared to transact,
/// otherwise explains why and points at /verify.
///
/// This is UX, not enforcement — the contracts reject unverified callers
/// themselves (see ComplianceRegistry), so hiding a button is a courtesy rather
/// than the control.
export function ComplianceGate({
  children,
  connected,
  compact = false,
}: {
  children: React.ReactNode;
  connected: boolean;
  compact?: boolean;
}) {
  const { status, isVerified, isConfigured, isSelfExcluded } = useCompliance();

  if (!isConfigured || !connected || isVerified) return <>{children}</>;

  // A live exclusion is the most useful thing to surface, even when some other
  // status technically outranks it on-chain.
  const effectiveStatus = isSelfExcluded ? "SelfExcluded" : status;
  // Verifying again wouldn't help a blocked jurisdiction or a self-exclusion,
  // so don't offer it as a way out.
  const blocked = isTerminalStatus(effectiveStatus);

  if (compact) {
    return (
      <Link
        href="/verify"
        className="inline-block rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"
      >
        {blocked ? "Not available" : "Verify to trade"}
      </Link>
    );
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        blocked ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
      }`}
    >
      <p className={`font-semibold ${blocked ? "text-red-800" : "text-amber-900"}`}>
        {statusLabel(effectiveStatus)}
      </p>
      <p className={`mt-1 text-sm ${blocked ? "text-red-700" : "text-amber-800"}`}>
        {statusExplanation(effectiveStatus)}
      </p>
      {!blocked && (
        <Link
          href="/verify"
          className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Verify my identity
        </Link>
      )}
    </div>
  );
}
