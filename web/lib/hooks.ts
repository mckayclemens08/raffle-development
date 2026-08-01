"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNow } from "./useNow";
import { parseAbiItem } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWatchContractEvent,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  COMPLIANCE_ABI,
  COMPLIANCE_ADDRESS,
  ERC20_ABI,
  LOTTERY_ABI,
  LOTTERY_ADDRESS,
  MARKET_ABI,
  MARKET_ADDRESS,
  TARGET_CHAIN_ID,
  USDC_ADDRESS,
} from "./contracts";
import {
  BLOCKED_COUNTRIES,
  bytes2ToCountry,
  COMPLIANCE_STATUS,
  countryToBytes2,
  SAMPLE_ALLOWED_COUNTRIES,
  type ComplianceStatus,
} from "./compliance";

/// The connected wallet's KYC standing, read straight from the registry the
/// contracts enforce against — so the UI can never disagree with the chain.
export function useCompliance() {
  const { address } = useAccount();

  const { data: statusIndex, refetch: refetchStatus } = useReadContract({
    address: COMPLIANCE_ADDRESS,
    abi: COMPLIANCE_ABI,
    functionName: "statusOf",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(COMPLIANCE_ADDRESS) && Boolean(address) },
  });

  const { data: record, refetch: refetchRecord } = useReadContract({
    address: COMPLIANCE_ADDRESS,
    abi: COMPLIANCE_ABI,
    functionName: "recordOf",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(COMPLIANCE_ADDRESS) && Boolean(address) },
  });

  const { data: excludedUntil, refetch: refetchExclusion } = useReadContract({
    address: COMPLIANCE_ADDRESS,
    abi: COMPLIANCE_ABI,
    functionName: "selfExcludedUntil",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(COMPLIANCE_ADDRESS) && Boolean(address) },
  });

  const parsedRecord = record as
    | { country: string; verifiedAt: bigint; expiresAt: bigint; revoked: boolean; providerRef: string }
    | undefined;

  const status: ComplianceStatus =
    statusIndex === undefined ? "None" : COMPLIANCE_STATUS[Number(statusIndex)] ?? "None";

  // Read the exclusion timestamp directly rather than inferring it from status.
  // On-chain, a harder disqualification (unverified, revoked, blocked country)
  // outranks self-exclusion so that `canClaim` stays strict — but the player
  // still needs to be told their exclusion is real and in force.
  const excludedUntilValue = (excludedUntil as bigint | undefined) ?? 0n;
  // Compared against the clock hook rather than Date.now() so this stays pure
  // during render and matches between server and client.
  const nowMs = useNow(30_000);
  const isSelfExcluded =
    nowMs !== null && excludedUntilValue > BigInt(Math.floor(nowMs / 1000));

  return {
    status,
    isVerified: status === "Verified",
    country: parsedRecord ? bytes2ToCountry(parsedRecord.country) : "",
    expiresAt: parsedRecord?.expiresAt ?? 0n,
    selfExcludedUntil: excludedUntilValue,
    isSelfExcluded,
    // Compliance is unconfigured on this deployment; treat as ungated rather
    // than locking everyone out of a demo build.
    isConfigured: Boolean(COMPLIANCE_ADDRESS),
    refetch: () => {
      refetchStatus();
      refetchRecord();
      refetchExclusion();
    },
  };
}

/// Just the connected wallet's USDC balance, for display where no spender
/// (and therefore no allowance) is involved.
export function useUsdcBalance() {
  const { address } = useAccount();

  const { data: balance, refetch } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: Boolean(USDC_ADDRESS) && Boolean(address),
      // A balance that doesn't move after a purchase or a payout reads as a
      // failed transaction, so keep it fresh even when the tab isn't focused.
      refetchInterval: 10_000,
      refetchIntervalInBackground: true,
    },
  });

  return { balance: balance as bigint | undefined, refetch };
}

/// Accrued fee balances and the pause switch, for the admin dashboard.
export function useTreasury() {
  const { data, refetch } = useReadContracts({
    contracts: [
      { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "accruedFees", chainId: TARGET_CHAIN_ID },
      { address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: "accruedFees", chainId: TARGET_CHAIN_ID },
      { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "paused", chainId: TARGET_CHAIN_ID },
    ],
    query: {
      enabled: Boolean(LOTTERY_ADDRESS) && Boolean(MARKET_ADDRESS),
      refetchInterval: 10_000,
      // A backgrounded tab pauses interval refetches by default, which leaves an
      // operator staring at a stale "Live" badge after they hit pause.
      refetchIntervalInBackground: true,
    },
  });

  return {
    lotteryFees: data?.[0]?.result as bigint | undefined,
    marketFees: data?.[1]?.result as bigint | undefined,
    lotteryPaused: data?.[2]?.result as boolean | undefined,
    refetch,
  };
}

