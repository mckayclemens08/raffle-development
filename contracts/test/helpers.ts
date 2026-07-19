import { ethers } from "hardhat";

export const BASE_FEE = 100_000_000_000_000_00n; // 0.1 LINK
export const GAS_PRICE_LINK = 1_000_000_000n; // 1 gwei
export const KEY_HASH = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));

export const BASE_PRICE = ethers.parseEther("0.01");
export const PRICE_INCREMENT = ethers.parseEther("0.001");
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

export async function deployLottery(deployerAddress: string, feeRecipient: string) {
  const coordinator = await deployVrfCoordinator();
  const subId = await createFundedSubscription(coordinator);

  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lottery = await LotteryTicket.deploy(
    deployerAddress,
    await coordinator.getAddress(),
    KEY_HASH,
    subId,
    BASE_PRICE,
    PRICE_INCREMENT,
    ROUND_DURATION,
    feeRecipient
  );
  await lottery.waitForDeployment();

  await coordinator.addConsumer(subId, await lottery.getAddress());

  return { coordinator, subId, lottery };
}
