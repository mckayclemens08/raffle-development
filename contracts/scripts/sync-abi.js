const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "..", "web", "lib", "abi");

const artifacts = [
  { name: "LotteryTicket", artifact: "contracts/LotteryTicket.sol/LotteryTicket.json", out: "LotteryTicket.json" },
  { name: "TicketMarket", artifact: "contracts/TicketMarket.sol/TicketMarket.json", out: "TicketMarket.json" },
  { name: "ERC20", artifact: "contracts/mocks/MockUSDC.sol/MockUSDC.json", out: "ERC20.json" },
];

for (const { artifact, out } of artifacts) {
  const artifactPath = path.join(__dirname, "..", "artifacts", artifact);
  const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(path.join(outDir, out), JSON.stringify(abi, null, 2));
  console.log(`synced ${out}`);
}
