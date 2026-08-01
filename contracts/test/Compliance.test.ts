import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployLottery, deployComplianceRegistry, fundAndApprove, BASE_PRICE, USDC, country, US } from "./helpers";

const Status = {
  None: 0n,
  Verified: 1n,
  Expired: 2n,
  Revoked: 3n,
  BlockedJurisdiction: 4n,
  SelfExcluded: 5n,
};

describe("ComplianceRegistry", () => {
  async function setup() {
    const [owner, verifier, alice, bob] = await ethers.getSigners();
    const registry = await deployComplianceRegistry(owner.address, verifier.address);
    return { owner, verifier, alice, bob, registry };
  }

  it("starts everyone unverified", async () => {
    const { registry, alice } = await setup();
    expect(await registry.statusOf(alice.address)).to.equal(Status.None);
    expect(await registry.isAllowed(alice.address)).to.equal(false);
  });

  it("lets a verifier record a verification", async () => {
    const { registry, verifier, alice } = await setup();
    const ref = ethers.keccak256(ethers.toUtf8Bytes("provider-record-123"));

    await registry.connect(verifier).setVerification(alice.address, US, 0, ref);

    expect(await registry.statusOf(alice.address)).to.equal(Status.Verified);
    expect(await registry.isAllowed(alice.address)).to.equal(true);
    const record = await registry.recordOf(alice.address);
    expect(record.country).to.equal(US);
    expect(record.providerRef).to.equal(ref);
    expect(record.revoked).to.equal(false);
  });

  it("rejects verification attempts from non-verifiers", async () => {
    const { registry, alice, bob } = await setup();
    await expect(
      registry.connect(bob).setVerification(alice.address, US, 0, ethers.ZeroHash)
    ).to.be.revertedWith("not a verifier");
  });

  it("only lets the owner appoint verifiers", async () => {
    const { registry, owner, alice, bob } = await setup();
    await expect(registry.connect(bob).setVerifier(bob.address, true)).to.be.reverted;

    await registry.connect(owner).setVerifier(bob.address, true);
    await registry.connect(bob).setVerification(alice.address, US, 0, ethers.ZeroHash);
    expect(await registry.isAllowed(alice.address)).to.equal(true);
  });

  it("treats an elapsed expiry as expired, not verified", async () => {
    const { registry, verifier, alice } = await setup();
    const expiresAt = (await time.latest()) + 3600;
    await registry.connect(verifier).setVerification(alice.address, US, expiresAt, ethers.ZeroHash);
    expect(await registry.isAllowed(alice.address)).to.equal(true);

    await time.increase(3601);

    expect(await registry.statusOf(alice.address)).to.equal(Status.Expired);
    expect(await registry.isAllowed(alice.address)).to.equal(false);
  });

  it("honours revocation", async () => {
    const { registry, verifier, alice } = await setup();
    await registry.connect(verifier).setVerification(alice.address, US, 0, ethers.ZeroHash);

    await registry.connect(verifier).revoke(alice.address);

    expect(await registry.statusOf(alice.address)).to.equal(Status.Revoked);
    expect(await registry.isAllowed(alice.address)).to.equal(false);
  });

  it("blocks a jurisdiction retroactively for everyone in it", async () => {
    const { registry, owner, verifier, alice } = await setup();
    const FR = country("FR");
    await registry.connect(verifier).setVerification(alice.address, FR, 0, ethers.ZeroHash);
    expect(await registry.isAllowed(alice.address)).to.equal(true);

    await registry.connect(owner).setBlockedCountry(FR, true);

    expect(await registry.statusOf(alice.address)).to.equal(Status.BlockedJurisdiction);
    expect(await registry.isAllowed(alice.address)).to.equal(false);

    // ...and unblocking restores them without re-verification
    await registry.connect(owner).setBlockedCountry(FR, false);
    expect(await registry.isAllowed(alice.address)).to.equal(true);
  });

  it("lets a player exclude themselves, and refuses to shorten it", async () => {
    const { registry, verifier, alice } = await setup();
    await registry.connect(verifier).setVerification(alice.address, US, 0, ethers.ZeroHash);

    const oneWeek = (await time.latest()) + 7 * 24 * 60 * 60;
    await registry.connect(alice).selfExclude(oneWeek);

    expect(await registry.statusOf(alice.address)).to.equal(Status.SelfExcluded);
    expect(await registry.isAllowed(alice.address)).to.equal(false);
    // ...but they can still collect winnings they already hold.
    expect(await registry.canClaim(alice.address)).to.equal(true);

    // Extending is fine; shortening — by the player or anyone else — is not.
    await registry.connect(alice).selfExclude(oneWeek + 3600);
    await expect(registry.connect(alice).selfExclude(oneWeek)).to.be.revertedWith(
      "cannot shorten exclusion"
    );
  });

  it("nobody, including the owner, can lift a self-exclusion", async () => {
    const { registry, owner, verifier, alice } = await setup();
    await registry.connect(verifier).setVerification(alice.address, US, 0, ethers.ZeroHash);
    const until = (await time.latest()) + 7 * 24 * 60 * 60;
    await registry.connect(alice).selfExclude(until);

    // Re-verifying does not clear it — the exclusion lives outside the record.
    await registry.connect(verifier).setVerification(alice.address, US, 0, ethers.ZeroHash);
    expect(await registry.isAllowed(alice.address)).to.equal(false);
    // And there is no owner-facing function to shorten it at all.
    expect((registry.connect(owner) as any).clearSelfExclusion).to.equal(undefined);
  });

  it("expires a self-exclusion once its term is up", async () => {
    const { registry, verifier, alice } = await setup();
    await registry.connect(verifier).setVerification(alice.address, US, 0, ethers.ZeroHash);
    const until = (await time.latest()) + 3600;
    await registry.connect(alice).selfExclude(until);
    expect(await registry.isAllowed(alice.address)).to.equal(false);

    await time.increase(3601);
    expect(await registry.isAllowed(alice.address)).to.equal(true);
  });

  it("a harder disqualification outranks self-exclusion for payouts", async () => {
    const { registry, owner, verifier, alice } = await setup();
    await registry.connect(verifier).setVerification(alice.address, US, 0, ethers.ZeroHash);
    await registry.connect(alice).selfExclude((await time.latest()) + 3600);
    expect(await registry.canClaim(alice.address)).to.equal(true);

    // A blocked jurisdiction must still withhold the payout.
    await registry.connect(owner).setBlockedCountry(US, true);
    expect(await registry.statusOf(alice.address)).to.equal(Status.BlockedJurisdiction);
    expect(await registry.canClaim(alice.address)).to.equal(false);
  });

  it("rejects an expiry that is already in the past", async () => {
    const { registry, verifier, alice } = await setup();
    const past = (await time.latest()) - 1;
    await expect(
      registry.connect(verifier).setVerification(alice.address, US, past, ethers.ZeroHash)
    ).to.be.revertedWith("already expired");
  });
});

