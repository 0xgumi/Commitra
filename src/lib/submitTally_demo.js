require('dotenv').config({ path: '.env.demo', quiet: true });

const path = require("path");
const fs = require("fs");
const { tallyContract } = require("../config/onchain");

async function submitTally(voteId) {
  if (!voteId) {
    console.error("Usage: node src/lib/submitTally_demo.js <voteId>");
    console.error("Example: node src/lib/submitTally_demo.js 1");
    process.exit(1);
  }

  console.log(`\n=== Demo finalizeTally submit (voteId: ${voteId}) ===\n`);

  // Load proof for this voteId (demo version)
  const proofPath = path.join(__dirname, `../../tally_outputs/demo/tally_proof_demo_${voteId}.json`);

  if (!fs.existsSync(proofPath)) {
    console.error(`❌ Proof file not found: tally_proof_demo_${voteId}.json`);
    console.error(`Run "node src/lib/tally_demo.js ${voteId}" first.`);
    process.exit(1);
  }
  const { pA, pB, pC, publicSignals } = JSON.parse(fs.readFileSync(proofPath, "utf-8"));

  console.log("1. Proof 로드 완료");
  console.log("publicSignals 개수:", publicSignals.length);

  // on-chain 제출
  console.log("2. finalizeTally() 호출 중...");

  const tx = await tallyContract.finalizeTally(voteId, pA, pB, pC, publicSignals);
  console.log("tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("✓ finalizeTally 성공! block:", receipt.blockNumber);

  // 결과 확인
  const [yes, no, abstain] = await tallyContract.getTallyResult(voteId);
  console.log("\n=== On-chain 결과 (Demo) ===");
  console.log("YES:", yes.toString());
  console.log("NO:", no.toString());
  console.log("ABSTAIN:", abstain.toString());

  return { yes, no, abstain };
}

if (require.main === module) {
  const voteId = process.argv[2];
  submitTally(voteId)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { submitTally };
