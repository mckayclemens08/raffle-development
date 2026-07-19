import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLottery,
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

    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);
    expect(await usdc.balanceOf(bob.address)).to.equal(bobBefore + expectedPayout);
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

  it("only allows startNewRound after the previous round is settled", async () => {
    const { lottery, coordinator, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();

    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await expect(lottery.startNewRound()).to.be.revertedWith("previous round unsettled");

    await time.increase(ROUND_DURATION + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, lotteryAddress, [0n]);
    await lottery.connect(alice).claimPrize(1);

    await lottery.startNewRound();
    expect(await lottery.currentRound()).to.equal(2n);
    expect(await lottery.getCurrentPrice(2)).to.equal(BASE_PRICE);
  });
});
