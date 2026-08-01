import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLottery,
  deployUsdc,
  drawRound,
  fundAndApprove,
  BASE_PRICE,
  PRICE_INCREMENT,
  ROUND_DURATION,
  USDC,
} from "./helpers";

describe("LotteryTicket", () => {
  async function setup() {
    const [deployer, feeRecipient, alice, bob, carol] = await ethers.getSigners();
    const { coordinator, usdc, lottery } = await deployLottery(deployer.address, feeRecipient.address);
    return { deployer, feeRecipient, alice, bob, carol, coordinator, usdc, lottery };
  }

  it("starts round 1 at the base price", async () => {
    const { lottery } = await setup();
    expect(await lottery.currentRound()).to.equal(1n);
    expect(await lottery.getCurrentPrice(1)).to.equal(BASE_PRICE);
  });

  it("raises the price for each ticket sold in the round", async () => {
    const { lottery, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    expect(await lottery.getCurrentPrice(1)).to.equal(BASE_PRICE + PRICE_INCREMENT);

    await fundAndApprove(usdc, bob, lotteryAddress, BASE_PRICE + PRICE_INCREMENT);
    await lottery.connect(bob).buyTicket(BASE_PRICE + PRICE_INCREMENT);
    expect(await lottery.getCurrentPrice(1)).to.equal(BASE_PRICE + PRICE_INCREMENT * 2n);
  });

  it("rejects a purchase when the price has risen above maxPrice", async () => {
    const { lottery, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);

    // Bob quotes the old price, but it has moved up by one increment.
    await fundAndApprove(usdc, bob, lotteryAddress, BASE_PRICE);
    await expect(lottery.connect(bob).buyTicket(BASE_PRICE)).to.be.revertedWith("price exceeds maxPrice");
  });

  it("rejects a purchase without sufficient USDC allowance", async () => {
    const { lottery, usdc, alice } = await setup();
    await usdc.mint(alice.address, BASE_PRICE);
    // no approve
    await expect(lottery.connect(alice).buyTicket(BASE_PRICE)).to.be.reverted;
  });

  it("rejects purchases after the round closes", async () => {
    const { lottery, usdc, alice } = await setup();
    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);
    await expect(lottery.connect(alice).buyTicket(BASE_PRICE)).to.be.revertedWith("round closed");
  });

  it("rejects requestDraw before the round ends or with no tickets sold", async () => {
    const { lottery, usdc, alice } = await setup();
    await expect(lottery.requestDraw()).to.be.revertedWith("round still open");

    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await expect(lottery.requestDraw()).to.be.revertedWith("round still open");
  });

  it("runs a full draw and pays the winner minus the 5% platform fee", async () => {
    const { lottery, coordinator, usdc, feeRecipient, alice, bob, carol } = await setup();
    const lotteryAddress = await lottery.getAddress();

    // 3 tickets sold at increasing prices
    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await fundAndApprove(usdc, bob, lotteryAddress, BASE_PRICE + PRICE_INCREMENT);
    await lottery.connect(bob).buyTicket(BASE_PRICE + PRICE_INCREMENT);
    await fundAndApprove(usdc, carol, lotteryAddress, BASE_PRICE + PRICE_INCREMENT * 2n);
    await lottery.connect(carol).buyTicket(BASE_PRICE + PRICE_INCREMENT * 2n);

    const pool = BASE_PRICE * 3n + PRICE_INCREMENT * 3n;
    const round = await lottery.rounds(1);
    expect(round.pool).to.equal(pool);
    expect(await usdc.balanceOf(lotteryAddress)).to.equal(pool);

    await time.increase(ROUND_DURATION + 1);

    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    expect(requestId).to.not.equal(0n);

    // ticket ids are 1 (alice), 2 (bob), 3 (carol); force randomWord % 3 === 1 -> bob wins
    await coordinator.fulfillRandomWordsWithOverride(requestId, lotteryAddress, [1n]);

    const settledRound = await lottery.rounds(1);
    expect(settledRound.drawn).to.equal(true);
    expect(settledRound.winnerTicketId).to.equal(2n); // firstTicketId(1) + index(1)
    expect(await lottery.ownerOf(settledRound.winnerTicketId)).to.equal(bob.address);

    const feeRecipientBefore = await usdc.balanceOf(feeRecipient.address);
    const bobBefore = await usdc.balanceOf(bob.address);

    await lottery.connect(bob).claimPrize(1);

    const expectedFee = (pool * 500n) / 10_000n;
    const expectedPayout = pool - expectedFee;

    // The winner is paid immediately; the platform fee accrues so a fee
    // recipient that can't receive never blocks the payout.
    expect(await usdc.balanceOf(bob.address)).to.equal(bobBefore + expectedPayout);
    expect(await lottery.accruedFees()).to.equal(expectedFee);
    expect(await usdc.balanceOf(lotteryAddress)).to.equal(expectedFee);

    await lottery.withdrawFees();
    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);
    expect(await usdc.balanceOf(lotteryAddress)).to.equal(0n);

    await expect(lottery.connect(bob).claimPrize(1)).to.be.revertedWith("already paid");
  });

  it("rejects claimPrize from a non-winner", async () => {
    const { lottery, coordinator, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, lotteryAddress, [0n]);

    await expect(lottery.connect(bob).claimPrize(1)).to.be.revertedWith("not the winning ticket holder");
  });

  it("only allows startNewRound once the previous round is drawn", async () => {
    const { lottery, coordinator, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await expect(lottery.startNewRound()).to.be.revertedWith("previous round not drawn");

    await time.increase(ROUND_DURATION + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, lotteryAddress, [0n]);

    await lottery.startNewRound();
    expect(await lottery.currentRound()).to.equal(2n);
    expect(await lottery.getCurrentPrice(2)).to.equal(BASE_PRICE);
  });

  // --- hardening: the two defects that previously halted the platform ---

  it("advances rounds even when the winner never claims, and pays them later", async () => {
    const { lottery, coordinator, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);
    await drawRound(lottery, coordinator, 0n);

    // Alice never claims. The platform must keep running regardless.
    await lottery.startNewRound();
    await fundAndApprove(usdc, bob, lotteryAddress, BASE_PRICE);
    await lottery.connect(bob).buyTicket(BASE_PRICE);
    expect((await lottery.rounds(2)).ticketsSold).to.equal(1n);

    // ...and her prize is still there for the whole claim window.
    const before = await usdc.balanceOf(alice.address);
    await lottery.connect(alice).claimPrize(1);
    expect(await usdc.balanceOf(alice.address)).to.be.greaterThan(before);
  });

  it("sweeps an unclaimed prize only after the claim window closes", async () => {
    const { lottery, coordinator, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);
    await drawRound(lottery, coordinator, 0n);

    await expect(lottery.sweepUnclaimed(1)).to.be.revertedWith("claim window still open");

    await time.increase(90 * 24 * 60 * 60 + 1);
    await lottery.sweepUnclaimed(1);

    expect(await lottery.accruedFees()).to.equal(BASE_PRICE);
    await expect(lottery.connect(alice).claimPrize(1)).to.be.revertedWith("claim window closed");
  });

  it("retries a draw whose VRF callback never arrives", async () => {
    const { lottery, coordinator, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);

    await lottery.requestDraw();
    const firstRequestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.dropRequest(firstRequestId); // coordinator goes silent

    await expect(lottery.requestDraw()).to.be.revertedWith("draw pending, retry later");

    await time.increase(3601); // past drawRetryTimeout
    await lottery.requestDraw();
    const retryRequestId = (await lottery.rounds(1)).vrfRequestId;
    expect(retryRequestId).to.not.equal(firstRequestId);

    await coordinator.fulfillRandomWordsWithOverride(retryRequestId, lotteryAddress, [0n]);
    expect((await lottery.rounds(1)).drawn).to.equal(true);
  });

  it("ignores a late fulfilment of a superseded request instead of reverting", async () => {
    const { lottery, coordinator, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);

    await lottery.requestDraw();
    const firstRequestId = (await lottery.rounds(1)).vrfRequestId;
    await time.increase(3601);
    await lottery.requestDraw();
    const retryRequestId = (await lottery.rounds(1)).vrfRequestId;

    await coordinator.fulfillRandomWordsWithOverride(retryRequestId, lotteryAddress, [0n]);
    const winnerAfterFirstFulfil = (await lottery.rounds(1)).winnerTicketId;

    // The original request lands late. It must not revert (that would burn the
    // subscription's gas) and must not overwrite the settled result.
    await coordinator.fulfillRandomWordsWithOverride(firstRequestId, lotteryAddress, [99n]);
    expect((await lottery.rounds(1)).winnerTicketId).to.equal(winnerAfterFirstFulfil);
  });

  it("pauses ticket sales but never blocks a claim", async () => {
    const { lottery, coordinator, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);

    await lottery.pause();
    await fundAndApprove(usdc, bob, lotteryAddress, BASE_PRICE * 2n);
    await expect(lottery.connect(bob).buyTicket(BASE_PRICE * 2n)).to.be.revertedWithCustomError(
      lottery,
      "EnforcedPause"
    );

    // Exit paths stay open while paused.
    await time.increase(ROUND_DURATION + 1);
    await drawRound(lottery, coordinator, 0n);
    const before = await usdc.balanceOf(alice.address);
    await lottery.connect(alice).claimPrize(1);
    expect(await usdc.balanceOf(alice.address)).to.be.greaterThan(before);

    await lottery.unpause();
    expect(await lottery.paused()).to.equal(false);
  });

  it("requires two steps to hand over ownership", async () => {
    const { lottery, deployer, bob } = await setup();
    expect(await lottery.owner()).to.equal(deployer.address);

    await lottery.transferOwnership(bob.address);
    // Still the old owner until the new one accepts — a mistyped address
    // can't strand the contract.
    expect(await lottery.owner()).to.equal(deployer.address);

    await lottery.connect(bob).acceptOwnership();
    expect(await lottery.owner()).to.equal(bob.address);
  });

  // --- settlement token can be replaced without redeploying ---

  it("refuses to switch payment token while funds are escrowed", async () => {
    const { lottery, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();
    const other = await deployUsdc();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);

    await expect(lottery.setPaymentToken(await other.getAddress())).to.be.revertedWith(
      "settle balances first"
    );
  });

  it("switches payment token once every balance is settled", async () => {
    const { lottery, coordinator, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();
    const other = await deployUsdc();

    // Run a full round, pay the winner, withdraw the fee.
    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);
    await drawRound(lottery, coordinator, 0n);
    await lottery.connect(alice).claimPrize(1);
    await lottery.withdrawFees();
    expect(await usdc.balanceOf(lotteryAddress)).to.equal(0n);

    await lottery.setPaymentToken(await other.getAddress());
    expect(await lottery.paymentToken()).to.equal(await other.getAddress());

    // The new token is genuinely in use for the next round.
    await lottery.startNewRound();
    await fundAndApprove(other, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    expect(await other.balanceOf(lotteryAddress)).to.equal(BASE_PRICE);
  });

  it("cannot be blocked from migrating by dusting the contract", async () => {
    const { lottery, coordinator, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();
    const other = await deployUsdc();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(ROUND_DURATION + 1);
    await drawRound(lottery, coordinator, 0n);
    await lottery.connect(alice).claimPrize(1);
    await lottery.withdrawFees();

    // Anyone can push tokens at the contract. If the guard read `balanceOf`,
    // one unit of dust would block the migration permanently.
    await usdc.mint(bob.address, 1n);
    await usdc.connect(bob).transfer(lotteryAddress, 1n);
    expect(await usdc.balanceOf(lotteryAddress)).to.equal(1n);

    await lottery.setPaymentToken(await other.getAddress());
    expect(await lottery.paymentToken()).to.equal(await other.getAddress());
  });

  it("tracks what it owes independently of its raw balance", async () => {
    const { lottery, usdc, alice, bob } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    expect(await lottery.totalEscrowed()).to.equal(BASE_PRICE);

    // Dust inflates the balance but not the obligation.
    await usdc.mint(bob.address, 5n);
    await usdc.connect(bob).transfer(lotteryAddress, 5n);
    expect(await usdc.balanceOf(lotteryAddress)).to.equal(BASE_PRICE + 5n);
    expect(await lottery.totalEscrowed()).to.equal(BASE_PRICE);
  });

  it("rejects a zero or unchanged payment token", async () => {
    const { lottery, usdc } = await setup();
    await expect(lottery.setPaymentToken(ethers.ZeroAddress)).to.be.revertedWith("zero payment token");
    await expect(lottery.setPaymentToken(await usdc.getAddress())).to.be.revertedWith(
      "same payment token"
    );
  });

  it("restricts owner-only controls", async () => {
    const { lottery, bob } = await setup();
    await expect(lottery.connect(bob).pause()).to.be.reverted;
    await expect(lottery.connect(bob).startNewRound()).to.be.reverted;
    await expect(lottery.connect(bob).setPricing(1n, 1n)).to.be.reverted;
    await expect(lottery.connect(bob).setClaimWindow(30 * 24 * 60 * 60)).to.be.reverted;
  });
});
