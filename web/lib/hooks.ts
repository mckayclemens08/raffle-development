"use client";

import { useEffect, useMemo, useState } from "react";
import { parseAbiItem } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { LOTTERY_ABI, LOTTERY_ADDRESS, MARKET_ABI, MARKET_ADDRESS, TARGET_CHAIN_ID } from "./contracts";

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

  const parsed = useMemo(() => {
    if (!round) return undefined;
    const [startTime, endTime, firstTicketId, ticketsSold, pool, vrfRequestId, winnerTicketId, drawn, paid] =
      round as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];
    return { startTime, endTime, firstTicketId, ticketsSold, pool, vrfRequestId, winnerTicketId, drawn, paid };
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

  function buyTicket(price: bigint) {
    writeContract({
      address: LOTTERY_ADDRESS,
      abi: LOTTERY_ABI,
      functionName: "buyTicket",
      chainId: TARGET_CHAIN_ID,
      value: price,
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

  useEffect(() => {
    if (!publicClient || !MARKET_ADDRESS) return;
    let cancelled = false;

    publicClient
      .getLogs({
        address: MARKET_ADDRESS,
        event: TICKET_LISTED_EVENT,
        fromBlock: 0n,
        toBlock: "latest",
      })
      .then((logs) => {
        if (cancelled) return;
        const ids = Array.from(new Set(logs.map((log) => log.args.ticketId as bigint)));
        setCandidateIds(ids);
      })
      .catch(() => {
        if (!cancelled) setCandidateIds([]);
      });

    return () => {
      cancelled = true;
    };
  }, [publicClient]);

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

  return { listings, refetch };
}

export function useBuyListing() {
  const { data: hash, writeContract, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function buyListing(ticketId: bigint, price: bigint) {
    writeContract({
      address: MARKET_ADDRESS,
      abi: MARKET_ABI,
      functionName: "buyTicket",
      args: [ticketId],
      chainId: TARGET_CHAIN_ID,
      value: price,
    });
  }

  return { buyListing, isPending, isConfirming, isSuccess, error, hash };
}
