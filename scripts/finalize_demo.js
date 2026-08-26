// scripts/finalize_demo.js
// IMPORTANT: dotenv MUST be loaded before onchain.js
require('dotenv').config({ path: '.env.demo', quiet: true });

const path = require("path");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const { ownerVotingContract, ownerTallyContract, votingContract } = require("../src/config/onchain");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "../src/db/voting_demo.db");
const db = new Database(dbPath);

// Dummy constants (pre-calculated with r=1, weight=0)
let DUMMY_ENCRYPTED_VOTES = null;
let DUMMY_HASH = null;

function buildInternalApiHeaders() {
  const headers = { "Content-Type": "application/json" };
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (password) {
    const credentials = Buffer.from(`internal:${password}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }
  return headers;
}

async function calculateDummyConstants() {
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = babyJub.F;

  // Load coordinator pubkey from environment
  const coordinatorPubkey = JSON.parse(process.env.COORDINATOR_PUBKEY);
  const pubkey = [
    F.e(coordinatorPubkey[0]),
    F.e(coordinatorPubkey[1])
  ];

  // Encrypt with r=1, weight=0
  // C1 = r * G = 1 * G = G
  // C2 = weight * G + r * pubkey = 0 * G + 1 * pubkey = pubkey
  const G = babyJub.Base8;
  const r = 1n;

  const C1 = babyJub.mulPointEscalar(G, r);
  const C2 = pubkey; // weight=0 so only r * pubkey

  const encryptedZero = [
    [F.toObject(C1[0]).toString(), F.toObject(C1[1]).toString()],
    [F.toObject(C2[0]).toString(), F.toObject(C2[1]).toString()]
  ];

  // All 3 choices are 0
  DUMMY_ENCRYPTED_VOTES = [encryptedZero, encryptedZero, encryptedZero];

  // Calculate encryptedVotesHash
  const flat = [];
  for (let choice = 0; choice < 3; choice++) {
    for (let c = 0; c < 2; c++) {
      for (let coord = 0; coord < 2; coord++) {
        flat.push(BigInt(DUMMY_ENCRYPTED_VOTES[choice][c][coord]));
      }
    }
  }
  DUMMY_HASH = F.toObject(poseidon(flat)).toString();

  console.log("✓ Dummy constants calculated");
  console.log("  DUMMY_HASH:", DUMMY_HASH);
}

async function main() {
  const voteId = process.argv[2];

  if (!voteId) {
    console.error("Usage: node scripts/finalize_demo.js <voteId>");
    console.error("Example: node scripts/finalize_demo.js 1");
    process.exit(1);
  }

  console.log(`\n=== Finalize Demo VoteId: ${voteId} ===\n`);

  // 0. Guard: only voteIds this DB knows, and never an already-finalized one
  const voteRow = db.prepare(
    "SELECT voteId, closedAt FROM active_votes WHERE voteId = ?"
  ).get(voteId);
  if (!voteRow) {
    console.error(`✗ voteId ${voteId} is not in this DB (active_votes); refusing to finalize an on-chain-only id`);
    process.exit(1);
  }
  if (await ownerTallyContract.isTallyFinalized(voteId)) {
    console.error(`✗ voteId ${voteId} is already finalized on-chain (TallyContract)`);
    process.exit(1);
  }

  // 0.5. Calculate dummy constants
  await calculateDummyConstants();

  // 1. Check if already closed
  const alreadyClosed = await votingContract.isVotingClosed(voteId);
  if (alreadyClosed) {
    if (!voteRow.closedAt) {
      console.error(`✗ voteId ${voteId} is closed on-chain but still open in this DB.`);
      console.error(`  This happens when a previous run stopped after closeVoting confirmed but before the DB was updated.`);
      console.error(`  If this DB really owns the vote, record the closure and re-run:`);
      console.error(`    sqlite3 src/db/voting_demo.db "UPDATE active_votes SET closedAt = datetime('now') WHERE voteId = ${voteId};"`);
      process.exit(1);
    }
    console.log("⚠ Voting already closed (DB and chain agree)");
  } else {
    // 2. Call closeVoting
    console.log("\n1. Calling closeVoting...");
    const closeTx = await ownerVotingContract.closeVoting(voteId);
    await closeTx.wait();
    console.log("✓ closeVoting complete, tx:", closeTx.hash);

    // 2.5. Update active_votes
    db.prepare(
      "UPDATE active_votes SET closedAt = datetime('now') WHERE voteId = ?"
    ).run(voteId);
    console.log("✓ active_votes updated (closedAt set)");
  }

  // 3. Query current permits count
  console.log("\n2. Querying permits count...");
  const permits = db.prepare(
    "SELECT COUNT(*) as count FROM permits WHERE voteId = ?"
  ).get(voteId);
  const realVoteCount = permits.count;
  console.log("✓ Real vote count:", realVoteCount);

  // 4. Calculate dummy count
  const TARGET_COUNT = 100;
  if (realVoteCount > TARGET_COUNT) {
    console.error(`✗ ${realVoteCount} permits exceed the tally batch size (${TARGET_COUNT}); cannot finalize`);
    process.exit(1);
  }
  const dummyCount = TARGET_COUNT - realVoteCount;
  console.log("✓ Dummies needed:", dummyCount);

  // 5. Check if dummies already registered
  const alreadyRegistered = await votingContract.isDummyRegistered(voteId);
  if (alreadyRegistered) {
    console.log("⚠ Dummies already registered");
    if (realVoteCount === 0) {
      console.warn(`⚠ dummies are registered on-chain but this DB holds 0 permits for voteId ${voteId} — DB may be out of sync with the chain`);
    }
  } else {
    // 6. Call registerDummyVotes — also with an empty batch when exactly 100 real
    // votes need no padding, because finalizeTally requires isDummyRegistered
    console.log("\n3. Calling registerDummyVotes...");
    const dummyHashes = new Array(dummyCount).fill(DUMMY_HASH);
    const dummyTx = await ownerVotingContract.registerDummyVotes(voteId, dummyHashes);
    await dummyTx.wait();
    console.log(`✓ registerDummyVotes complete (${dummyCount} dummies), tx:`, dummyTx.hash);
  }

  if (dummyCount === 0) {
    console.log("✓ No dummy permits needed (exactly 100 real votes)");
  } else {
    // 7. Insert dummy permits to DB
    console.log("\n4. Saving dummy permits to DB...");

    // Get current max id for this voteId
    const lastId = db.prepare(
      "SELECT MAX(id) as maxId FROM permits WHERE voteId = ?"
    ).get(voteId);
    let nextId = (lastId?.maxId ?? 0) + 1;

    const insertStmt = db.prepare(
      "INSERT INTO permits (voteId, id, encryptedVotes, encryptedVotesHash) VALUES (?, ?, ?, ?)"
    );

    for (let i = 0; i < dummyCount; i++) {
      insertStmt.run(voteId, nextId, JSON.stringify(DUMMY_ENCRYPTED_VOTES), DUMMY_HASH);
      nextId++;
    }
    console.log(`✓ ${dummyCount} dummy permits saved`);
  }

  // 8. Final verification
  console.log("\n5. Final verification...");
  const finalCount = db.prepare(
    "SELECT COUNT(*) as count FROM permits WHERE voteId = ?"
  ).get(voteId);
  console.log("✓ Total permits:", finalCount.count);

  // 9. Cleanup server locks (Demo server on port 4000)
  console.log("\n6. Cleaning up server locks...");
  try {
    const response = await fetch("http://localhost:4000/voter/cleanup-locks", {
      method: "POST",
      headers: buildInternalApiHeaders(),
      body: JSON.stringify({ voteId: parseInt(voteId), token: process.env.INTERNAL_API_TOKEN })
    });
    if (response.ok) {
      console.log("✓ Server locks cleaned up");
    } else {
      console.log(`⚠ cleanup-locks returned HTTP ${response.status} (non-critical)`);
    }
  } catch (err) {
    console.log("⚠ Demo server not running or cleanup failed (non-critical)");
  }

  console.log("\n=== Finalize complete ===");
  console.log("Next step: node src/lib/tally_demo.js", voteId);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
