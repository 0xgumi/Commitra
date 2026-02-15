// scripts/createSnapshot.js (Demo version)
require('dotenv').config({ path: '.env.demo', quiet: true });
const path = require("path");
const Database = require("better-sqlite3");
const { ownerVotingContract } = require("../src/config/onchain");

const dbPath = path.join(__dirname, "../src/db/voting_demo.db");
const db = new Database(dbPath);

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

  // 1. Check if voteId already exists
  const existing = db.prepare(
    "SELECT * FROM active_votes WHERE voteId = ?"
  ).get(voteId);

  if (existing) {
    console.error(`\n❌ voteId ${voteId} already exists`);
    process.exit(1);
  }

  // 2. Insert into active_votes
  db.prepare(
    "INSERT INTO active_votes (voteId, title) VALUES (?, ?)"
  ).run(voteId, title);
  console.log(`✓ active_votes: inserted`);

  // 3. On-chain createVoteId
  console.log(`\n3. Calling createVoteId(${voteId}) on-chain...`);
  try {
    const tx = await ownerVotingContract.createVoteId(voteId);
    await tx.wait();
    console.log(`✓ createVoteId tx: ${tx.hash}`);
  } catch (err) {
    if (err.message.includes("already exists")) {
      console.log(`⚠ voteId ${voteId} already exists on-chain`);
    } else {
      throw err;
    }
  }

  console.log(`\n✅ Demo vote created successfully!`);
  console.log(`   Voters will be registered dynamically via /weight endpoint`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});