describe("compliance gating", () => {
  async function setup() {
    const [deployer, feeRecipient, alice, bob] = await ethers.getSigners();
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

    return { deployer, feeRecipient, alice, bob, usdc, registry, lottery, market };
  }

  it("blocks an unverified buyer from the primary raffle", async () => {
    const { lottery, registry, usdc, alice } = await setup();
    await registry.revoke(alice.address);
    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);

    await expect(lottery.connect(alice).buyTicket(BASE_PRICE)).to.be.revertedWith(
      "compliance: not verified"
    );
  });

  it("blocks a buyer from a newly blocked jurisdiction", async () => {
    const { lottery, registry, usdc, alice } = await setup();
    await registry.setBlockedCountry(US, true);
    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);

    await expect(lottery.connect(alice).buyTicket(BASE_PRICE)).to.be.revertedWith(
      "compliance: not verified"
    );
  });

  it("blocks a raw ERC721 transfer to an unverified address", async () => {
    const { lottery, registry, usdc, alice, bob } = await setup();
    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);

    // Bob loses his verification, so he can no longer receive a ticket even
    // by bypassing the marketplace entirely.
    await registry.revoke(bob.address);

    await expect(
      lottery.connect(alice).transferFrom(alice.address, bob.address, 1n)
    ).to.be.revertedWith("compliance: recipient not verified");
  });

  it("blocks listing and buying on the secondary market", async () => {
    const { lottery, market, registry, usdc, alice, bob } = await setup();
    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await lottery.connect(alice).approve(await market.getAddress(), 1n);
    await market.connect(alice).listTicket(1n, USDC(20));

    await registry.revoke(bob.address);
    await fundAndApprove(usdc, bob, await market.getAddress(), USDC(20));
    await expect(market.connect(bob).buyTicket(1n)).to.be.revertedWith("compliance: not verified");

    // and a revoked holder can no longer list
    await registry.revoke(alice.address);
    await expect(market.connect(alice).listTicket(1n, USDC(20))).to.be.revertedWith(
      "compliance: not verified"
    );
  });

  it("withholds a prize from a winner whose verification lapsed, then pays after re-verification", async () => {
    const { lottery, registry, coordinator, usdc, alice } = await (async () => {
      const s = await setup();
      const coordinatorAddress = await s.lottery.s_vrfCoordinator();
      const coordinator = await ethers.getContractAt("MockVRFCoordinatorV2Plus", coordinatorAddress);
      return { ...s, coordinator };
    })();

    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);

    await time.increase(30 * 24 * 60 * 60 + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, await lottery.getAddress(), [0n]);

    await registry.revoke(alice.address);
    await expect(lottery.connect(alice).claimPrize(1)).to.be.revertedWith(
      "compliance: winner not verified"
    );

    // Funds are withheld, not lost — re-verifying releases them.
    await registry.setVerification(alice.address, US, 0, ethers.ZeroHash);
    const before = await usdc.balanceOf(alice.address);
    await lottery.connect(alice).claimPrize(1);
    expect(await usdc.balanceOf(alice.address)).to.be.greaterThan(before);
  });

  it("stops a self-excluded player buying, but still pays out what they won", async () => {
    const { lottery, registry, usdc, alice } = await setup();
    const lotteryAddress = await lottery.getAddress();
    const coordinator = await ethers.getContractAt(
      "MockVRFCoordinatorV2Plus",
      await lottery.s_vrfCoordinator()
    );

    // Wins a round first, then excludes themselves.
    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    await time.increase(30 * 24 * 60 * 60 + 1);
    await lottery.requestDraw();
    const requestId = (await lottery.rounds(1)).vrfRequestId;
    await coordinator.fulfillRandomWordsWithOverride(requestId, lotteryAddress, [0n]);

    await registry.connect(alice).selfExclude((await time.latest()) + 30 * 24 * 60 * 60);

    // No further play...
    await lottery.startNewRound();
    await fundAndApprove(usdc, alice, lotteryAddress, BASE_PRICE);
    await expect(lottery.connect(alice).buyTicket(BASE_PRICE)).to.be.revertedWith(
      "compliance: not verified"
    );

    // ...but the prize they already won is still theirs.
    const before = await usdc.balanceOf(alice.address);
    await lottery.connect(alice).claimPrize(1);
    expect(await usdc.balanceOf(alice.address)).to.be.greaterThan(before);
  });

  it("lets the owner point the raffle at a replacement registry", async () => {
    const { lottery, deployer, usdc, alice } = await setup();
    const permissive = await deployComplianceRegistry(deployer.address, deployer.address);
    await permissive.setVerification(alice.address, US, 0, ethers.ZeroHash);

    await lottery.setComplianceRegistry(await permissive.getAddress());
    expect(await lottery.complianceRegistry()).to.equal(await permissive.getAddress());

    await fundAndApprove(usdc, alice, await lottery.getAddress(), BASE_PRICE);
    await lottery.connect(alice).buyTicket(BASE_PRICE);
    expect(await lottery.balanceOf(alice.address)).to.equal(1n);
  });
});
