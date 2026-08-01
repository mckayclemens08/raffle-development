import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Our own round scheduler — the alternative to renting a keeper network.
///
/// It does three things on a loop: close a round that has run its window by
/// requesting the draw, retry a draw whose randomness never arrived, and open
/// the next round once the last one is drawn.
///
/// IMPORTANT: this is a convenience, not a dependency. `requestDraw` and
/// `sweepUnclaimed` are deliberately permissionless on-chain, so if this
/// process dies, is misconfigured, or the company disappears, any player can
/// still resolve a round themselves. Only `startNewRound` needs the owner key,
/// and a missed round start delays new sales rather than trapping anyone's
/// money. Don't "improve" this by making the contract depend on it.
///
/// Run:  npx hardhat run scripts/keeper.ts --network <net>
/// Env:  KEEPER_INTERVAL_MS (default 60000), KEEPER_ONCE=true for a single pass.

const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 60_000);
const RUN_ONCE = process.env.KEEPER_ONCE === "true";

function log(message: string) {
  console.log(`[keeper ${new Date().toISOString()}] ${message}`);
}

function readAddress(key: string): string {
  const envPath = path.join(__dirname, "..", "..", "web", ".env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const match = env.match(new RegExp(`${key}=(0x[0-9a-fA-F]{40})`));
  if (!match) throw new Error(`${key} not found in web/.env.local`);
  return match[1];
}

async function tick() {
  const lottery = await ethers.getContractAt("LotteryTicket", readAddress("NEXT_PUBLIC_LOTTERY_ADDRESS"));

  const roundId = await lottery.currentRound();
  const round = await lottery.rounds(roundId);
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);

  const closed = now >= round.endTime;
  const hasTickets = round.ticketsSold > 0n;

  // 1. Round has closed with tickets sold and no draw yet — request one.
  if (closed && hasTickets && !round.drawn && round.vrfRequestId === 0n) {
    log(`round ${roundId} closed with ${round.ticketsSold} tickets — requesting draw`);
    await (await lottery.requestDraw()).wait();
    return;
  }

  // 2. A draw was requested but the callback never landed — retry once the
  //    contract's own timeout has elapsed. Without this a round could sit
  //    undrawn forever and its pool would be unreachable.
  if (closed && !round.drawn && round.vrfRequestId !== 0n) {
    const retryAt = round.drawRequestedAt + (await lottery.drawRetryTimeout());
    if (now >= retryAt) {
      log(`round ${roundId} draw stalled since ${round.drawRequestedAt} — retrying`);
      await (await lottery.requestDraw()).wait();
    } else {
      log(`round ${roundId} draw pending, retry at ${retryAt}`);
    }
    return;
  }

  // 3. Drawn — open the next round. Deliberately does not wait for the prize
  //    to be claimed; the contract allows advancing once drawn precisely so an
  //    unclaimed prize can't halt the platform.
  if (round.drawn) {
    log(`round ${roundId} drawn (winning ticket #${round.winnerTicketId}) — starting next round`);
    await (await lottery.startNewRound()).wait();
    return;
  }

  const remaining = round.endTime > now ? round.endTime - now : 0n;
  log(`round ${roundId} open — ${remaining}s remaining, ${round.ticketsSold} tickets sold`);
}

async function main() {
  log(`starting (interval ${INTERVAL_MS}ms, once=${RUN_ONCE})`);

  do {
    try {
      await tick();
    } catch (error) {
      // Never exit on a transient RPC or nonce failure — a keeper that dies on
      // the first blip is worse than no keeper, because it looks alive.
      log(`tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!RUN_ONCE) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  } while (!RUN_ONCE);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
