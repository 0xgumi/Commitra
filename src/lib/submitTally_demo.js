require('dotenv').config({ path: '.env.demo', quiet: true });

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { tallyContract } = require("../config/onchain");

const DEMO_DB_PATH = path.join(__dirname, "../db/voting_demo.db");

// Demo only: once the tally is final on-chain the server has no further use for
// the registration EOAs, so the voteId's snapshot rows are removed. Process and
// infrastructure logs are outside this function's reach.
function purgeSnapshotRows(voteId, dbPath = DEMO_DB_PATH) {
  const db = new Database(dbPath);
  try {
    const info = db.prepare("DELETE FROM snapshot WHERE voteId = ?").run(voteId);
    return info.changes;
  } finally {
    db.close();
  }
}

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

  if (await tallyContract.isTallyFinalized(voteId)) {
    console.error(`❌ voteId ${voteId} is already finalized on-chain; not submitting`);
    process.exit(1);
  }

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

  // 3. 확정 후 EOA 보관 종료 (실패해도 온체인 결과는 이미 확정)
  try {
    const deleted = purgeSnapshotRows(voteId);
    console.log(`✓ snapshot rows deleted for voteId ${voteId}: ${deleted}`);
  } catch (err) {
    console.warn(`⚠ snapshot rows not deleted (${err.message}); run manually: DELETE FROM snapshot WHERE voteId = ${voteId};`);
  }

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

module.exports = { submitTally, purgeSnapshotRows };
