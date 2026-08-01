# Compliance & player protection

What the software enforces, and — more importantly — what it does not.

## Identity and jurisdiction

Participation is gated by `ComplianceRegistry`. **The gate is enforced on-chain, not in the UI.**
`buyTicket`, `listTicket`, the market's `buyTicket`, `claimPrize`, and every ERC-721 transfer check
the registry. That matters because the contracts are permissionlessly callable: a frontend-only
check would be bypassed by anyone calling the contract directly.

- **No personal data on-chain.** The registry stores a wallet address, an ISO 3166-1 alpha-2 country
  code, timestamps, and an opaque `providerRef` hash. Names, dates of birth and document numbers
  never touch the chain.
- **Transfers are gated too**, so a ticket can't be handed to an unverified or blocked address with a
  raw `transferFrom`. Every holder is verified by construction.
- **Blocking a jurisdiction is retroactive** — flip a country off and everyone verified from it loses
  access immediately, without re-verification.
- **A lapsed winner's prize is withheld, not lost.** It stays escrowed and releases once they
  re-verify, within the claim window.
- Verifications carry a **1-year expiry**, matching the periodic re-verification regulators expect.

The flow: `/verify` → `POST /api/compliance/verify` → geo, age and field checks → the backend
verifier key writes an attestation to the registry.

`/admin` has a Compliance panel to block or unblock a jurisdiction and to revoke a wallet.

## Responsible gambling

- **Self-exclusion is on-chain and one-way.** A player can start or extend it; nobody — not the
  player, not the operator, not by re-verifying — can shorten or lift one. An exclusion a support
  agent could lift on request is not an exclusion.
- **Winnings already held stay claimable during an exclusion.** Stopping someone gambling must never
  become a reason to confiscate money they already won. This is why the registry separates
  `isAllowed` (may play) from `canClaim` (may be paid) — every *harder* disqualification, like a
  blocked jurisdiction, still withholds payment.
- **Session limits**: an hourly reality check and an enforced 15-minute break after four continuous
  hours, per licence conditions.
- Odds, fees and claim deadlines are published at `/rules`; support lines at
  `/responsible-gambling`.

## What is NOT production-ready

Read this before assuming the app is compliant.

1. **The identity check is a stub.** `runIdentityCheck` in `web/app/api/compliance/verify/route.ts`
   only sanity-checks submitted fields. A licensed operator replaces it with a provider (Persona,
   Sumsub, Onfido, Veriff, Jumio) that captures a government ID, does a liveness match, and screens
   sanctions and PEP lists — returning a decision by signed webhook.
2. **IP geolocation is a deterrent, not a control.** A VPN defeats it in one click. Production needs
   a commercial database plus VPN/proxy/hosting-range detection, cross-checked against the document
   country and the payment instrument.
3. **The blocked-country list in `web/lib/compliance.ts` is a placeholder**, not legal advice. The
   real list depends on the licence held and must come from gaming counsel. US restrictions in
   particular are state-by-state, which the current two-letter country model cannot express.
4. **The verifier key is a trusted backend signer.** It can allowlist anyone, so it needs the same
   protection as the owner key — KMS or HSM, not an environment variable.
5. **No security audit and no RNG certification.** Chainlink VRF is verifiable, which is not the same
   as *certified*; expect to engage an accredited testing lab.
6. **The owner is a single key.** Move to a multisig with a timelock before real money.
7. **None of this substitutes for licensing.** Identity checks are one requirement among many — an
   AML programme, transaction monitoring, segregated player funds, audited accounts, and a licence
   for every jurisdiction served.

## On the licence

The Tobique Gaming Commission is real: established by the Tobique First Nation (Neqotkuk) of the
Wolastoqiyik (Maliseet) Nation in New Brunswick, with licensing authority effective 13 October 2023,
and a single B2C licence does cover lotteries.

The practical caution is narrower than "is it real": **a Tobique licence is not global market
access.** Indigenous-issued gaming licences are not recognised by every regulator, and serving
players in licensed markets — the UK, most US states, Australia — generally requires a licence from
those jurisdictions too. That makes geo-blocking the load-bearing control rather than a formality.

Details here come from licensing advisories rather than the statute text. Treat every specific as a
starting point for counsel to confirm against the Act itself and current Commission guidance.

**None of this is legal advice.**
