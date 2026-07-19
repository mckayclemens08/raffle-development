import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));

async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  const Coordinator = await ethers.getContractFactory("VRFCoordinatorV2Mock");
  const coordinator = await Coordinator.deploy(100_000_000_000_000_00n, 1_000_000_000n);
  await coordinator.waitForDeployment();

  const subTx = await coordinator.createSubscription();
  const subReceipt = await subTx.wait();
  const subEvent = subReceipt!.logs
    .map((log) => {
      try {
        return coordinator.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "SubscriptionCreated");
  const subId = subEvent!.args.subId;
  await coordinator.fundSubscription(subId, ethers.parseEther("100"));

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  // Seed the first few dev accounts with plenty of test USDC.
  for (const signer of signers.slice(0, 5)) {
    await usdc.mint(signer.address, USDC(10_000));
  }

  const keyHash = ethers.keccak256(ethers.toUtf8Bytes("local-dev-key-hash"));
  const basePrice = USDC(10);
  const priceIncrement = USDC(1);
  const roundDuration = 30 * 24 * 60 * 60;

  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lottery = await LotteryTicket.deploy(
    deployer.address,
    await coordinator.getAddress(),
    await usdc.getAddress(),
    keyHash,
    subId,
    basePrice,
    priceIncrement,
    roundDuration,
    deployer.address
  );
  await lottery.waitForDeployment();
  await coordinator.addConsumer(subId, await lottery.getAddress());

  const TicketMarket = await ethers.getContractFactory("TicketMarket");
  const market = await TicketMarket.deploy(
    deployer.address,
    await lottery.getAddress(),
    await usdc.getAddress(),
    deployer.address
  );
  await market.waitForDeployment();

  const usdcAddress = await usdc.getAddress();
  const lotteryAddress = await lottery.getAddress();
  const marketAddress = await market.getAddress();

  console.log("VRFCoordinatorV2Mock:", await coordinator.getAddress());
  console.log("Subscription ID:", subId.toString());
  console.log("MockUSDC:", usdcAddress);
  console.log("LotteryTicket:", lotteryAddress);
  console.log("TicketMarket:", marketAddress);

  const envPath = path.join(__dirname, "..", "..", "web", ".env.local");
  let env = fs.readFileSync(envPath, "utf8");
  env = env.replace(/NEXT_PUBLIC_LOTTERY_ADDRESS=.*/, `NEXT_PUBLIC_LOTTERY_ADDRESS=${lotteryAddress}`);
  env = env.replace(/NEXT_PUBLIC_MARKET_ADDRESS=.*/, `NEXT_PUBLIC_MARKET_ADDRESS=${marketAddress}`);
  env = env.replace(/NEXT_PUBLIC_CHAIN_ID=.*/, `NEXT_PUBLIC_CHAIN_ID=31337`);
  if (env.includes("NEXT_PUBLIC_USDC_ADDRESS=")) {
    env = env.replace(/NEXT_PUBLIC_USDC_ADDRESS=.*/, `NEXT_PUBLIC_USDC_ADDRESS=${usdcAddress}`);
  } else {
    env = env.trimEnd() + `\nNEXT_PUBLIC_USDC_ADDRESS=${usdcAddress}\n`;
  }
  fs.writeFileSync(envPath, env);
  console.log("Wrote addresses to web/.env.local");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