/// Player-initiated self-exclusion. Deliberately has no counterpart to lift it:
/// the contract has no such function, and adding a UI for one would be a lie.
export function useSelfExclude() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  /// @param seconds null means permanent.
  function selfExclude(seconds: number | null) {
    const until =
      seconds === null
        ? 18446744073709551615n // type(uint64).max
        : BigInt(Math.floor(Date.now() / 1000) + seconds);

    writeContract({
      address: COMPLIANCE_ADDRESS,
      abi: COMPLIANCE_ABI,
      functionName: "selfExclude",
      args: [until],
      chainId: TARGET_CHAIN_ID,
    });
  }

  return { selfExclude, isPending, isConfirming, isSuccess, error, hash };
}

/// Owner-only writes against the ComplianceRegistry (block/unblock a country,
/// revoke a verification).
export function useComplianceAdminAction() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function run(functionName: string, args: unknown[]) {
    writeContract({
      address: COMPLIANCE_ADDRESS,
      abi: COMPLIANCE_ABI,
      functionName,
      args,
      chainId: TARGET_CHAIN_ID,
    });
  }

  return { run, isPending, isConfirming, isSuccess, error, hash };
}

/// Which of the app's known jurisdictions are currently blocked on-chain.
/// Reads the candidate list from lib/compliance rather than enumerating the
/// mapping, which isn't iterable on-chain.
export function useBlockedCountries() {
  const candidates = useMemo(() => [...BLOCKED_COUNTRIES, ...SAMPLE_ALLOWED_COUNTRIES], []);

  const { data } = useReadContracts({
    contracts: candidates.map((code) => ({
      address: COMPLIANCE_ADDRESS,
      abi: COMPLIANCE_ABI,
      functionName: "isBlockedCountry",
      args: [countryToBytes2(code)],
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: Boolean(COMPLIANCE_ADDRESS) },
  });

  return useMemo(
    () => candidates.filter((_, index) => data?.[index]?.result === true),
    [candidates, data]
  );
}

/// Allowance + balance for the connected wallet against a given spender,
/// plus an approve action. Both raffle and market purchases pull USDC via
/// transferFrom, so the user must approve the spender first.
export function useUsdc(spender: `0x${string}`) {
  const { address } = useAccount();

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, spender] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(USDC_ADDRESS) && Boolean(address) },
  });

  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(USDC_ADDRESS) && Boolean(address) },
  });

  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      refetchAllowance();
      refetchBalance();
    }
  }, [isSuccess, refetchAllowance, refetchBalance]);

  function approve(amount: bigint) {
    writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
      chainId: TARGET_CHAIN_ID,
    });
  }

  return {
    allowance: allowance as bigint | undefined,
    balance: balance as bigint | undefined,
    approve,
    isApproving: isPending || isConfirming,
    approveError: error,
    refetch: () => {
      refetchAllowance();
      refetchBalance();
    },
  };
}

export function useCurrentRound() {
  const { data: currentRound } = useReadContract({
    address: LOTTERY_ADDRESS,
    abi: LOTTERY_ABI,
    functionName: "currentRound",
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(LOTTERY_ADDRESS) },
  });

  const roundId = currentRound as bigint | undefined;

  const { data: round, refetch: refetchRound } = useReadContract({
    address: LOTTERY_ADDRESS,
    abi: LOTTERY_ABI,
    functionName: "rounds",
    args: roundId !== undefined ? [roundId] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(LOTTERY_ADDRESS) && roundId !== undefined },
  });

  const { data: price, refetch: refetchPrice } = useReadContract({
    address: LOTTERY_ADDRESS,
    abi: LOTTERY_ABI,
    functionName: "getCurrentPrice",
    args: roundId !== undefined ? [roundId] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(LOTTERY_ADDRESS) && roundId !== undefined },
  });

  // The `rounds` public getter returns the struct as a positional tuple, so this
  // mapping has to track the struct field order in LotteryTicket.sol exactly.
  // Getting it wrong is silent and dangerous — reading a timestamp where a bool
  // is expected makes it truthy, which previously made the app believe a prize
  // was already paid and hid the claim button.
  const parsed = useMemo(() => {
    if (!round) return undefined;
    const [
      startTime,
      endTime,
      firstTicketId,
      ticketsSold,
      pool,
      vrfRequestId,
      winnerTicketId,
      drawRequestedAt,
      drawnAt,
      drawn,
      paid,
      swept,
    ] = round as readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
      boolean,
      boolean,
    ];
    return {
      startTime,
      endTime,
      firstTicketId,
      ticketsSold,
      pool,
      vrfRequestId,
      winnerTicketId,
      drawRequestedAt,
      drawnAt,
      drawn,
      paid,
      swept,
    };
  }, [round]);

  return {
    roundId,
    round: parsed,
    price: price as bigint | undefined,
    refetch: () => {
      refetchRound();
      refetchPrice();
    },
  };
}

