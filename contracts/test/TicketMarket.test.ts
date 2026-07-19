import { expect } from "chai";
import { ethers } from "hardhat";
import { deployLottery, BASE_PRICE } from "./helpers";

describe("TicketMarket", () => {
  async function setup() {
    const [deployer, feeRecipient, seller, buyer] = await ethers.getSigners();
    const { lottery } = await deployLottery(deployer.address, feeRecipient.address);

    const TicketMarket = await ethers.getContractFactory("TicketMarket");
    const market = await TicketMarket.deploy(deployer.address, await lottery.getAddress(), feeRecipient.address);
    await market.waitForDeployment();

    await lottery.connect(seller).buyTicket({ value: BASE_PRICE });
    const ticketId = 1n;

    return { deployer, feeRecipient, seller, buyer, lottery, market, ticketId };
  }

  it("rejects listing by a non-owner", async () => {
    const { market, buyer, ticketId } = await setup();
    await expect(market.connect(buyer).listTicket(ticketId, ethers.parseEther("0.02"))).to.be.revertedWith(
      "not ticket owner"
    );
  });

  it("rejects listing without market approval", async () => {
    const { market, seller, ticketId } = await setup();
    await expect(market.connect(seller).listTicket(ticketId, ethers.parseEther("0.02"))).to.be.revertedWith(
      "market not approved"
    );
  });

  it("lists, sells, and splits proceeds with a 2% platform fee", async () => {
    const { market, lottery, feeRecipient, seller, buyer, ticketId } = await setup();

    const price = ethers.parseEther("0.02");
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    const listing = await market.listings(ticketId);
    expect(listing.active).to.equal(true);
    expect(listing.price).to.equal(price);

    const feeRecipientBefore = await ethers.provider.getBalance(feeRecipient.address);
    const sellerBefore = await ethers.provider.getBalance(seller.address);

    await market.connect(buyer).buyTicket(ticketId, { value: price });

    expect(await lottery.ownerOf(ticketId)).to.equal(buyer.address);

    const expectedFee = (price * 200n) / 10_000n;
    const expectedSellerProceeds = price - expectedFee;

    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);
    expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBefore + expectedSellerProceeds);
    expect((await market.listings(ticketId)).active).to.equal(false);
  });

  it("rejects buying with the wrong payment amount", async () => {
    const { market, lottery, seller, buyer, ticketId } = await setup();
    const price = ethers.parseEther("0.02");
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    await expect(market.connect(buyer).buyTicket(ticketId, { value: price - 1n })).to.be.revertedWith(
      "incorrect payment"
    );
  });

  it("allows the seller to cancel a listing", async () => {
    const { market, lottery, seller, buyer, ticketId } = await setup();
    const price = ethers.parseEther("0.02");
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    await market.connect(seller).cancelListing(ticketId);
    expect((await market.listings(ticketId)).active).to.equal(false);

    await expect(market.connect(buyer).buyTicket(ticketId, { value: price })).to.be.revertedWith("not listed");
  });

  it("rejects cancellation by a non-seller", async () => {
    const { market, lottery, seller, buyer, ticketId } = await setup();
    const price = ethers.parseEther("0.02");
    await lottery.connect(seller).approve(await market.getAddress(), ticketId);
    await market.connect(seller).listTicket(ticketId, price);

    await expect(market.connect(buyer).cancelListing(ticketId)).to.be.revertedWith("not seller");
  });
});
