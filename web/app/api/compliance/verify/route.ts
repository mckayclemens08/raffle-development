import { NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http, isAddress, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat, sepolia, baseSepolia } from "viem/chains";
import complianceAbi from "@/lib/abi/ComplianceRegistry.json";
import { countryToBytes2, isBlockedCountry } from "@/lib/compliance";
import { resolveGeo } from "@/lib/geo";

/// Records a completed identity check on-chain.
///
/// WHAT THIS IS: the integration seam where a KYC provider's decision becomes an
/// on-chain attestation. The shape is production-correct — a backend verifier key
/// writes an allowlist entry containing only a country code and an opaque
/// reference — and it is what the raffle actually enforces against.
///
/// WHAT THIS IS NOT: real identity verification. A licensed operator replaces the
/// `runIdentityCheck` stub below with a provider (Persona, Sumsub, Onfido, Veriff,
/// Jumio) that captures a government ID, runs a liveness/selfie match, screens
/// against sanctions and PEP lists, and returns a decision via signed webhook.
/// The stub here only sanity-checks the submitted fields. Do not ship it.
///
/// PRIVACY: personal data is never written on-chain and never logged. Only a
/// keccak hash of the submission is stored, as `providerRef`, so a record can be
/// tied back to the provider's file without exposing anything publicly.

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
const CHAINS = { [hardhat.id]: hardhat, [sepolia.id]: sepolia, [baseSepolia.id]: baseSepolia } as const;

/// One year, matching the periodic re-verification most gaming regulators expect.
const VERIFICATION_TTL_SECONDS = 365 * 24 * 60 * 60;

interface Submission {
  address: string;
  fullName: string;
  dateOfBirth: string;
  country: string;
  documentNumber: string;
}

function ageFrom(dateOfBirth: string): number | null {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

/// STUB. Replace with a real provider call — see the note above.
function runIdentityCheck(submission: Submission): { approved: boolean; reason?: string } {
  if (submission.fullName.trim().split(/\s+/).length < 2) {
    return { approved: false, reason: "Enter your full legal name as it appears on your ID." };
  }
  if (submission.documentNumber.trim().length < 5) {
    return { approved: false, reason: "That document number doesn't look valid." };
  }
  const age = ageFrom(submission.dateOfBirth);
  if (age === null) return { approved: false, reason: "Enter a valid date of birth." };
  if (age < 18) return { approved: false, reason: "You must be 18 or older to play." };
  return { approved: true };
}

export async function POST(request: Request) {
  const registryAddress = process.env.NEXT_PUBLIC_COMPLIANCE_ADDRESS as `0x${string}` | undefined;
  const verifierKey = process.env.COMPLIANCE_VERIFIER_KEY as `0x${string}` | undefined;

  if (!registryAddress || !verifierKey) {
    return NextResponse.json(
      { ok: false, reason: "Verification isn't configured on this deployment." },
      { status: 503 }
    );
  }

  let submission: Submission;
  try {
    submission = (await request.json()) as Submission;
  } catch {
    return NextResponse.json({ ok: false, reason: "Malformed request." }, { status: 400 });
  }

  if (!submission.address || !isAddress(submission.address)) {
    return NextResponse.json({ ok: false, reason: "Connect a wallet first." }, { status: 400 });
  }

  const declaredCountry = (submission.country || "").toUpperCase().slice(0, 2);
  if (declaredCountry.length !== 2) {
    return NextResponse.json({ ok: false, reason: "Select your country of residence." }, { status: 400 });
  }

  // Geo gate. A real operator also compares this against the IP country and the
  // country on the presented document, and rejects mismatches for manual review.
  if (isBlockedCountry(declaredCountry)) {
    return NextResponse.json(
      { ok: false, reason: `We're not licensed to serve players in ${declaredCountry}.`, blocked: true },
      { status: 403 }
    );
  }

  // Resolved through the same chain the /geo route uses, so the check that
  // gates verification can't drift from the one shown to the player.
  const geo = await resolveGeo(request.headers);
  if (geo.determined && geo.blocked) {
    return NextResponse.json(
      { ok: false, reason: "Your connection appears to originate from a restricted jurisdiction.", blocked: true },
      { status: 403 }
    );
  }

  const decision = runIdentityCheck(submission);
  if (!decision.approved) {
    return NextResponse.json({ ok: false, reason: decision.reason }, { status: 422 });
  }

  // Opaque pointer to the provider's file. Never the personal data itself.
  const providerRef = keccak256(
    toHex(`${submission.address.toLowerCase()}|${submission.documentNumber}|${submission.dateOfBirth}`)
  );

  const chain = CHAINS[CHAIN_ID as keyof typeof CHAINS] ?? hardhat;
  const account = privateKeyToAccount(verifierKey);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const publicClient = createPublicClient({ chain, transport: http() });

  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + VERIFICATION_TTL_SECONDS);

  try {
    const hash = await wallet.writeContract({
      address: registryAddress,
      abi: complianceAbi,
      functionName: "setVerification",
      args: [submission.address as `0x${string}`, countryToBytes2(declaredCountry), expiresAt, providerRef],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({ ok: true, country: declaredCountry, expiresAt: Number(expiresAt), txHash: hash });
  } catch (error) {
    // Deliberately does not echo the submission back into the log.
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("compliance attestation failed:", message);
    return NextResponse.json({ ok: false, reason: "Couldn't record your verification. Try again." }, { status: 500 });
  }
}
