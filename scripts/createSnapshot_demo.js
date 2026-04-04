// scripts/createSnapshot.js (Demo version)
require('dotenv').config({ path: '.env.demo', quiet: true });
const path = require("path");
const Database = require("better-sqlite3");
const { ownerVotingContract } = require("../src/config/onchain");

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
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: node scripts/createSnapshot.js <voteId> <title>");
    console.log("Example: node scripts/createSnapshot.js 1 \"Demo Vote #1\"");
    process.exit(1);
  }

  const voteId = parseInt(args[0]);
  const title = args[1];

  console.log(`\n=== Creating Demo Vote ===`);
  console.log(`voteId: ${voteId}`);
  console.log(`title: ${title}`);

  // 1. On-chain createVoteId 먼저 처리 (#2)
  console.log(`\n1. Calling createVoteId(${voteId}) on-chain...`);
  const isValid = await ownerVotingContract.isValidVoteId(voteId);
  if (isValid) {
    console.log(`✓ voteId ${voteId} already exists on-chain`);
  } else {
    const tx = await ownerVotingContract.createVoteId(voteId);
    await tx.wait();
    console.log(`✓ createVoteId tx: ${tx.hash}`);
  }

  // 2. DB 동기화 (idempotent)
  const syncResult = syncDemoVoteTx(voteId, title);
  if (syncResult.inserted) {
    console.log("✓ active_votes: inserted");
  } else {
    console.log("✓ active_votes: already synced");
  }

  console.log(`\n✅ Demo vote created successfully!`);
  console.log(`   Voters will be registered dynamically via /weight endpoint`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
