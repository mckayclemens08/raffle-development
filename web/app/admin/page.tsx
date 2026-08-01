"use client";

import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import {
  useAdminSettings,
  useBlockedCountries,
  useComplianceAdminAction,
  useCurrentRound,
  useLotteryAdminAction,
  useLotteryOwner,
  useMarketAdminAction,
  useTreasury,
} from "@/lib/hooks";
import {
  formatUsdc,
  parseUsdc,
  COMPLIANCE_ADDRESS,
  DRAW_RETRY_TIMEOUT_SECONDS,
  LOTTERY_ADDRESS,
  MARKET_ADDRESS,
} from "@/lib/contracts";
import { countryToBytes2 } from "@/lib/compliance";
import { useNow } from "@/lib/useNow";

function StatusLine({
  isPending,
  isConfirming,
  isSuccess,
  error,
}: {
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: Error | null;
}) {
  if (error) return <p className="mt-2 text-sm text-red-600">{error.message}</p>;
  if (isPending || isConfirming) return <p className="mt-2 text-sm text-neutral-500">Confirming…</p>;
  if (isSuccess) return <p className="mt-2 text-sm text-emerald-600">Confirmed.</p>;
  return null;
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="font-semibold text-neutral-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-neutral-900"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function RoundOverview() {
  const { roundId, round, price, refetch } = useCurrentRound();
  const lotteryAction = useLotteryAdminAction();
  const now = useNow(30_000);

  // Requesting a draw or opening a round changes everything on this card, so
  // pull fresh state the moment the transaction confirms.
  const settled = lotteryAction.isSuccess;
  useEffect(() => {
    if (settled) refetch();
    // `refetch` is recreated each render by the hook, so keying on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  if (!round || roundId === undefined) return null;

  const isClosed = now !== null && now >= Number(round.endTime) * 1000;
  // A pending draw becomes retryable once the timeout lapses, so the button
  // can't leave a stuck round with no way forward.
  const drawPending = round.vrfRequestId !== 0n && !round.drawn;
  const retryDueAt = (Number(round.drawRequestedAt) + DRAW_RETRY_TIMEOUT_SECONDS) * 1000;
  const canRetry = drawPending && now !== null && now >= retryDueAt;
  const canRequestDraw =
    isClosed && round.ticketsSold > 0n && !round.drawn && (round.vrfRequestId === 0n || canRetry);
  // Only needs the round drawn, not claimed — see LotteryTicket.startNewRound.
  const canStartNewRound = round.ticketsSold === 0n || round.drawn;

  function drawButtonLabel() {
    if (!isClosed) return "Request draw (round still open)";
    if (round!.drawn) return "Already drawn";
    if (canRetry) return "Retry draw";
    if (drawPending) return "Draw pending…";
    return "Request draw";
  }

  return (
    <Card title={`Round ${roundId.toString()}`} description="Live state read straight from the contract.">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-neutral-500">Tickets sold</dt>
          <dd className="font-medium text-neutral-900">{round.ticketsSold.toString()}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Prize pool</dt>
          <dd className="font-medium text-neutral-900">${formatUsdc(round.pool)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Current price</dt>
          <dd className="font-medium text-neutral-900">{price !== undefined ? `$${formatUsdc(price)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Ends</dt>
          <dd className="font-medium text-neutral-900">
            {new Date(Number(round.endTime) * 1000).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Draw requested</dt>
          <dd className="font-medium text-neutral-900">{round.vrfRequestId !== 0n ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Drawn</dt>
          <dd className="font-medium text-neutral-900">{round.drawn ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Winning ticket</dt>
          <dd className="font-medium text-neutral-900">{round.drawn ? `#${round.winnerTicketId.toString()}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Paid out</dt>
          <dd className="font-medium text-neutral-900">{round.paid ? "Yes" : "No"}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canRequestDraw || lotteryAction.isPending || lotteryAction.isConfirming}
          onClick={() => lotteryAction.run("requestDraw")}
        >
          {drawButtonLabel()}
        </button>
        <button
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canStartNewRound || lotteryAction.isPending || lotteryAction.isConfirming}
          onClick={() => lotteryAction.run("startNewRound")}
        >
          Start new round
        </button>
        <button className="rounded-lg px-4 py-2 text-sm text-neutral-500 underline" onClick={() => refetch()}>
          Refresh
        </button>
      </div>
      <StatusLine {...lotteryAction} error={lotteryAction.error} />
    </Card>
  );
}

function PricingForm({ basePrice, priceIncrement }: { basePrice: bigint; priceIncrement: bigint }) {
  const [base, setBase] = useState(formatUsdc(basePrice).replace(/,/g, ""));
  const [increment, setIncrement] = useState(formatUsdc(priceIncrement).replace(/,/g, ""));
  const action = useLotteryAdminAction();

  return (
    <Card title="Ticket pricing" description="Base price for a fresh round, and how much each sale bumps the next ticket. All amounts in USD (USDC).">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Base price (USD)" value={base} onChange={setBase} />
        <TextField label="Price increment (USD)" value={increment} onChange={setIncrement} />
      </div>
      <button
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={action.isPending || action.isConfirming}
        onClick={() => action.run("setPricing", [parseUsdc(base || "0"), parseUsdc(increment || "0")])}
      >
        Save pricing
      </button>
      <StatusLine {...action} error={action.error} />
    </Card>
  );
}

function RoundDurationForm({ roundDuration }: { roundDuration: bigint }) {
  const [days, setDays] = useState((Number(roundDuration) / 86400).toString());
  const action = useLotteryAdminAction();

  return (
    <Card title="Round duration" description="Applies the next time a new round is started.">
      <TextField label="Duration (days)" value={days} onChange={setDays} />
      <button
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={action.isPending || action.isConfirming}
        onClick={() => action.run("setRoundDuration", [BigInt(Math.round(Number(days || "0") * 86400))])}
      >
        Save duration
      </button>
      <StatusLine {...action} error={action.error} />
    </Card>
  );
}

function FeeRecipientForm({
  title,
  current,
  onSave,
  action,
}: {
  title: string;
  current: `0x${string}`;
  onSave: (address: `0x${string}`) => void;
  action: ReturnType<typeof useLotteryAdminAction>;
}) {
  const [address, setAddress] = useState<string>(current);
  const valid = isAddress(address);

  return (
    <Card title={title}>
      <TextField label="Recipient address" value={address} onChange={setAddress} />
      {!valid && address.length > 0 && <p className="mt-1 text-xs text-red-600">Not a valid address.</p>}
      <button
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={!valid || action.isPending || action.isConfirming}
        onClick={() => onSave(address as `0x${string}`)}
      >
        Save
      </button>
      <StatusLine {...action} error={action.error} />
    </Card>
  );
}

function VrfConfigForm({ keyHash, subscriptionId }: { keyHash: `0x${string}`; subscriptionId: bigint }) {
  const [hash, setHash] = useState(keyHash);
  const [subId, setSubId] = useState(subscriptionId.toString());
  const action = useLotteryAdminAction();

  return (
    <Card title="Chainlink VRF" description="Only change this when migrating to a different subscription or coordinator key.">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Key hash" value={hash} onChange={(v) => setHash(v as `0x${string}`)} />
        <TextField label="Subscription ID" value={subId} onChange={setSubId} />
      </div>
      <button
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        disabled={action.isPending || action.isConfirming}
        onClick={() => action.run("setVrfConfig", [hash, BigInt(subId || "0")])}
      >
        Save VRF config
      </button>
      <StatusLine {...action} error={action.error} />
    </Card>
  );
}

export default function AdminPage() {
  const { isConnected, address } = useAccount();
  const { owner, isOwner } = useLotteryOwner();
  const settings = useAdminSettings();
  const lotteryFeeAction = useLotteryAdminAction();
  const marketAction = useMarketAdminAction();

  if (!LOTTERY_ADDRESS || !MARKET_ADDRESS) {
    return <p className="mx-auto max-w-4xl px-6 py-16 text-center text-neutral-500">Contracts not deployed yet.</p>;
  }

  if (!isConnected) {
    return (
      <p className="mx-auto max-w-4xl px-6 py-16 text-center text-neutral-500">
        Connect the contract owner&apos;s wallet to access the admin dashboard.
      </p>
    );
  }

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16 text-center text-neutral-500">
        <p>This wallet isn&apos;t the contract owner.</p>
        <p className="mt-2 font-mono text-xs">
          Connected: {address}
          <br />
          Owner: {owner ?? "—"}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900">Admin</h1>
      <p className="mt-1 text-sm text-neutral-500">Owner-only controls for running the raffle.</p>

      <div className="mt-8 flex flex-col gap-6">
        <RoundOverview />

        {settings.basePrice !== undefined && settings.priceIncrement !== undefined && (
          <PricingForm basePrice={settings.basePrice} priceIncrement={settings.priceIncrement} />
        )}

        {settings.roundDuration !== undefined && <RoundDurationForm roundDuration={settings.roundDuration} />}

        {settings.feeRecipient !== undefined && (
          <FeeRecipientForm
            title="Raffle fee recipient"
            current={settings.feeRecipient}
            action={lotteryFeeAction}
            onSave={(addr) => lotteryFeeAction.run("setFeeRecipient", [addr])}
          />
        )}

        {settings.marketFeeRecipient !== undefined && (
          <FeeRecipientForm
            title="Secondary market fee recipient"
            current={settings.marketFeeRecipient}
            action={marketAction}
            onSave={(addr) => marketAction.run("setFeeRecipient", [addr])}
          />
        )}

        {settings.keyHash !== undefined && settings.vrfSubscriptionId !== undefined && (
          <VrfConfigForm keyHash={settings.keyHash} subscriptionId={settings.vrfSubscriptionId} />
        )}

        <TreasuryAndSafety />

        <ComplianceAdmin />
      </div>
    </div>
  );
}

/// Fees accrue in the contracts rather than being pushed on every payout (so a
/// frozen fee recipient can't block a player's money), which means they have to
/// be withdrawn deliberately. Pause is the emergency stop.
function TreasuryAndSafety() {
  const treasury = useTreasury();
  const lotteryAction = useLotteryAdminAction();
  const marketAction = useMarketAdminAction();

  // Reflect a pause or a withdrawal as soon as it confirms, rather than making
  // the operator wait for the next poll.
  const { refetch } = treasury;
  const settled = lotteryAction.isSuccess || marketAction.isSuccess;
  useEffect(() => {
    if (settled) refetch();
  }, [settled, refetch]);

  return (
    <Card
      title="Treasury & safety"
      description="Collect accrued fees, sweep expired prizes, and halt the platform if something goes wrong."
    >
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-neutral-500">Raffle fees</dt>
          <dd className="font-medium text-neutral-900">
            {treasury.lotteryFees !== undefined ? `$${formatUsdc(treasury.lotteryFees)}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Market fees</dt>
          <dd className="font-medium text-neutral-900">
            {treasury.marketFees !== undefined ? `$${formatUsdc(treasury.marketFees)}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Status</dt>
          <dd className="font-medium text-neutral-900">
            {treasury.lotteryPaused === undefined ? "—" : treasury.lotteryPaused ? "Paused" : "Live"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!treasury.lotteryFees || treasury.lotteryFees === 0n || lotteryAction.isPending}
          onClick={() => lotteryAction.run("withdrawFees")}
        >
          Withdraw raffle fees
        </button>
        <button
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 disabled:opacity-50"
          disabled={!treasury.marketFees || treasury.marketFees === 0n || marketAction.isPending}
          onClick={() => marketAction.run("withdrawFees")}
        >
          Withdraw market fees
        </button>
        <button
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
            treasury.lotteryPaused ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
          }`}
          disabled={lotteryAction.isPending || lotteryAction.isConfirming}
          onClick={() => lotteryAction.run(treasury.lotteryPaused ? "unpause" : "pause")}
        >
          {treasury.lotteryPaused ? "Resume ticket sales" : "Pause ticket sales"}
        </button>
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Pausing stops buying, listing and trading. Claiming a prize is never paused — players can always
        withdraw what they have won.
      </p>

      <StatusLine
        isPending={lotteryAction.isPending || marketAction.isPending}
        isConfirming={lotteryAction.isConfirming || marketAction.isConfirming}
        isSuccess={lotteryAction.isSuccess || marketAction.isSuccess}
        error={lotteryAction.error ?? marketAction.error}
      />
    </Card>
  );
}

/// Jurisdiction blocking and per-user revocation. Both are enforced on-chain,
/// so a change here immediately affects who can buy, trade and claim.
function ComplianceAdmin() {
  const action = useComplianceAdminAction();
  const [countryCode, setCountryCode] = useState("");
  const [lookupAddress, setLookupAddress] = useState("");

  const blocked = useBlockedCountries();

  if (!COMPLIANCE_ADDRESS) {
    return (
      <Card title="Compliance" description="No ComplianceRegistry is configured for this deployment." >
        <p className="text-sm text-neutral-500">
          Set <code className="rounded bg-neutral-100 px-1">NEXT_PUBLIC_COMPLIANCE_ADDRESS</code> to manage KYC.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Compliance"
      description="Block a jurisdiction or withdraw a user's verification. Applies on-chain immediately."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <TextField
            label="Country code (ISO alpha-2)"
            value={countryCode}
            onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))}
            placeholder="FR"
          />
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              disabled={countryCode.length !== 2 || action.isPending || action.isConfirming}
              onClick={() => action.run("setBlockedCountry", [countryToBytes2(countryCode), true])}
            >
              Block
            </button>
            <button
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
              disabled={countryCode.length !== 2 || action.isPending || action.isConfirming}
              onClick={() => action.run("setBlockedCountry", [countryToBytes2(countryCode), false])}
            >
              Unblock
            </button>
          </div>
          {blocked.length > 0 && (
            <p className="mt-3 text-xs text-neutral-500">
              Currently blocked: <span className="font-medium text-neutral-900">{blocked.join(", ")}</span>
            </p>
          )}
        </div>

        <div>
          <TextField
            label="Revoke a wallet's verification"
            value={lookupAddress}
            onChange={setLookupAddress}
            placeholder="0x…"
          />
          <button
            className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            disabled={!isAddress(lookupAddress) || action.isPending || action.isConfirming}
            onClick={() => action.run("revoke", [lookupAddress as `0x${string}`])}
          >
            Revoke
          </button>
          <p className="mt-3 text-xs text-neutral-500">
            A revoked winner&apos;s prize is withheld, not lost — it releases once they re-verify.
          </p>
        </div>
      </div>
      <StatusLine
        isPending={action.isPending}
        isConfirming={action.isConfirming}
        isSuccess={action.isSuccess}
        error={action.error}
      />
    </Card>
  );
}
