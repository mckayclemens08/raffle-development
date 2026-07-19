import { ethers } from "hardhat";

export const BASE_FEE = 100_000_000_000_000_00n; // 0.1 LINK
export const GAS_PRICE_LINK = 1_000_000_000n; // 1 gwei
export const KEY_HASH = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));

// USDC uses 6 decimals: $10 base price, $0.50 increment per ticket sold.
export const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
export const BASE_PRICE = USDC(10);
export const PRICE_INCREMENT = USDC(0.5);
export const ROUND_DURATION = 30 * 24 * 60 * 60; // 30 days

export async function deployVrfCoordinator() {
  const Coordinator = await ethers.getContractFactory("VRFCoordinatorV2Mock");
  const coordinator = await Coordinator.deploy(BASE_FEE, GAS_PRICE_LINK);
  await coordinator.waitForDeployment();
  return coordinator;
}

export async function createFundedSubscription(coordinator: any) {
  const tx = await coordinator.createSubscription();
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((log: any) => {
      try {
        return coordinator.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed && parsed.name === "SubscriptionCreated");
  const subId = event.args.subId;
  await coordinator.fundSubscription(subId, ethers.parseEther("100"));
  return subId;
}

export async function deployUsdc() {
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  return usdc;
}

export async function deployLottery(deployerAddress: string, feeRecipient: string) {
  const coordinator = await deployVrfCoordinator();
  const subId = await createFundedSubscription(coordinator);
  const usdc = await deployUsdc();

  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lottery = await LotteryTicket.deploy(
    deployerAddress,
    await coordinator.getAddress(),
    await usdc.getAddress(),
    KEY_HASH,
    subId,
    BASE_PRICE,
    PRICE_INCREMENT,
    ROUND_DURATION,
    feeRecipient
  );
  await lottery.waitForDeployment();

  await coordinator.addConsumer(subId, await lottery.getAddress());

  return { coordinator, subId, usdc, lottery };
}

/// Mints USDC to a signer and approves the spender for that amount.
export async function fundAndApprove(usdc: any, signer: any, spender: string, amount: bigint) {
  await usdc.mint(signer.address, amount);
  await usdc.connect(signer).approve(spender, amount);
}
