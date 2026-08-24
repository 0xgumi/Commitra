const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { ownerVotingContract } = require("../src/config/onchain");

const dbPath = path.join(__dirname, "../src/db/voting.db");
const db = new Database(dbPath);

const syncSnapshotTx = db.transaction((voteId, title, normalizedVoters) => {
  const effectiveTitle = title || `Vote ${voteId}`;
  const existingVote = db.prepare(
    "SELECT voteId, title, closedAt FROM active_votes WHERE voteId = ?"
  ).get(voteId);

  if (!existingVote) {
    db.prepare(
      "INSERT INTO active_votes (voteId, title) VALUES (?, ?)"
    ).run(voteId, effectiveTitle);
  } else {
    if (existingVote.closedAt) {
      throw new Error(`voteId ${voteId} already exists and is closed`);
    }
    if ((existingVote.title || "") !== effectiveTitle) {
      throw new Error(
        `active_votes title mismatch for voteId ${voteId}: DB='${existingVote.title}', input='${effectiveTitle}'`
      );
    }
  }

  const existingRows = db.prepare(
    "SELECT eoa, weight FROM snapshot WHERE voteId = ?"
  ).all(voteId);

  const existingMap = new Map(
    existingRows.map(r => [String(r.eoa).toLowerCase(), String(r.weight)])
  );
  const inputMap = new Map(
    normalizedVoters.map(v => [v.eoa, String(v.weight)])
  );

  for (const [eoa, weight] of inputMap) {
    if (existingMap.has(eoa) && existingMap.get(eoa) !== weight) {
      throw new Error(`snapshot weight mismatch for ${eoa}: DB=${existingMap.get(eoa)}, input=${weight}`);
    }
  }

  for (const eoa of existingMap.keys()) {
    if (!inputMap.has(eoa)) {
      throw new Error(`snapshot DB contains extra EOA not present in input: ${eoa}`);
    }
  }

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO snapshot (voteId, eoa, weight) VALUES (?, ?, ?)"
  );

  let inserted = 0;
  let totalWeight = 0n;
  for (const voter of normalizedVoters) {
    const info = insertStmt.run(voteId, voter.eoa, voter.weight);
    inserted += info.changes;
    totalWeight += BigInt(voter.weight);
  }

  return { inserted, existing: existingRows.length, totalWeight: totalWeight.toString() };
});

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

  // 1.5 입력 JSON 내부 중복 EOA 사전 차단 (#7)
  const seenEoas = new Set();
  const duplicateEoas = new Set();
  for (const voter of voters) {
    const normalizedEoa = String(voter.eoa || "").toLowerCase();
    if (seenEoas.has(normalizedEoa)) {
      duplicateEoas.add(normalizedEoa);
    }
    seenEoas.add(normalizedEoa);
  }

  if (duplicateEoas.size > 0) {
    console.error("\n❌ Duplicate EOA found in snapshot JSON:");
    for (const eoa of duplicateEoas) {
      console.error(` - ${eoa}`);
    }
    console.error("Please remove duplicates and run again.");
    process.exit(1);
  }

  const normalizedVoters = voters.map(voter => ({
    eoa: String(voter.eoa).toLowerCase(),
    weight: voter.weight
  }));

  // 2. On-chain createVoteId 먼저 처리 (#2)
  console.log("\n2. Creating voteId on-chain...");
  const isValid = await ownerVotingContract.isValidVoteId(voteId);
  if (isValid) {
    console.log(`✓ voteId ${voteId} already exists on-chain`);
  } else {
    const tx = await ownerVotingContract.createVoteId(voteId);
    await tx.wait();
    console.log(`✓ voteId ${voteId} created on-chain, tx: ${tx.hash}`);
  }

  // 3. DB 동기화 (idempotent)
  const syncResult = syncSnapshotTx(voteId, title, normalizedVoters);
  console.log(`✓ Snapshot DB sync complete (inserted: ${syncResult.inserted}, existing: ${syncResult.existing})`);
  console.log(`✓ Total weight: ${syncResult.totalWeight}`);

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
