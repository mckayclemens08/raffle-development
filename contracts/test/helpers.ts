import { ethers } from "hardhat";

export const BASE_FEE = 100_000_000_000_000_00n; // 0.1 LINK
export const GAS_PRICE_LINK = 1_000_000_000n; // 1 gwei
export const KEY_HASH = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));

// USDC uses 6 decimals. $1 opening price, rising 2% per ticket sold.
export const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
export const BASE_PRICE = USDC(1);
export const PRICE_INCREMENT_BPS = 200n; // 2%

/// The contract's own stepping, mirrored so tests assert against the intended
/// maths rather than against a copy of the implementation's rounding.
export const stepPrice = (price: bigint) => price + (price * PRICE_INCREMENT_BPS) / 10_000n;

/// Price of the (n+1)-th ticket in a round, i.e. after n sales.
export function priceAfter(sales: number): bigint {
  let price = BASE_PRICE;
  for (let i = 0; i < sales; i++) price = stepPrice(price);
  return price;
}
export const ROUND_DURATION = 30 * 24 * 60 * 60; // 30 days

export async function deployVrfCoordinator() {
  const Coordinator = await ethers.getContractFactory("MockVRFCoordinatorV2Plus");
  const coordinator = await Coordinator.deploy();
  await coordinator.waitForDeployment();
  return coordinator;
}

/// VRF 2.5 subscription ids are uint256; the mock doesn't track subscriptions,
/// so any non-zero id is fine for tests.
export const SUB_ID = 1n;

export async function deployUsdc() {
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  return usdc;
}

/// ISO 3166-1 alpha-2 country code as the bytes2 the registry stores.
export const country = (code: string) => ethers.hexlify(ethers.toUtf8Bytes(code)) as `0x${string}`;
export const US = country("US");

export async function deployComplianceRegistry(ownerAddress: string, verifierAddress: string) {
  const Registry = await ethers.getContractFactory("ComplianceRegistry");
  const registry = await Registry.deploy(ownerAddress, verifierAddress);
  await registry.waitForDeployment();
  return registry;
}

export async function deployLottery(deployerAddress: string, feeRecipient: string) {
  const coordinator = await deployVrfCoordinator();
  const usdc = await deployUsdc();
  // The deployer doubles as the KYC verifier in tests.
  const registry = await deployComplianceRegistry(deployerAddress, deployerAddress);

  // Pre-verify the signers the tests actually use, so the compliance gate is
  // transparent to tests that aren't specifically about compliance. Kept to a
  // handful rather than all 20 accounts — each one is a transaction.
  const signers = (await ethers.getSigners()).slice(0, 6);
  for (const signer of signers) {
    await registry.setVerification(signer.address, US, 0, ethers.ZeroHash);
  }

  // Ownership comes from Chainlink's ConfirmedOwner (two-step), so the deployer
  // is owner on construction rather than an address passed to the constructor.
  const LotteryTicket = await ethers.getContractFactory("LotteryTicket");
  const lottery = await LotteryTicket.deploy(
    await coordinator.getAddress(),
    await usdc.getAddress(),
    await registry.getAddress(),
    KEY_HASH,
    SUB_ID,
    BASE_PRICE,
    PRICE_INCREMENT_BPS,
    ROUND_DURATION,
    feeRecipient
  );
  await lottery.waitForDeployment();

  return { coordinator, subId: SUB_ID, usdc, registry, lottery };
}

/// Closes the current round and drives it through a VRF fulfilment, returning
/// the winning ticket id. `randomWord` picks the winner deterministically.
export async function drawRound(lottery: any, coordinator: any, randomWord: bigint = 0n) {
  await lottery.requestDraw();
  const roundId = await lottery.currentRound();
  const requestId = (await lottery.rounds(roundId)).vrfRequestId;
  await coordinator.fulfillRandomWordsWithOverride(requestId, await lottery.getAddress(), [randomWord]);
  return (await lottery.rounds(roundId)).winnerTicketId;
}

/// Mints USDC to a signer and approves the spender for that amount.
export async function fundAndApprove(usdc: any, signer: any, spender: string, amount: bigint) {
  await usdc.mint(signer.address, amount);
  await usdc.connect(signer).approve(spender, amount);
}
