// scripts/setup_demo.js
require('dotenv').config({ path: '.env.demo', quiet: true });

const { ownerVotingContract, ownerTallyContract, wallets } = require("../src/config/onchain");

async function main() {
  console.log("=== Demo Coordinator Setup ===\n");

  // Voting Contract에 coordinator 등록
  console.log("1. Voting Contract Coordinators:\n");
  for (const wallet of wallets) {
    const addr = wallet.address;

    const isCoordinator = await ownerVotingContract.coordinators(addr);

    if (isCoordinator) {
      console.log(`✓ ${addr} 이미 등록됨, 스킵`);
      continue;
    }

    console.log(`Adding coordinator: ${addr}`);
    const tx = await ownerVotingContract.addCoordinator(addr);
    await tx.wait();
    console.log(`✓ ${addr} 등록 완료, tx: ${tx.hash}\n`);
  }

  // Tally Contract에도 coordinator 등록
  console.log("\n2. Tally Contract Coordinators:\n");
  for (const wallet of wallets) {
    const addr = wallet.address;

    const isCoordinator = await ownerTallyContract.coordinators(addr);

    if (isCoordinator) {
      console.log(`✓ ${addr} 이미 등록됨, 스킵`);
      continue;
    }

    console.log(`Adding coordinator: ${addr}`);
    const tx = await ownerTallyContract.addCoordinator(addr);
    await tx.wait();
    console.log(`✓ ${addr} 등록 완료, tx: ${tx.hash}\n`);
  }

  console.log("=== Demo Setup 완료 ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
