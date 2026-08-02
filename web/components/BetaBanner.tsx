import { BETA_MODE, FAUCET_ENABLED } from "@/lib/contracts";

/// Persistent, unmissable notice that this is a test.
///
/// Not decoration: a lottery that looks real and takes "dollars" invites people
/// to believe they've won something. Saying so once in an email is not enough —
/// it belongs on every page, above everything else.
export function BetaBanner() {
  if (!BETA_MODE) return null;

  return (
    <div className="bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">
      <span className="mr-1.5 rounded bg-amber-950 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-50">
        Beta
      </span>
      Test network — {FAUCET_ENABLED ? "the dollars here are play money with no value" : "do not send real funds"}. Prizes
      cannot be exchanged for anything.
    </div>
  );
}
