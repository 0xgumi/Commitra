const express = require("express");
const router = express.Router();
const db = require("../db/db");
const circomlib = require("circomlibjs");
const { votingContract, getNextVotingContract } = require("../config/onchain");

let poseidon, F;

// #1 Fix: Poseidon 초기화 Promise로 race condition 방지
const poseidonReady = (async () => {
  poseidon = await circomlib.buildPoseidon();
  F = poseidon.F;
  console.log("✓ Poseidon initialized");
})();

async function ensurePoseidon() {
  await poseidonReady;
  if (!poseidon) throw new Error("Poseidon not initialized");
}

// #2 Fix: Leaf 등록 race condition 방지를 위한 voteId별 mutex
const leafLocks = new Map();

async function acquireLeafLock(voteId) {
  const key = String(voteId);
  if (!leafLocks.has(key)) {
    leafLocks.set(key, Promise.resolve());
  }
  const current = leafLocks.get(key);
  let release;
  const next = new Promise(resolve => { release = resolve; });
  leafLocks.set(key, next);
  await current;
  return release;
}

const ZERO = "0x" + "0".repeat(64);
const DEPTH = 15;

// =====================================
// DB Helper - Load leaf list
// =====================================
function loadLeavesFromDB(voteId) {
  const rows = db.prepare(
    "SELECT leaf FROM leaf_data WHERE voteId = ? ORDER BY leafIndex ASC"
  ).all(voteId);
  return rows.map(r => r.leaf);
}

// =====================================
// Poseidon Hash (2-input)
// =====================================
function poseidonHash(a, b) {
  return (
    "0x" +
    BigInt(F.toString(poseidon([BigInt(a), BigInt(b)])))
      .toString(16)
      .padStart(64, "0")
  );
}

// =====================================
// Merkle Tree Builder
// =====================================
function buildMerkleTree(leaves, depth = DEPTH) {
  if (leaves.length === 0) return { layers: [], root: ZERO };

  const layers = [];
  layers.push([...leaves]);

  for (let level = 0; level < depth; level++) {
    const current = layers[level];
    const next = [];

    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = current[i + 1] ?? ZERO;
      next.push(poseidonHash(left, right));
    }

    if (next.length === 0) next.push(ZERO);
    layers.push(next);
  }

  return { layers, root: layers[depth][0] };
}

// =====================================
// Merkle Path Generator
// =====================================
function getMerklePath(layers, leafIndex) {
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;

  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const isLeft = idx % 2 === 0;
    const siblingIndex = isLeft ? idx + 1 : idx - 1;
    const sibling = siblingIndex < layer.length ? layer[siblingIndex] : ZERO;

    pathElements.push(BigInt(sibling).toString());
    pathIndices.push(isLeft ? 0 : 1);
    idx = Math.floor(idx / 2);
  }

  return { pathElements, pathIndices };
}