export function useBuyTicket() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function buyTicket(maxPrice: bigint) {
    writeContract({
      address: LOTTERY_ADDRESS,
      abi: LOTTERY_ABI,
      functionName: "buyTicket",
      args: [maxPrice],
      chainId: TARGET_CHAIN_ID,
    });
  }

  return { buyTicket, isPending, isConfirming, isSuccess, error, hash };
}

export function useMyTickets() {
  const { address } = useAccount();

  const { data: balance } = useReadContract({
    address: LOTTERY_ADDRESS,
    abi: LOTTERY_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(LOTTERY_ADDRESS) && Boolean(address) },
  });

  const count = Number((balance as bigint | undefined) ?? 0n);

  const { data: tokenResults, refetch } = useReadContracts({
    contracts: Array.from({ length: count }, (_, index) => ({
      address: LOTTERY_ADDRESS,
      abi: LOTTERY_ABI,
      functionName: "tokenOfOwnerByIndex",
      args: [address, BigInt(index)],
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: Boolean(LOTTERY_ADDRESS) && Boolean(address) && count > 0 },
  });

  const ticketIds = useMemo(
    () => (tokenResults ?? []).map((r) => r.result as bigint | undefined).filter((v): v is bigint => v !== undefined),
    [tokenResults]
  );

  return { balance: balance as bigint | undefined, address, ticketIds, refetch };
}

export function useClaimPrize() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function claimPrize(roundId: bigint) {
    writeContract({
      address: LOTTERY_ADDRESS,
      abi: LOTTERY_ABI,
      functionName: "claimPrize",
      args: [roundId],
      chainId: TARGET_CHAIN_ID,
    });
  }

  return { claimPrize, isPending, isConfirming, isSuccess, error, hash };
}

export function useListTicket() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function approveMarket(ticketId: bigint) {
    writeContract({
      address: LOTTERY_ADDRESS,
      abi: LOTTERY_ABI,
      functionName: "approve",
      args: [MARKET_ADDRESS, ticketId],
      chainId: TARGET_CHAIN_ID,
    });
  }

  function listTicket(ticketId: bigint, price: bigint) {
    writeContract({
      address: MARKET_ADDRESS,
      abi: MARKET_ABI,
      functionName: "listTicket",
      args: [ticketId, price],
      chainId: TARGET_CHAIN_ID,
    });
  }

  return { approveMarket, listTicket, isPending, isConfirming, isSuccess, error, hash };
}

const TICKET_LISTED_EVENT = parseAbiItem(
  "event TicketListed(uint256 indexed ticketId, address indexed seller, uint256 price)"
);

/// @dev Scans TicketListed logs to find candidate ticket ids, then reads the
/// current on-chain listing for each so cancelled/sold listings drop off.
export function useMarketListings() {
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const [candidateIds, setCandidateIds] = useState<bigint[]>([]);

  const loadCandidates = useCallback(async () => {
    if (!publicClient || !MARKET_ADDRESS) return;
    try {
      const logs = await publicClient.getLogs({
        address: MARKET_ADDRESS,
        event: TICKET_LISTED_EVENT,
        fromBlock: 0n,
        toBlock: "latest",
      });
      setCandidateIds(Array.from(new Set(logs.map((log) => log.args.ticketId as bigint))));
    } catch {
      setCandidateIds([]);
    }
  }, [publicClient]);

  useEffect(() => {
    // Fetch-on-mount: loadCandidates is async, so the setState happens in the
    // promise continuation rather than synchronously in the effect body. The
    // lint rule can't see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCandidates();
  }, [loadCandidates]);

  const { data: listingResults, refetch } = useReadContracts({
    contracts: candidateIds.map((id) => ({
      address: MARKET_ADDRESS,
      abi: MARKET_ABI,
      functionName: "listings",
      args: [id],
      chainId: TARGET_CHAIN_ID,
    })),
    query: { enabled: Boolean(MARKET_ADDRESS) && candidateIds.length > 0 },
  });

  // A newly listed ticket has an id we've never seen, so a listing needs a full
  // log re-scan. A sale or cancellation only flips `active` on an id we already
  // track, so re-reading the listings is enough — but it IS necessary, or a
  // ticket someone just bought stays on the board looking available.
  useWatchContractEvent({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    eventName: "TicketListed",
    chainId: TARGET_CHAIN_ID,
    enabled: Boolean(MARKET_ADDRESS),
    onLogs: () => {
      loadCandidates();
    },
  });

  useWatchContractEvent({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    eventName: "TicketSold",
    chainId: TARGET_CHAIN_ID,
    enabled: Boolean(MARKET_ADDRESS),
    onLogs: () => {
      refetch();
    },
  });

  useWatchContractEvent({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    eventName: "ListingCancelled",
    chainId: TARGET_CHAIN_ID,
    enabled: Boolean(MARKET_ADDRESS),
    onLogs: () => {
      refetch();
    },
  });

  const listings = useMemo(() => {
    return candidateIds
      .map((ticketId, index) => {
        const result = listingResults?.[index]?.result as readonly [string, bigint, boolean] | undefined;
        if (!result) return null;
        const [seller, price, active] = result;
        return { ticketId, seller, price, active };
      })
      .filter((listing): listing is { ticketId: bigint; seller: string; price: bigint; active: boolean } =>
        Boolean(listing && listing.active)
      );
  }, [candidateIds, listingResults]);

  return {
    listings,
    // Re-scan for new ticket ids as well as re-reading the known ones, so the
    // manual Refresh can surface a listing created in another tab/session.
    refetch: () => {
      loadCandidates();
      refetch();
    },
  };
}

