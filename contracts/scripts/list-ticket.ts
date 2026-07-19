import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Lists one of the dev accounts' tickets on the secondary market so the
/// market page has a live listing. TICKET / PRICE_USD env vars override the
/// defaults (first ticket owned by the first buyer account, $11).
async function main() {
  const envPath = path.join(__dirname, "..", "..", "web", ".env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const lotteryAddress = env.match(/NEXT_PUBLIC_LOTTERY_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
  const marketAddress = env.match(/NEXT_PUBLIC_MARKET_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
  if (!lotteryAddress || !marketAddress) throw new Error("addresses not found — run deploy-local first");

  const lottery = await ethers.getContractAt("LotteryTicket", lotteryAddress);
  const market = await ethers.getContractAt("TicketMarket", marketAddress);
  const signers = await ethers.getSigners();

  const priceUsd = Number(process.env.PRICE_USD ?? 11);
  const price = BigInt(Math.round(priceUsd * 1_000_000));

  let ticketId = process.env.TICKET ? BigInt(process.env.TICKET) : undefined;
  let seller;
  if (ticketId !== undefined) {
    const owner = await lottery.ownerOf(ticketId);
    seller = signers.find((s) => s.address === owner);
    if (!seller) throw new Error(`no local signer owns ticket ${ticketId}`);
  } else {
    // Find the first ticket owned by any non-deployer dev account.
    outer: for (const signer of signers.slice(1, 6)) {
      const balance = await lottery.balanceOf(signer.address);
      if (balance > 0n) {
        ticketId = await lottery.tokenOfOwnerByIndex(signer.address, 0);
        seller = signer;
        break outer;
      }
    }
    if (ticketId === undefined || !seller) throw new Error("no dev account owns a ticket — run simulate-activity first");
  }

  await lottery.connect(seller).approve(marketAddress, ticketId);
  const tx = await market.connect(seller).listTicket(ticketId, price);
  await tx.wait();

  const listing = await market.listings(ticketId);
  console.log(
    `listed ticket #${ticketId} by ${seller.address.slice(0, 8)}… at $${priceUsd} (active: ${listing.active})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
