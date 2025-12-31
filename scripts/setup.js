// scripts/setup.js
const { ownerVotingContract, wallets } = require("../src/config/onchain");

async function main() {
  console.log("=== Coordinator Setup ===\n");

  for (const wallet of wallets) {
    const addr = wallet.address;
    
    // 이미 등록되어 있는지 확인
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

  console.log("=== Setup 완료 ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });