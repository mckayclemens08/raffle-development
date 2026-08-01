import { hexToString, stringToHex } from "viem";

/// Jurisdictions the platform will not serve. This list is a placeholder shaped
/// like the real thing — the actual list must come from gaming counsel for the
/// licence you hold, and is enforced on-chain via ComplianceRegistry's
/// blocked-country map (the copy here only drives the UI and the API's
/// pre-check).
export const BLOCKED_COUNTRIES = [
  "US", // state-by-state; most US states prohibit offshore online lotteries
  "GB", // requires a UK Gambling Commission licence
  "FR",
  "AU",
  "SG",
  "KP",
  "IR",
  "SY",
  "CU",
] as const;

/// Countries the demo deliberately treats as permitted, so there is something
/// to test the happy path with.
export const SAMPLE_ALLOWED_COUNTRIES = ["CA", "BR", "JP", "ZA", "MX", "DE", "NG", "IN"] as const;

export function isBlockedCountry(code: string): boolean {
  return (BLOCKED_COUNTRIES as readonly string[]).includes(code.toUpperCase());
}

/// ISO 3166-1 alpha-2 <-> the bytes2 the registry stores.
export function countryToBytes2(code: string): `0x${string}` {
  return stringToHex(code.toUpperCase().slice(0, 2), { size: 2 });
}

export function bytes2ToCountry(value: string): string {
  if (!value || value === "0x0000") return "";
  try {
    return hexToString(value as `0x${string}`).replace(/\0/g, "");
  } catch {
    return "";
  }
}

export const COMPLIANCE_STATUS = [
  "None",
  "Verified",
  "Expired",
  "Revoked",
  "BlockedJurisdiction",
  "SelfExcluded",
] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUS)[number];

export function statusLabel(status: ComplianceStatus): string {
  switch (status) {
    case "Verified":
      return "Verified";
    case "Expired":
      return "Verification expired";
    case "Revoked":
      return "Verification revoked";
    case "BlockedJurisdiction":
      return "Jurisdiction not permitted";
    case "SelfExcluded":
      return "Self-excluded";
    default:
      return "Not verified";
  }
}

export function statusExplanation(status: ComplianceStatus): string {
  switch (status) {
    case "Verified":
      return "You're cleared to buy, sell and claim.";
    case "Expired":
      return "Your identity check has lapsed. Re-verify to continue playing.";
    case "Revoked":
      return "Your verification was withdrawn. Contact support before playing again.";
    case "BlockedJurisdiction":
      return "The platform isn't licensed to serve players in your country.";
    case "SelfExcluded":
      return "You've excluded yourself from play. Any prize you already won is still claimable.";
    default:
      return "Verify your identity to buy tickets, trade, or claim a prize.";
  }
}

/// Statuses where pointing the player at /verify would be misleading, because
/// verifying again wouldn't change the outcome.
export function isTerminalStatus(status: ComplianceStatus): boolean {
  return status === "BlockedJurisdiction" || status === "SelfExcluded";
}
