import { expect } from "chai";
import { ethers } from "hardhat";
import { deployLottery, fundAndApprove, BASE_PRICE, USDC } from "./helpers";

describe("TicketMarket", () => {
  async function setup() {
    const [deployer, feeRecipient, seller, buyer] = await ethers.getSigners();
    const { usdc, lottery } = await deployLottery(deployer.address, feeRecipient.address);

    const TicketMarket = await ethers.getContractFactory("TicketMarket");
    const market = await TicketMarket.deploy(
      deployer.address,
      await lottery.getAddress(),
      await usdc.getAddress(),
      feeRecipient.address
    );
    await market.waitForDeployment();

    await fundAndApprove(usdc, seller, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(seller).buyTicket(BASE_PRICE);
    const ticketId = 1n;

    return { deployer, feeRecipient, seller, buyer, usdc, lottery, market, ticketId };
  }

  it("rejects listing by a non-owner", async () => {
    const { market, buyer, ticketId } = await setup();
    await expect(market.connect(buyer).listTicket(ticketId, USDC(20))).to.be.revertedWith("not ticket owner");
  });

  it("rejects listing without market approval", async () => {
    const { market, seller, ticketId } = await setup();
    await expect(market.connect(seller).listTicket(ticketId, USDC(20))).to.be.revertedWith("market not approved");
  });

  it("lists, sells, and splits proceeds with a 2% platform fee", async () => {
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

    await market.connect(buyer).buyTicket(ticketId);

    expect(await lottery.ownerOf(ticketId)).to.equal(buyer.address);

    const expectedFee = (price * 200n) / 10_000n;
    const expectedSellerProceeds = price - expectedFee;

    expect(await usdc.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);
    expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + expectedSellerProceeds);
    expect(await usdc.balanceOf(buyer.address)).to.equal(0n);
    expect((await market.listings(ticketId)).active).to.equal(false);
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