export function useBuyListing() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function buyListing(ticketId: bigint) {
    writeContract({
      address: MARKET_ADDRESS,
      abi: MARKET_ABI,
      functionName: "buyTicket",
      args: [ticketId],
      chainId: TARGET_CHAIN_ID,
    });
  }

  return { buyListing, isPending, isConfirming, isSuccess, error, hash };
}

export function useLotteryOwner() {
  const { address } = useAccount();

  const { data: owner } = useReadContract({
    address: LOTTERY_ADDRESS,
    abi: LOTTERY_ABI,
    functionName: "owner",
    chainId: TARGET_CHAIN_ID,
    query: { enabled: Boolean(LOTTERY_ADDRESS) },
  });

  const ownerAddress = owner as `0x${string}` | undefined;

  return {
    owner: ownerAddress,
    isOwner: Boolean(address && ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase()),
  };
}

/// @dev Generic write hook for the owner-only admin actions — avoids one
/// useWriteContract/useWaitForTransactionReceipt pair per contract function.
function useContractAction(address: `0x${string}`, abi: typeof LOTTERY_ABI | typeof MARKET_ABI) {
  const { data: hash, writeContract, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function run(functionName: string, args: readonly unknown[] = []) {
    writeContract({ address, abi, functionName, args, chainId: TARGET_CHAIN_ID });
  }

  return { run, isPending, isConfirming, isSuccess, error, hash, reset };
}

export function useLotteryAdminAction() {
  return useContractAction(LOTTERY_ADDRESS, LOTTERY_ABI);
}

export function useMarketAdminAction() {
  return useContractAction(MARKET_ADDRESS, MARKET_ABI);
}

export function useAdminSettings() {
  const contracts = [
    { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "basePrice", chainId: TARGET_CHAIN_ID },
    { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "priceIncrement", chainId: TARGET_CHAIN_ID },
    { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "roundDuration", chainId: TARGET_CHAIN_ID },
    { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "feeRecipient", chainId: TARGET_CHAIN_ID },
    { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "keyHash", chainId: TARGET_CHAIN_ID },
    { address: LOTTERY_ADDRESS, abi: LOTTERY_ABI, functionName: "vrfSubscriptionId", chainId: TARGET_CHAIN_ID },
    { address: MARKET_ADDRESS, abi: MARKET_ABI, functionName: "feeRecipient", chainId: TARGET_CHAIN_ID },
  ] as const;

  const { data, refetch } = useReadContracts({
    contracts,
    query: { enabled: Boolean(LOTTERY_ADDRESS) && Boolean(MARKET_ADDRESS) },
  });

  const [basePrice, priceIncrement, roundDuration, feeRecipient, keyHash, vrfSubscriptionId, marketFeeRecipient] =
    data ?? [];

  return {
    basePrice: basePrice?.result as bigint | undefined,
    priceIncrement: priceIncrement?.result as bigint | undefined,
    roundDuration: roundDuration?.result as bigint | undefined,
    feeRecipient: feeRecipient?.result as `0x${string}` | undefined,
    keyHash: keyHash?.result as `0x${string}` | undefined,
    vrfSubscriptionId: vrfSubscriptionId?.result as bigint | undefined,
    marketFeeRecipient: marketFeeRecipient?.result as `0x${string}` | undefined,
    refetch,
  };
}
