import { ethers, network } from "hardhat";

/// Deploys the whole stack to a public testnet for beta.
///
/// Everything external is env-driven rather than hardcoded, because a wrong
/// coordinator or token address fails in confusing ways at draw time rather
/// than at deploy time.
///
///   PRIVATE_KEY            deployer (a throwaway wallet with testnet ETH)
///   ADMIN_ADDRESS          your real wallet — ownership is offered to it
///   VRF_COORDINATOR        Chainlink VRF 2.5 coordinator for this chain
///   VRF_KEY_HASH           gas lane for this chain
///   VRF_SUBSCRIPTION_ID    your funded subscription id
///   USDC_ADDRESS           real stablecoin; omit to deploy a mintable mock
///
/// Look up the coordinator, key hash and subscription at
/// https://docs.chain.link/vrf/v2-5/supported-networks — do not guess them.
///
/// Run: npx hardhat run scripts/deploy-testnet.ts --network baseSepolia

const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required — see the header of this script`);
  return value;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`network   : ${network.name}`);
  console.log(`deployer  : ${deployer.address}`);
  console.log(`balance   : ${ethers.formatEther(balance)} ETH\n`);
  if (balance === 0n) throw new Error("deployer has no ETH — fund it from a faucet first");

  const adminAddress = process.env.ADMIN_ADDRESS;
  if (adminAddress && !ethers.isAddress(adminAddress)) throw new Error("ADMIN_ADDRESS is not a valid address");

  // --- payment token ----------------------------------------------------
  let usdcAddress = process.env.USDC_ADDRESS;
  let usingMockUsdc = false;
  if (usdcAddress) {
    if (!ethers.isAddress(usdcAddress)) throw new Error("USDC_ADDRESS is not a valid address");
    console.log(`USDC      : ${usdcAddress} (existing token)`);
  } else {
    // Beta default. Testers can't realistically source testnet USDC, so a
    // mintable mock plus the in-app faucet removes that entire barrier.
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    usingMockUsdc = true;
    console.log(`USDC      : ${usdcAddress} (MOCK — mintable by anyone, testnet only)`);
  }

  // --- randomness -------------------------------------------------------
  let coordinator = process.env.VRF_COORDINATOR;
  let keyHash = process.env.VRF_KEY_HASH;
  let subscriptionId = process.env.VRF_SUBSCRIPTION_ID;
  let usingMockVrf = false;

  if (coordinator && keyHash && subscriptionId) {
    console.log(`VRF       : ${coordinator} (real Chainlink)`);
  } else {
    const Mock = await ethers.getContractFactory("MockVRFCoordinatorV2Plus");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    coordinator = await mock.getAddress();
    keyHash = ethers.keccak256(ethers.toUtf8Bytes("beta-key-hash"));
    subscriptionId = "1";
    usingMockVrf = true;
    console.log(`VRF       : ${coordinator} (MOCK — draws must be fulfilled by the operator)`);
  }

  // --- compliance -------------------------------------------------------
  // The deployer starts as the verifier so the /api/compliance/verify route can
  // attest; swap in a dedicated backend signer before inviting testers.
  const Registry = await ethers.getContractFactory("ComplianceRegistry");
  const registry = await Registry.deploy(deployer.address, deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`registry  : ${registryAddress}`);

  // --- raffle + market --------------------------------------------------
  const roundDuration = Number(process.env.ROUND_DURATION_SECONDS ?? 2 * 24 * 60 * 60);
  const basePrice = USDC(Number(process.env.BASE_PRICE_USD ?? 1));
  const priceIncrementBps = BigInt(process.env.PRICE_INCREMENT_BPS ?? 200); // 2%

  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lottery = await LotteryTicket.deploy(
    coordinator,
    usdcAddress,
    registryAddress,
    keyHash,
    subscriptionId,
    basePrice,
    priceIncrementBps,
    roundDuration,
    deployer.address // fee recipient; change via setFeeRecipient once live
  );
  await lottery.waitForDeployment();
  const lotteryAddress = await lottery.getAddress();
  console.log(`lottery   : ${lotteryAddress}`);

  const TicketMarket = await ethers.getContractFactory("TicketMarket");
  const market = await TicketMarket.deploy(
    deployer.address,
    lotteryAddress,
    usdcAddress,
    registryAddress,
    deployer.address
  );
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log(`market    : ${marketAddress}`);

  // --- hand ownership to the admin wallet -------------------------------
  // Two-step throughout: this only *offers* ownership. The admin accepts from
  // their own wallet, which proves they can actually sign with it before the
  // deployer key stops being able to help.
  if (adminAddress) {
    await (await lottery.transferOwnership(adminAddress)).wait();
    await (await market.transferOwnership(adminAddress)).wait();
    await (await registry.transferOwnership(adminAddress)).wait();
    console.log(`\nownership offered to ${adminAddress}`);
    console.log("  -> accept it from that wallet: npx hardhat run scripts/accept-ownership.ts --network " + network.name);
  } else {
    console.log("\nADMIN_ADDRESS not set — the deployer remains owner.");
  }

  // --- what to paste into Vercel ---------------------------------------
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log("\n--- environment variables for Vercel ---");
  console.log(`NEXT_PUBLIC_CHAIN_ID=${chainId}`);
  console.log(`NEXT_PUBLIC_LOTTERY_ADDRESS=${lotteryAddress}`);
  console.log(`NEXT_PUBLIC_MARKET_ADDRESS=${marketAddress}`);
  console.log(`NEXT_PUBLIC_COMPLIANCE_ADDRESS=${registryAddress}`);
  console.log(`NEXT_PUBLIC_USDC_ADDRESS=${usdcAddress}`);
  console.log(`NEXT_PUBLIC_FAUCET_ENABLED=${usingMockUsdc}`);
  console.log(`NEXT_PUBLIC_DEV_WALLETS=false`);
  console.log("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=   # from cloud.reown.com");
  console.log("COMPLIANCE_VERIFIER_KEY=                # the deployer key, or a dedicated signer");
  console.log("----------------------------------------");

  if (usingMockVrf || usingMockUsdc) {
    console.log("\nBETA CAVEATS — tell your testers:");
    if (usingMockVrf) console.log("  * Draws are operator-triggered, not Chainlink-verified randomness.");
    if (usingMockUsdc) console.log("  * The dollar token is fake and mintable by anyone. It has no value.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
