const fs = require("fs");
const path = require("path");

const contracts = ["LotteryTicket", "TicketMarket"];
const outDir = path.join(__dirname, "..", "..", "web", "lib", "abi");

for (const name of contracts) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(abi, null, 2));
  console.log(`synced ${name}.json`);
}