// =====================================
// 1) Snapshot weight lookup (voteId + EOA)
// =====================================
router.post("/weight", (req, res) => {
  try {
    const { voteId, eoa } = req.body;
    if (!voteId) return res.status(400).json({ error: "Missing voteId" });
    if (!eoa) return res.status(400).json({ error: "Missing eoa" });

    // Check if voteId is active
    const activeVote = db.prepare(
      "SELECT * FROM active_votes WHERE voteId = ? AND closedAt IS NULL"
    ).get(voteId);

    if (!activeVote) return res.status(404).json({ error: "Vote not found or already closed" });

    // Check snapshot for this voteId
    const row = db.prepare(
      "SELECT * FROM snapshot WHERE voteId = ? AND eoa = ?"
    ).get(voteId, eoa.toLowerCase());

    if (!row) return res.status(404).json({ error: "EOA not found in snapshot for this vote" });

    return res.json({ status: "ok", weight: row.weight.toString() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
});

// =====================================
// 2) Leaf Registration (EOA not stored)
// =====================================
router.post("/leaf", async (req, res) => {
  const { voteId, leaf } = req.body;

  if (!voteId || !leaf)
    return res.status(400).json({ error: "Missing voteId or leaf" });

  // #1 Fix: Poseidon 초기화 대기
  await ensurePoseidon();

  // #2 Fix: voteId별 mutex로 동시 요청 방지
  let release = null;
  try {
    release = await acquireLeafLock(voteId);
    // Check if leaf is already registered
    const existing = db.prepare(
      "SELECT leafIndex, root, pathElements, pathIndices FROM leaf_data WHERE voteId = ? AND leaf = ?"
    ).get(voteId, leaf);

    if (existing) {
      // Already registered -> return existing data (no change)
      return res.json({
        status: "ok",
        leaf,
        leafIndex: existing.leafIndex,
        root: existing.root,
        pathElements: JSON.parse(existing.pathElements),
        pathIndices: JSON.parse(existing.pathIndices),
        txHash: null  // No txHash for already registered leaf
      });
    }

    // New leaf -> assign leafIndex
    const count = db.prepare(
      "SELECT COUNT(*) AS c FROM leaf_data WHERE voteId = ?"
    ).get(voteId).c;

    const leafIndex = count;

    // Build merkle tree with all leaves + new leaf
    const existingLeaves = loadLeavesFromDB(voteId);
    const allLeaves = [...existingLeaves, leaf];
    const { layers, root } = buildMerkleTree(allLeaves, DEPTH);

    // Calculate path for new leaf only
    const { pathElements, pathIndices } = getMerklePath(layers, leafIndex);

    // #3 Fix: 온체인 먼저, 성공 시에만 DB 저장 (원자성)
    let txHash = null;
    const currentRoot = await votingContract.currentRoot(voteId);
    if (currentRoot.toLowerCase() !== root.toLowerCase()) {
      const contract = getNextVotingContract();
      const tx = await contract.updateRoot(voteId, root);
      await tx.wait();
      txHash = tx.hash;
      console.log("✓ Root updated on-chain:", root, "txHash:", txHash);
    }

    // 온체인 성공 후 DB 저장
    db.prepare(
      "INSERT INTO leaf_data (voteId, leaf, leafIndex, root, pathElements, pathIndices) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(voteId, leaf, leafIndex, root, JSON.stringify(pathElements), JSON.stringify(pathIndices));

    db.prepare(
      "INSERT OR IGNORE INTO root_history (voteId, root) VALUES (?, ?)"
    ).run(voteId, root);

    console.log("✓ New leaf registered, index:", leafIndex);

    return res.json({
      status: "ok",
      leaf,
      leafIndex,
      root,
      pathElements,
      pathIndices,
      txHash
    });

  } catch (err) {
    console.error("leaf insert error:", err);
    return res.status(500).json({ error: err.message || "server error" });
  } finally {
    // #2 Fix: lock 해제 (획득한 경우에만)
    if (release) release();
  }
});

// =====================================
// 3) Merkle Proof Query (by leaf, no EOA)
// =====================================
router.post("/proof", (req, res) => {
  try {
    const { voteId, leaf } = req.body;

    if (!voteId || !leaf)
      return res.status(400).json({ error: "Missing voteId or leaf" });

    const row = db.prepare(
      "SELECT leafIndex, root, pathElements, pathIndices FROM leaf_data WHERE voteId = ? AND leaf = ?"
    ).get(voteId, leaf);

    if (!row)
      return res.status(404).json({ error: "Leaf not found" });

    return res.json({
      status: "ok",
      leaf,
      leafIndex: row.leafIndex,
      root: row.root,
      pathElements: JSON.parse(row.pathElements),
      pathIndices: JSON.parse(row.pathIndices)
    });

  } catch (err) {
    console.error("proof error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// =====================================
// 4) Root Validity Check
// =====================================
router.post("/verify-root", (req, res) => {
  try {
    const { voteId, root } = req.body;

    if (!voteId || !root)
      return res.status(400).json({ error: "Missing voteId or root" });

    const row = db.prepare(
      "SELECT * FROM root_history WHERE voteId = ? AND root = ?"
    ).get(voteId, root);

    return res.json({
      status: "ok",
      valid: !!row
    });

  } catch (err) {
    console.error("verify-root error:", err);
    return res.status(500).json({ error: "server error" });
  }
});
// =====================================
// Active votes list
// =====================================
router.get("/active-votes", (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT voteId, title, createdAt FROM active_votes WHERE closedAt IS NULL ORDER BY createdAt DESC"
    ).all();

    return res.json({
      status: "ok",
      votes: rows.map(r => ({
        voteId: r.voteId,
        title: r.title,
        createdAt: r.createdAt
      }))
    });
  } catch (err) {
    console.error("active-votes error:", err);
    return res.status(500).json({ error: "server error" });
  }
});
// =====================================
// Single vote info
// =====================================
router.get("/vote-info/:voteId", (req, res) => {
  try {
    const { voteId } = req.params;

    const vote = db.prepare(
      "SELECT * FROM active_votes WHERE voteId = ?"
    ).get(voteId);

    if (!vote) return res.status(404).json({ error: "Vote not found" });

    const voterCount = db.prepare(
      "SELECT COUNT(*) as count FROM snapshot WHERE voteId = ?"
    ).get(voteId).count;

    const totalWeight = db.prepare(
      "SELECT SUM(weight) as total FROM snapshot WHERE voteId = ?"
    ).get(voteId).total || 0;

    return res.json({
      status: "ok",
      voteId: vote.voteId,
      title: vote.title,
      createdAt: vote.createdAt,
      closedAt: vote.closedAt,
      voterCount,
      totalWeight
    });
  } catch (err) {
    console.error("vote-info error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

router.get("/coordinator-key", (req, res) => {
  try {
    const pubkey = JSON.parse(process.env.COORDINATOR_PUBKEY);
    res.json({ pubkey });
  } catch (err) {
    console.error("coordinator-key error:", err);
    res.status(500).json({ error: "Failed to load coordinator key" });
  }
});

// =====================================
// Cleanup locks for closed vote
// =====================================
router.post("/cleanup-locks", (req, res) => {
  try {
    const { voteId } = req.body;
    if (!voteId) return res.status(400).json({ error: "Missing voteId" });

    const key = String(voteId);
    if (leafLocks.has(key)) {
      leafLocks.delete(key);
      console.log(`✓ Cleaned up leafLock for voteId: ${voteId}`);
    }

    return res.json({ status: "ok", message: `Lock cleaned for voteId ${voteId}` });
  } catch (err) {
    console.error("cleanup-locks error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

// =====================================
// 5) Vote Submission (receive proof)
// =====================================
router.post("/submit-vote", async (req, res) => {
  try {
    // #1 Fix: Poseidon 초기화 대기
    await ensurePoseidon();

    const { pa, pb, pc, publicSignals, encryptedVotes } = req.body;

    if (!pa || !pb || !pc || !publicSignals || !encryptedVotes) {
      return res.status(400).json({ error: "Missing proof data" });
    }

    const merkleRoot = "0x" + BigInt(publicSignals[0]).toString(16).padStart(64, "0");
    const voteId = publicSignals[4];
    
    const isValidRoot = await votingContract.isValidRoot(voteId, merkleRoot);
    
    if (!isValidRoot) {
      return res.status(400).json({ error: "Invalid merkleRoot - not registered on-chain. Please wait a few seconds and try again." });
    }

    const nullifier = publicSignals[2];

    // Nullifier duplicate check
    const existingNullifier = db.prepare(
      "SELECT * FROM used_nullifiers WHERE voteId = ? AND nullifier = ?"
    ).get(voteId, nullifier);    

    if (existingNullifier) {
      return res.status(400).json({ error: "Nullifier already used - you have already voted." });
    }

    console.log("=== Vote submission received ===");
    console.log("pa:", JSON.stringify(pa));
    console.log("pb:", JSON.stringify(pb));
    console.log("pc:", JSON.stringify(pc));
    console.log("publicSignals:", JSON.stringify(publicSignals));
    console.log("nullifier:", nullifier);

    // Submit on-chain
    const contract = getNextVotingContract();
    const tx = await contract.submitVote(pa, pb, pc, publicSignals);
    const receipt = await tx.wait();

    // Save nullifier on success
    db.prepare(
      "INSERT INTO used_nullifiers (nullifier, voteId, txHash) VALUES (?, ?, ?)"
    ).run(nullifier, voteId, tx.hash);

    console.log("✓ Vote submitted on-chain, tx:", tx.hash);
    console.log("✓ Nullifier saved to DB");

    // Calculate encryptedVotesHash
    const flat = [];
    for (let choice = 0; choice < 3; choice++) {
      for (let c = 0; c < 2; c++) {
        for (let coord = 0; coord < 2; coord++) {
          flat.push(BigInt(encryptedVotes[choice][c][coord]));
        }
      }
    }
    const encryptedVotesHash = F.toObject(poseidon(flat)).toString();

    // Save encryptedVotes + encryptedVotesHash on success
    // Get next id for this voteId
    const lastId = db.prepare(
      "SELECT MAX(id) as maxId FROM permits WHERE voteId = ?"
    ).get(voteId);
    const nextId = (lastId?.maxId ?? 0) + 1;

    db.prepare(
      "INSERT INTO permits (voteId, id, encryptedVotes, encryptedVotesHash) VALUES (?, ?, ?, ?)"
    ).run(voteId, nextId, JSON.stringify(encryptedVotes), encryptedVotesHash);

    console.log("✓ EncryptedVotes saved to permits, id:", nextId);

    return res.json({
      status: "ok",
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      nullifier
    });

  } catch (err) {
    console.error("submit-vote error:", err);
    return res.status(500).json({ error: err.message || "server error" });
  }
});

module.exports = router;