import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployLottery, BASE_PRICE, PRICE_INCREMENT, ROUND_DURATION } from "./helpers";

describe("LotteryTicket", () => {
  async function setup() {
    const [deployer, feeRecipient, alice, bob, carol] = await ethers.getSigners();
    const { coordinator, lottery } = await deployLottery(deployer.address, feeRecipient.address);
    return { deployer, feeRecipient, alice, bob, carol, coordinator, lottery };
  }

  it("starts round 1 at the base price", async () => {
    const { lottery } = await setup();
    expect(await lottery.currentRound()).to.equal(1n);
    expect(await lottery.getCurrentPrice(1)).to.equal(BASE_PRICE);
  });

  it("raises the price for each ticket sold in the round", async () => {
    const { lottery, alice, bob } = await setup();
    await lottery.connect(alice).buyTicket({ value: BASE_PRICE });
    expect(await lottery.getCurrentPrice(1)).to.equal(BASE_PRICE + PRICE_INCREMENT);

    await lottery.connect(bob).buyTicket({ value: BASE_PRICE + PRICE_INCREMENT });
    expect(await lottery.getCurrentPrice(1)).to.equal(BASE_PRICE + PRICE_INCREMENT * 2n);
  });

  it("rejects a ticket purchase with the wrong payment", async () => {
    const { lottery, alice } = await setup();
    await expect(lottery.connect(alice).buyTicket({ value: BASE_PRICE - 1n })).to.be.revertedWith(
      "incorrect payment"
    );
  });

  it("rejects purchases after the round closes", async () => {
    const { lottery, alice } = await setup();
    await time.increase(ROUND_DURATION + 1);
    await expect(lottery.connect(alice).buyTicket({ value: BASE_PRICE })).to.be.revertedWith("round closed");
  });

  it("rejects requestDraw before the round ends or with no tickets sold", async () => {
    const { lottery, alice } = await setup();
    await expect(lottery.requestDraw()).to.be.revertedWith("round still open");

    await lottery.connect(alice).buyTicket({ value: BASE_PRICE });
    await expect(lottery.requestDraw()).to.be.revertedWith("round still open");
  });

  it("runs a full draw and pays the winner minus the 5% platform fee", async () => {
    const { lottery, coordinator, feeRecipient, alice, bob, carol } = await setup();

    // 3 tickets sold at increasing prices
    await lottery.connect(alice).buyTicket({ value: BASE_PRICE });
    await lottery.connect(bob).buyTicket({ value: BASE_PRICE + PRICE_INCREMENT });
    await lottery.connect(carol).buyTicket({ value: BASE_PRICE + PRICE_INCREMENT * 2n });

    const pool = BASE_PRICE * 3n + PRICE_INCREMENT * 3n;
    const round = await lottery.rounds(1);
    expect(round.pool).to.equal(pool);

    await time.increase(ROUND_DURATION + 1);

    const drawTx = await lottery.requestDraw();
    const drawReceipt = await drawTx.wait();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    expect(requestId).to.not.equal(0n);

    // ticket ids are 1 (alice), 2 (bob), 3 (carol); force randomWord % 3 === 1 -> bob wins
    const randomWord = 1n;
    await coordinator.fulfillRandomWordsWithOverride(requestId, await lottery.getAddress(), [randomWord]);

    const settledRound = await lottery.rounds(1);
    expect(settledRound.drawn).to.equal(true);
    expect(settledRound.winnerTicketId).to.equal(2n); // firstTicketId(1) + index(1)
    expect(await lottery.ownerOf(settledRound.winnerTicketId)).to.equal(bob.address);

    const feeRecipientBefore = await ethers.provider.getBalance(feeRecipient.address);
    const bobBefore = await ethers.provider.getBalance(bob.address);

    const claimTx = await lottery.connect(bob).claimPrize(1);
    const claimReceipt = await claimTx.wait();
    const gasCost = claimReceipt!.gasUsed * claimReceipt!.gasPrice;

    const expectedFee = (pool * 500n) / 10_000n;
    const expectedPayout = pool - expectedFee;

    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);
    expect(await ethers.provider.getBalance(bob.address)).to.equal(bobBefore + expectedPayout - gasCost);

    await expect(lottery.connect(bob).claimPrize(1)).to.be.revertedWith("already paid");
  });

  it("rejects claimPrize from a non-winner", async () => {
    const { lottery, coordinator, alice, bob } = await setup();

    await lottery.connect(alice).buyTicket({ value: BASE_PRICE });
    await time.increase(ROUND_DURATION + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, await lottery.getAddress(), [0n]);

    await expect(lottery.connect(bob).claimPrize(1)).to.be.revertedWith("not the winning ticket holder");
  });

  it("only allows startNewRound after the previous round is settled", async () => {
    const { lottery, coordinator, alice } = await setup();

    await lottery.connect(alice).buyTicket({ value: BASE_PRICE });
    await expect(lottery.startNewRound()).to.be.revertedWith("previous round unsettled");

    await time.increase(ROUND_DURATION + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, await lottery.getAddress(), [0n]);
    await lottery.connect(alice).claimPrize(1);

    await lottery.startNewRound();
    expect(await lottery.currentRound()).to.equal(2n);
    expect(await lottery.getCurrentPrice(2)).to.equal(BASE_PRICE);
  });
});
