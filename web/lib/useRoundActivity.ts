"use client";

import { useCallback, useEffect, useState } from "react";
import { parseAbiItem } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { LOTTERY_ABI, LOTTERY_ADDRESS, TARGET_CHAIN_ID } from "./contracts";

const TICKET_PURCHASED_EVENT = parseAbiItem(
  "event TicketPurchased(uint256 indexed roundId, uint256 indexed ticketId, address indexed buyer, uint256 price)"
);

export interface PurchasePoint {
  /** Unix seconds of the block the purchase landed in. */
  timestamp: number;
  /** Price paid for this ticket (USDC, 6 decimals). */
  price: bigint;
  /** Cumulative prize pool immediately after this purchase (USDC, 6 decimals). */
  pool: bigint;
}

/// Purchase history for one raffle round, derived from TicketPurchased logs
/// plus their block timestamps. Scanning from block 0 is fine on a dev chain
/// and acceptable for one contract's indexed logs on an RPC provider; a
/// production deployment at scale would move this to an indexer/subgraph.
export function useRoundActivity(roundId: bigint | undefined) {
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const [points, setPoints] = useState<PurchasePoint[]>([]);

  const load = useCallback(async () => {
    if (!publicClient || !LOTTERY_ADDRESS || roundId === undefined) return;

    const logs = await publicClient.getLogs({
      address: LOTTERY_ADDRESS,
      event: TICKET_PURCHASED_EVENT,
      args: { roundId },
      fromBlock: 0n,
      toBlock: "latest",
    });

    const uniqueBlocks = Array.from(new Set(logs.map((log) => log.blockNumber)));
    const blocks = await Promise.all(uniqueBlocks.map((blockNumber) => publicClient.getBlock({ blockNumber })));
    const timestampByBlock = new Map(uniqueBlocks.map((bn, i) => [bn, Number(blocks[i].timestamp)]));

    let pool = 0n;
    const next: PurchasePoint[] = logs.map((log) => {
      const price = log.args.price as bigint;
      pool += price;
      return { timestamp: timestampByBlock.get(log.blockNumber) ?? 0, price, pool };
    });
    setPoints(next);
  }, [publicClient, roundId]);

  useEffect(() => {
    // Fetch-on-mount: `load` is async, so its setState lands in the promise
    // continuation, not synchronously in the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Re-pull when a new purchase lands, plus a slow safety-net poll in case the
  // event filter misses (some RPC transports drop filters).
  useWatchContractEvent({
    address: LOTTERY_ADDRESS,
    abi: LOTTERY_ABI,
    eventName: "TicketPurchased",
    chainId: TARGET_CHAIN_ID,
    enabled: Boolean(LOTTERY_ADDRESS) && roundId !== undefined,
    onLogs: () => {
      load();
    },
  });

  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  return { points, refetch: load };
}
