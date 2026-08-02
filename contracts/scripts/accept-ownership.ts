import { ethers, network } from "hardhat";

/// Completes the ownership handover started by deploy-testnet.ts.
///
/// Ownership is two-step everywhere: the deployer *offers* it, and the admin
/// wallet must accept. That is deliberate — accepting proves the admin can
/// actually sign with that wallet before the deployer key stops being able to
/// rescue a mistake. A one-step transfer to a mistyped or inaccessible address
/// would brick the contracts permanently.
///
/// Run this with PRIVATE_KEY set to the ADMIN wallet's key:
///   PRIVATE_KEY=<admin key> npx hardhat run scripts/accept-ownership.ts --network baseSepolia
///
/// If you'd rather not put your admin key in an env file at all — a reasonable
/// stance for the wallet that controls the platform — call `acceptOwnership()`
/// on each contract from a wallet UI or block explorer instead. Same effect.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`network : ${network.name}`);
  console.log(`accepting as: ${signer.address}\n`);

  const targets = [
    { label: "LotteryTicket", address: required("LOTTERY_ADDRESS"), factory: "LotteryTicket" },
    { label: "TicketMarket", address: required("MARKET_ADDRESS"), factory: "TicketMarket" },
    { label: "ComplianceRegistry", address: required("COMPLIANCE_ADDRESS"), factory: "ComplianceRegistry" },
  ];

  for (const target of targets) {
    const contract = await ethers.getContractAt(target.factory, target.address);
    const currentOwner: string = await contract.owner();

    if (currentOwner.toLowerCase() === signer.address.toLowerCase()) {
      console.log(`${target.label}: already owned by this wallet — skipping`);
      continue;
    }

    await (await contract.acceptOwnership()).wait();
    console.log(`${target.label}: owner is now ${await contract.owner()}`);
  }

  console.log("\nDone. Connect this wallet at /admin to manage the platform.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
