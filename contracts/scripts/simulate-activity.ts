import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// Buys a handful of raffle tickets from the seeded dev accounts so the app's
/// charts and listings have real on-chain activity. Safe to run repeatedly.
async function main() {
  const envPath = path.join(__dirname, "..", "..", "web", ".env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const lotteryAddress = env.match(/NEXT_PUBLIC_LOTTERY_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
  const usdcAddress = env.match(/NEXT_PUBLIC_USDC_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
  if (!lotteryAddress || !usdcAddress) throw new Error("addresses not found in web/.env.local — run deploy-local first");

  const lottery = await ethers.getContractAt("LotteryTicket", lotteryAddress);
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddress);
  const signers = await ethers.getSigners();
  const buyers = signers.slice(1, 5);

  const count = Number(process.env.TICKETS ?? 6);
  for (let i = 0; i < count; i++) {
    const buyer = buyers[i % buyers.length];
    const roundId = await lottery.currentRound();
    const price = await lottery.getCurrentPrice(roundId);

    const balance = await usdc.balanceOf(buyer.address);
    if (balance < price) await usdc.mint(buyer.address, price * 10n);
    await usdc.connect(buyer).approve(lotteryAddress, price);
    const tx = await lottery.connect(buyer).buyTicket(price);
    await tx.wait();
    console.log(`ticket bought by ${buyer.address.slice(0, 8)}… at $${Number(price) / 1e6}`);

    // Small pause so purchases land in distinct blocks/timestamps.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const roundId = await lottery.currentRound();
  const round = await lottery.rounds(roundId);
  console.log(`round ${roundId}: ${round.ticketsSold} tickets, pool $${Number(round.pool) / 1e6}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
