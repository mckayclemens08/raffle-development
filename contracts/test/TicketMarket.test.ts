import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployLottery, fundAndApprove, BASE_PRICE, USDC } from "./helpers";

describe("TicketMarket", () => {
  async function setup() {
    const [deployer, feeRecipient, seller, buyer] = await ethers.getSigners();
    const { usdc, registry, lottery } = await deployLottery(deployer.address, feeRecipient.address);

    const TicketMarket = await ethers.getContractFactory("TicketMarket");
    const market = await TicketMarket.deploy(
      deployer.address,
      await lottery.getAddress(),
      await usdc.getAddress(),
      await registry.getAddress(),
      feeRecipient.address
    );
    await market.waitForDeployment();

    await fundAndApprove(usdc, seller, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(seller).buyTicket(BASE_PRICE);
    const ticketId = 1n;

    return { deployer, feeRecipient, seller, buyer, usdc, registry, lottery, market, ticketId };
  }

  it("rejects listing by a non-owner", async () => {
    const { market, buyer, ticketId } = await setup();
    await expect(market.connect(buyer).listTicket(ticketId, USDC(20))).to.be.revertedWith("not ticket owner");
  });

  it("rejects listing without market approval", async () => {
    const { market, seller, ticketId } = await setup();
    await expect(market.connect(seller).listTicket(ticketId, USDC(20))).to.be.revertedWith("market not approved");
  });

  it("lists, sells, and splits proceeds 2% platform / 1% pool / 97% seller", async () => {
    const { market, lottery, usdc, feeRecipient, seller, buyer, ticketId } = await setup();

    const price = USDC(20);
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    const listing = await market.listings(ticketId);
    expect(listing.active).to.equal(true);
    expect(listing.price).to.equal(price);

    await fundAndApprove(usdc, buyer, await market.getAddress(), price);

    const feeRecipientBefore = await usdc.balanceOf(feeRecipient.address);
    const sellerBefore = await usdc.balanceOf(seller.address);
    const roundId = await lottery.currentRound();
    const poolBefore = (await lottery.rounds(roundId)).pool;
    const lotteryBalanceBefore = await usdc.balanceOf(await lottery.getAddress());

    await market.connect(buyer).buyTicket(ticketId);

    expect(await lottery.ownerOf(ticketId)).to.equal(buyer.address);

    const expectedPlatformFee = (price * 200n) / 10_000n;
    const expectedPoolFee = (price * 100n) / 10_000n;
    const expectedSellerProceeds = price - expectedPlatformFee - expectedPoolFee;

    // The platform fee accrues rather than being pushed, so it lands on the
    // recipient only once withdrawn.
    expect(await market.accruedFees()).to.equal(expectedPlatformFee);
    await market.withdrawFees();
    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedPlatformFee);
    expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + expectedSellerProceeds);
    expect(await usdc.balanceOf(buyer.address)).to.equal(0n);
    // 1% of the sale landed in the raffle's prize pool (accounting + escrow)
    expect((await lottery.rounds(roundId)).pool).to.equal(poolBefore + expectedPoolFee);
    expect(await usdc.balanceOf(await lottery.getAddress())).to.equal(lotteryBalanceBefore + expectedPoolFee);
    expect((await market.listings(ticketId)).active).to.equal(false);
  });

  it("sends the pool share to the platform when the current round is already settled", async () => {
    const { market, lottery, usdc, feeRecipient, seller, buyer, ticketId } = await setup();

    // Settle round 1: close it, draw (seller's ticket wins), and claim.
    await time.increase(30 * 24 * 60 * 60 + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    const coordinatorAddress = await lottery.s_vrfCoordinator();
    const coordinator = await ethers.getContractAt("MockVRFCoordinatorV2Plus", coordinatorAddress);
    await coordinator.fulfillRandomWordsWithOverride(requestId, await lottery.getAddress(), [0n]);
    await lottery.connect(seller).claimPrize(1);
    await lottery.withdrawFees();

    // Trade the (now settled) ticket: pool share must fall through to the
    // platform rather than being stranded in the paid round.
    const price = USDC(20);
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);
    await fundAndApprove(usdc, buyer, await market.getAddress(), price);

    const feeRecipientBefore = await usdc.balanceOf(feeRecipient.address);
    const lotteryBalanceBefore = await usdc.balanceOf(await lottery.getAddress());

    await market.connect(buyer).buyTicket(ticketId);

    const expectedPlatformFee = (price * 200n) / 10_000n;
    const expectedPoolFee = (price * 100n) / 10_000n;

    // Market fee accrues on the market; the pool share falls through to the
    // raffle's own fee balance because round 1 is already drawn.
    await market.withdrawFees();
    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedPlatformFee);
    expect(await lottery.accruedFees()).to.equal(expectedPoolFee);
    expect(await usdc.balanceOf(await lottery.getAddress())).to.equal(lotteryBalanceBefore + expectedPoolFee);
  });

  it("rejects buying without sufficient USDC allowance", async () => {
    const { market, lottery, usdc, seller, buyer, ticketId } = await setup();
    const price = USDC(20);
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    await usdc.mint(buyer.address, price);
    // no approve
    await expect(market.connect(buyer).buyTicket(ticketId)).to.be.reverted;
  });

  it("allows the seller to cancel a listing", async () => {
    const { market, lottery, usdc, seller, buyer, ticketId } = await setup();
    const price = USDC(20);
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    await market.connect(seller).cancelListing(ticketId);
    expect((await market.listings(ticketId)).active).to.equal(false);

    await fundAndApprove(usdc, buyer, await market.getAddress(), price);
    await expect(market.connect(buyer).buyTicket(ticketId)).to.be.revertedWith("not listed");
  });

  it("rejects cancellation by a non-seller", async () => {
    const { market, lottery, seller, buyer, ticketId } = await setup();
    const price = USDC(20);
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    await expect(market.connect(buyer).cancelListing(ticketId)).to.be.revertedWith("not seller");
  });
});
