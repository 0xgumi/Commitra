// scripts/createSnapshot.js (Demo version)
require('dotenv').config({ path: '.env.demo', quiet: true });
const path = require("path");
const Database = require("better-sqlite3");
const { ownerVotingContract, ownerTallyContract } = require("../src/config/onchain");
const { refreshUsedVoteIdLedger, hasCache } = require("./listVoteIds");

const dbPath = path.join(__dirname, "../src/db/voting_demo.db");
const db = new Database(dbPath);

const syncDemoVoteTx = db.transaction((voteId, title) => {
  const existing = db.prepare(
    "SELECT voteId, title, closedAt FROM active_votes WHERE voteId = ?"
  ).get(voteId);

  if (!existing) {
    db.prepare(
      "INSERT INTO active_votes (voteId, title) VALUES (?, ?)"
    ).run(voteId, title);
    return { inserted: true };
  }

  if (existing.closedAt) {
    throw new Error(`voteId ${voteId} already exists and is closed`);
  }

  if ((existing.title || "") !== title) {
    throw new Error(
      `active_votes title mismatch for voteId ${voteId}: DB='${existing.title}', input='${title}'`
    );
  }

  return { inserted: false };
});

async function main() {
  const adopt = process.argv.includes("--adopt");
  const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
  if (args.length < 2) {
    console.log("Usage: node scripts/createSnapshot_demo.js <voteId> <title> [--adopt]");
    console.log("Example: node scripts/createSnapshot_demo.js 1 \"Demo Vote #1\"");
    process.exit(1);
  }

  const voteId = parseInt(args[0]);
  const title = args[1];

  console.log(`\n=== Creating Demo Vote ===`);
  console.log(`voteId: ${voteId}`);
  console.log(`title: ${title}`);

  // 1. voteId 상태 확인 (DB → 체인), 통과한 뒤에만 createVoteId 전송
  //    온체인 voteId 상태는 영구적이라, 이 DB가 모르는 기존 id를 조용히 입양하면 안 됨
  console.log(`\n1. Checking voteId ${voteId} state...`);
  const dbVote = db.prepare(
    "SELECT voteId, closedAt FROM active_votes WHERE voteId = ?"
  ).get(voteId);
  if (dbVote && dbVote.closedAt) {
    console.error(`✗ voteId ${voteId} already exists in this DB and is closed`);
    process.exit(1);
  }

  const isValid = await ownerVotingContract.isValidVoteId(voteId);
  if (isValid && !dbVote) {
    if (!adopt) {
      console.error(`✗ voteId ${voteId} already exists on-chain but is unknown to this DB.`);
      console.error(`  On-chain voteId state is permanent. Pick an unused id`);
      console.error(`  (node scripts/listVoteIds.js demo check ${voteId}), or re-run with --adopt to attach an OPEN id.`);
      process.exit(1);
    }
    // Sequential view calls: the free RPC tier rate-limits per request
    const closed = await ownerVotingContract.isVotingClosed(voteId);
    const dummy = await ownerVotingContract.isDummyRegistered(voteId);
    const finalized = await ownerTallyContract.isTallyFinalized(voteId);
    if (closed || dummy || finalized) {
      console.error(`✗ voteId ${voteId} cannot be adopted: closed=${closed} dummyRegistered=${dummy} finalized=${finalized}`);
      process.exit(1);
    }
    console.log(`⚠ Adopting existing OPEN on-chain voteId ${voteId}; roots registered before this DB remain valid on-chain`);
  }

  let createdOnChain = false;
  if (isValid) {
    console.log(`✓ voteId ${voteId} already exists on-chain`);
  } else {
    const tx = await ownerVotingContract.createVoteId(voteId);
    await tx.wait();
    createdOnChain = true;
    console.log(`✓ createVoteId tx: ${tx.hash}`);
  }

  // 2. DB 동기화 (idempotent)
  const syncResult = syncDemoVoteTx(voteId, title);
  if (syncResult.inserted) {
    console.log("✓ active_votes: inserted");
  } else {
    console.log("✓ active_votes: already synced");
  }

  // 3. used-voteId 원장 갱신 (실패해도 투표 생성은 성공; 다음 listVoteIds 실행이 바로잡음)
  if (createdOnChain) {
    if (!hasCache("demo")) {
      console.warn("⚠ used-voteId ledger not updated: no scan cache yet. Run once: node scripts/listVoteIds.js demo --out");
    } else {
      try {
        const ledger = await refreshUsedVoteIdLedger("demo");
        console.log(`✓ used-voteId ledger updated: ${path.relative(process.cwd(), ledger.path)} (${ledger.count} ids)`);
      } catch (err) {
        console.warn(`⚠ used-voteId ledger not updated (${err.message}). Run: node scripts/listVoteIds.js demo --out`);
      }
    }
  }

  console.log(`\n✅ Demo vote created successfully!`);
  console.log(`   Voters will be registered dynamically via /weight endpoint`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
