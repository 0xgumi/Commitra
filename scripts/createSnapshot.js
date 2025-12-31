const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { ownerVotingContract } = require("../src/config/onchain");

const dbPath = path.join(__dirname, "../src/db/voting.db");
const db = new Database(dbPath);

async function createSnapshot(jsonPath) {
  // 1. JSON 파일 읽기
  if (!jsonPath) {
    console.error("Usage: node scripts/createSnapshot.js <snapshot.json>");
    console.error("Example: node scripts/createSnapshot.js snapshots/vote1.json");
    process.exit(1);
  }

  const fullPath = path.resolve(jsonPath);
  if (!fs.existsSync(fullPath)) {
    console.error("File not found:", fullPath);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  const { voteId, title, voters } = data;

  if (!voteId || !voters || !Array.isArray(voters)) {
    console.error("Invalid JSON format. Required: voteId, voters[]");
    process.exit(1);
  }

  console.log(`\n=== Creating Snapshot for voteId: ${voteId} ===\n`);
  console.log("Title:", title || "(no title)");
  console.log("Voters:", voters.length);

  // 2. 중복 체크
  const existingVote = db.prepare(
    "SELECT * FROM active_votes WHERE voteId = ?"
  ).get(voteId);

  if (existingVote) {
    console.error(`\n❌ voteId ${voteId} already exists in active_votes`);
    process.exit(1);
  }

  // 3. active_votes 테이블에 추가
  db.prepare(
    "INSERT INTO active_votes (voteId, title) VALUES (?, ?)"
  ).run(voteId, title || `Vote ${voteId}`);
  console.log("✓ Added to active_votes");

  // 4. snapshot 테이블에 voters 추가
  const insertStmt = db.prepare(
    "INSERT OR REPLACE INTO snapshot (voteId, eoa, weight) VALUES (?, ?, ?)"
  );

  let totalWeight = 0;
  for (const voter of voters) {
    const eoa = voter.eoa.toLowerCase();
    const weight = voter.weight;
    insertStmt.run(voteId, eoa, weight);
    totalWeight += weight;
  }
  console.log(`✓ Added ${voters.length} voters to snapshot`);
  console.log(`✓ Total weight: ${totalWeight}`);

  // 5. On-chain createVoteId 호출
  console.log("\n5. Creating voteId on-chain...");
  try {
    const isValid = await ownerVotingContract.isValidVoteId(voteId);
    if (isValid) {
      console.log(`✓ voteId ${voteId} already exists on-chain`);
    } else {
      const tx = await ownerVotingContract.createVoteId(voteId);
      await tx.wait();
      console.log(`✓ voteId ${voteId} created on-chain, tx: ${tx.hash}`);
    }
  } catch (err) {
    console.error("On-chain createVoteId error:", err.message);
    console.log("(You may need to run this manually)");
  }

  console.log(`\n=== Snapshot created for voteId ${voteId} ===\n`);
}

// 실행
const jsonPath = process.argv[2];
createSnapshot(jsonPath)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });