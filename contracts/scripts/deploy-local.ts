import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));

async function main() {
  const signers = await ethers.getSigners();
  const [deployer] = signers;

  const Coordinator = await ethers.getContractFactory("MockVRFCoordinatorV2Plus");
  const coordinator = await Coordinator.deploy();
  await coordinator.waitForDeployment();
  // The mock ignores subscriptions; any non-zero id works locally.
  const subId = 1n;

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  // Seed the first few dev accounts with plenty of test USDC.
  for (const signer of signers.slice(0, 5)) {
    await usdc.mint(signer.address, USDC(10_000));
  }

  // Compliance registry. The deployer is both owner and the initial verifier,
  // which stands in for the backend signer that attests to completed KYC.
  const Registry = await ethers.getContractFactory("ComplianceRegistry");
  const registry = await Registry.deploy(deployer.address, deployer.address);
  await registry.waitForDeployment();

  // Pre-verify the dev accounts so local browsing isn't blocked by the gate.
  // Player 3 is deliberately left unverified so the blocked-user UX is visible.
  const US = ethers.hexlify(ethers.toUtf8Bytes("US"));
  for (const signer of signers.slice(0, 3)) {
    await registry.setVerification(signer.address, US, 0, ethers.ZeroHash);
  }

  const keyHash = ethers.keccak256(ethers.toUtf8Bytes("local-dev-key-hash"));
  const basePrice = USDC(1);        // $1 opening ticket
  const priceIncrementBps = 200n;   // +2% per sale, compounding
  const roundDuration = 30 * 24 * 60 * 60;

  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lottery = await LotteryTicket.deploy(
    await coordinator.getAddress(),
    await usdc.getAddress(),
    await registry.getAddress(),
    keyHash,
    subId,
    basePrice,
    priceIncrementBps,
    roundDuration,
    deployer.address
  );
  await lottery.waitForDeployment();

  const TicketMarket = await ethers.getContractFactory("TicketMarket");
  const market = await TicketMarket.deploy(
    deployer.address,
    await lottery.getAddress(),
    await usdc.getAddress(),
    await registry.getAddress(),
    deployer.address
  );
  await market.waitForDeployment();

  const registryAddress = await registry.getAddress();
  const usdcAddress = await usdc.getAddress();
  const lotteryAddress = await lottery.getAddress();
  const marketAddress = await market.getAddress();

  console.log("MockVRFCoordinatorV2Plus:", await coordinator.getAddress());
  console.log("Subscription ID:", subId.toString());
  console.log("MockUSDC:", usdcAddress);
  console.log("ComplianceRegistry:", registryAddress);
  console.log("LotteryTicket:", lotteryAddress);
  console.log("TicketMarket:", marketAddress);

  const envPath = path.join(__dirname, "..", "..", "web", ".env.local");
  let env = fs.readFileSync(envPath, "utf8");
  env = env.replace(/NEXT_PUBLIC_LOTTERY_ADDRESS=.*/, `NEXT_PUBLIC_LOTTERY_ADDRESS=${lotteryAddress}`);
  env = env.replace(/NEXT_PUBLIC_MARKET_ADDRESS=.*/, `NEXT_PUBLIC_MARKET_ADDRESS=${marketAddress}`);
  env = env.replace(/NEXT_PUBLIC_CHAIN_ID=.*/, `NEXT_PUBLIC_CHAIN_ID=31337`);
  const upsert = (key: string, value: string) => {
    const pattern = new RegExp(`${key}=.*`);
    env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
  };
  upsert("NEXT_PUBLIC_USDC_ADDRESS", usdcAddress);
  upsert("NEXT_PUBLIC_COMPLIANCE_ADDRESS", registryAddress);
  // Local-only: the verifier key the /api/compliance/verify route signs with.
  // Hardhat account #0's well-known test key — never use a funded key here.
  upsert("COMPLIANCE_VERIFIER_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  fs.writeFileSync(envPath, env);
  console.log("Wrote addresses to web/.env.local");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
