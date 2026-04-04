// const express = require("express");
// const router = express.Router();
// const db = require("../db/db");
// const circomlib = require("circomlibjs");
// const { votingContract, getNextVotingContract } = require("../config/onchain");
// const fs = require("fs");

// let poseidon, F;

// (async () => {
//   poseidon = await circomlib.buildPoseidon();
//   F = poseidon.F;
//   console.log("✓ Poseidon initialized");
// })();

// const ZERO = "0x" + "0".repeat(64);
// const DEPTH = 15;

// // =====================================
// // 데모 설정
// // =====================================
// const DEMO_VOTE_ID = 1;

// function getRandomWeight() {
//   return Math.floor(Math.random() * 100) + 1; // 1 ~ 100
// }

// // =====================================
// // DB Helper — leaf 리스트 불러오기
// // =====================================
// function loadLeavesFromDB(voteId) {
//   const rows = db.prepare(
//     "SELECT leaf FROM leaf_data WHERE voteId = ? ORDER BY leafIndex ASC"
//   ).all(voteId);
//   return rows.map(r => r.leaf);
// }

// // =====================================
// // Poseidon Hash (2-input)
// // =====================================
// function poseidonHash(a, b) {
//   return (
//     "0x" +
//     BigInt(F.toString(poseidon([BigInt(a), BigInt(b)])))
//       .toString(16)
//       .padStart(64, "0")
//   );
// }

// // =====================================
// // Merkle Tree Builder
// // =====================================
// function buildMerkleTree(leaves, depth = DEPTH) {
//   if (leaves.length === 0) return { layers: [], root: ZERO };

//   const layers = [];
//   layers.push([...leaves]);

//   for (let level = 0; level < depth; level++) {
//     const current = layers[level];
//     const next = [];

//     for (let i = 0; i < current.length; i += 2) {
//       const left = current[i];
//       const right = current[i + 1] ?? ZERO;
//       next.push(poseidonHash(left, right));
//     }

//     if (next.length === 0) next.push(ZERO);
//     layers.push(next);
//   }

//   return { layers, root: layers[depth][0] };
// }

// // =====================================
// // Merkle Path 생성
// // =====================================
// function getMerklePath(layers, leafIndex) {
//   const pathElements = [];
//   const pathIndices = [];
//   let idx = leafIndex;

//   for (let level = 0; level < layers.length - 1; level++) {
//     const layer = layers[level];
//     const isLeft = idx % 2 === 0;
//     const siblingIndex = isLeft ? idx + 1 : idx - 1;
//     const sibling = siblingIndex < layer.length ? layer[siblingIndex] : ZERO;

//     pathElements.push(BigInt(sibling).toString());
//     pathIndices.push(isLeft ? 0 : 1);
//     idx = Math.floor(idx / 2);
//   }

//   return { pathElements, pathIndices };
// }

// // =====================================
// // 1) Snapshot weight lookup (데모: 없으면 동적 생성)
// // =====================================
// router.post("/weight", (req, res) => {
//   try {
//     const { eoa } = req.body;
//     if (!eoa) return res.status(400).json({ error: "Missing eoa" });

//     const lowerEoa = eoa.toLowerCase();
//     let row = db.prepare(
//       "SELECT * FROM snapshot WHERE eoa = ?"
//     ).get(lowerEoa);

//     // 데모: 없으면 랜덤 weight로 자동 등록
//     if (!row) {
//       const weight = getRandomWeight();
//       db.prepare(
//         "INSERT INTO snapshot (eoa, weight) VALUES (?, ?)"
//       ).run(lowerEoa, weight);
      
//       console.log(`✓ Demo: New EOA registered with weight ${weight}:`, lowerEoa);
      
//       return res.json({ status: "ok", weight: weight.toString() });
//     }

//     return res.json({ status: "ok", weight: row.weight.toString() });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ error: "server error" });
//   }
// });

// // =====================================
// // 2) Leaf 등록 (eoa 저장 안 함)
// // =====================================
// router.post("/leaf", async (req, res) => {
//   try {
//     const { voteId, leaf } = req.body;

//     if (!voteId || !leaf)
//       return res.status(400).json({ error: "Missing voteId or leaf" });

//     // 이미 등록된 leaf인지 확인
//     const existing = db.prepare(
//       "SELECT leafIndex, root, pathElements, pathIndices FROM leaf_data WHERE voteId = ? AND leaf = ?"
//     ).get(voteId, leaf);

//     if (existing) {
//       // 이미 등록됨 → 기존 데이터 반환 (변경 없음)
//       return res.json({
//         status: "ok",
//         leaf,
//         leafIndex: existing.leafIndex,
//         root: existing.root,
//         pathElements: JSON.parse(existing.pathElements),
//         pathIndices: JSON.parse(existing.pathIndices),
//         txHash: null  // 이미 등록된 경우 txHash 없음
//       });
//     }

//     // 새 leaf → leafIndex 할당
//     const count = db.prepare(
//       "SELECT COUNT(*) AS c FROM leaf_data WHERE voteId = ?"
//     ).get(voteId).c;

//     // 데모 인원 제한: 80명
//     if (count >= 80) {
//       return res.status(400).json({ error: "Demo limit reached: maximum 80 voters" });
//     }

//     const leafIndex = count;

//     // 전체 leaves + 새 leaf로 머클 트리 생성
//     const existingLeaves = loadLeavesFromDB(voteId);
//     const allLeaves = [...existingLeaves, leaf];
//     const { layers, root } = buildMerkleTree(allLeaves, DEPTH);

//     // 새 leaf의 path만 계산
//     const { pathElements, pathIndices } = getMerklePath(layers, leafIndex);

//     // 새 leaf 저장 (기존 leaf는 건드리지 않음)
//     db.prepare(
//       "INSERT INTO leaf_data (voteId, leaf, leafIndex, root, pathElements, pathIndices) VALUES (?, ?, ?, ?, ?, ?)"
//     ).run(voteId, leaf, leafIndex, root, JSON.stringify(pathElements), JSON.stringify(pathIndices));

//     // root_history에 저장
//     db.prepare(
//       "INSERT OR IGNORE INTO root_history (voteId, root) VALUES (?, ?)"
//     ).run(voteId, root);

//     // 온체인 루트 업데이트
//     let txHash = null;
//     try {
//       const currentRoot = await votingContract.currentRoot(voteId);
//       if (currentRoot.toLowerCase() !== root.toLowerCase()) {
//         const contract = getNextVotingContract();
//         const tx = await contract.updateRoot(voteId, root);
//         await tx.wait();
//         txHash = tx.hash;
//         console.log("✓ Root updated on-chain:", root, "txHash:", txHash);
//       }
//     } catch (err) {
//       console.error("On-chain update error:", err);
//     }

//     console.log("✓ New leaf registered, index:", leafIndex);

//     return res.json({
//       status: "ok",
//       leaf,
//       leafIndex,
//       root,
//       pathElements,
//       pathIndices,
//       txHash
//     });

//   } catch (err) {
//     console.error("leaf insert error:", err);
//     return res.status(500).json({ error: "server error" });
//   }
// });

// // =====================================
// // 3) Merkle Proof 조회 (leaf로 조회, eoa 없음)
// // =====================================
// router.post("/proof", (req, res) => {
//   try {
//     const { voteId, leaf } = req.body;

//     if (!voteId || !leaf)
//       return res.status(400).json({ error: "Missing voteId or leaf" });

//     const row = db.prepare(
//       "SELECT leafIndex, root, pathElements, pathIndices FROM leaf_data WHERE voteId = ? AND leaf = ?"
//     ).get(voteId, leaf);

//     if (!row)
//       return res.status(404).json({ error: "Leaf not found" });

//     return res.json({
//       status: "ok",
//       leaf,
//       leafIndex: row.leafIndex,
//       root: row.root,
//       pathElements: JSON.parse(row.pathElements),
//       pathIndices: JSON.parse(row.pathIndices)
//     });

//   } catch (err) {
//     console.error("proof error:", err);
//     return res.status(500).json({ error: "server error" });
//   }
// });

// // =====================================
// // 4) Root 유효성 검증
// // =====================================
// router.post("/verify-root", (req, res) => {
//   try {
//     const { voteId, root } = req.body;

//     if (!voteId || !root)
//       return res.status(400).json({ error: "Missing voteId or root" });

//     const row = db.prepare(
//       "SELECT * FROM root_history WHERE voteId = ? AND root = ?"
//     ).get(voteId, root);

//     return res.json({
//       status: "ok",
//       valid: !!row
//     });

//   } catch (err) {
//     console.error("verify-root error:", err);
//     return res.status(500).json({ error: "server error" });
//   }
// });

// router.get("/coordinator-key", (req, res) => {
//   try {
//     const pubkey = JSON.parse(process.env.COORDINATOR_PUBKEY);
//     res.json({ pubkey });
//   } catch (err) {
//     console.error("coordinator-key error:", err);
//     res.status(500).json({ error: "Failed to load coordinator key" });
//   }
// });

// // =====================================
// // 5) 투표 제출 (proof 수신)
// // =====================================
// router.post("/submit-vote", async (req, res) => {
//   try {
//     const { pa, pb, pc, publicSignals, encryptedVotes } = req.body;

//     if (!pa || !pb || !pc || !publicSignals || !encryptedVotes) {
//       return res.status(400).json({ error: "Missing proof data" });
//     }

//     const merkleRoot = "0x" + BigInt(publicSignals[0]).toString(16).padStart(64, "0");
//     const voteId = publicSignals[4];
    
//     const isValidRoot = await votingContract.isValidRoot(voteId, merkleRoot);
    
//     if (!isValidRoot) {
//       return res.status(400).json({ error: "Invalid merkleRoot - not registered on-chain. Please wait a few seconds and try again." });
//     }

//     const nullifier = publicSignals[2];

//     // nullifier 중복 체크
//     const existingNullifier = db.prepare(
//       "SELECT * FROM used_nullifiers WHERE voteId = ? AND nullifier = ?"
//     ).get(voteId, nullifier);    

//     if (existingNullifier) {
//       return res.status(400).json({ error: "Nullifier already used - you have already voted." });
//     }

//     console.log("=== 투표 제출 수신 ===");
//     console.log("pa:", JSON.stringify(pa));
//     console.log("pb:", JSON.stringify(pb));
//     console.log("pc:", JSON.stringify(pc));
//     console.log("publicSignals:", JSON.stringify(publicSignals));
//     console.log("nullifier:", nullifier);

//     // on-chain 제출
//     const contract = getNextVotingContract();
//     const tx = await contract.submitVote(pa, pb, pc, publicSignals);
//     const receipt = await tx.wait();

//     // 성공 시 nullifier 저장
//     db.prepare(
//       "INSERT INTO used_nullifiers (nullifier, voteId, txHash) VALUES (?, ?, ?)"
//     ).run(nullifier, voteId, tx.hash);

//     console.log("✓ Vote submitted on-chain, tx:", tx.hash);
//     console.log("✓ Nullifier saved to DB");

//     // encryptedVotesHash 계산
//     const flat = [];
//     for (let choice = 0; choice < 3; choice++) {
//       for (let c = 0; c < 2; c++) {
//         for (let coord = 0; coord < 2; coord++) {
//           flat.push(BigInt(encryptedVotes[choice][c][coord]));
//         }
//       }
//     }
//     const encryptedVotesHash = F.toObject(poseidon(flat)).toString();

//     // 성공 시 encryptedVotes + encryptedVotesHash 저장
//     db.prepare(
//       "INSERT INTO permits (voteId, encryptedVotes, encryptedVotesHash) VALUES (?, ?, ?)"
//     ).run(voteId, JSON.stringify(encryptedVotes), encryptedVotesHash);

//     console.log("✓ EncryptedVotes saved to permits");

//     return res.json({
//       status: "ok",
//       txHash: tx.hash,
//       blockNumber: receipt.blockNumber,
//       nullifier
//     });

//   } catch (err) {
//     console.error("submit-vote error:", err);
//     return res.status(500).json({ error: err.message || "server error" });
//   }
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const db = require("../db/db_demo");
const circomlib = require("circomlibjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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
const MAX_VOTERS = 80; // Demo limit
const RECOVERY_LOG_DIR = path.join(__dirname, "../../recovery_logs");
const RECOVERY_LOG_FILE = path.join(RECOVERY_LOG_DIR, "submit_vote_recovery_demo.jsonl");
const LEAF_AUDIT_LOG_FILE = path.join(RECOVERY_LOG_DIR, "leaf_audit_demo.jsonl");
const LEAF_TOKEN_SECRET = process.env.LEAF_TOKEN_SECRET;
const LEAF_TOKEN_TTL_SEC = Number(process.env.LEAF_TOKEN_TTL_SEC || 600);
const usedLeafTokenJti = new Map();

if (!LEAF_TOKEN_SECRET) {
  throw new Error("LEAF_TOKEN_SECRET is required");
}
if (!Number.isInteger(LEAF_TOKEN_TTL_SEC) || LEAF_TOKEN_TTL_SEC <= 0) {
  throw new Error("LEAF_TOKEN_TTL_SEC must be a positive integer");
}

function writeSubmitVoteRecoveryLog(entry) {
  try {
    fs.mkdirSync(RECOVERY_LOG_DIR, { recursive: true });
    fs.appendFileSync(RECOVERY_LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("Failed to write submit-vote recovery log:", err);
  }
}

function writeLeafAuditLog(entry) {
  try {
    fs.mkdirSync(RECOVERY_LOG_DIR, { recursive: true });
    fs.appendFileSync(LEAF_AUDIT_LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("Failed to write leaf audit log:", err);
  }
}

function cleanupUsedLeafTokens(nowSec) {
  for (const [key, exp] of usedLeafTokenJti.entries()) {
    if (exp < nowSec) {
      usedLeafTokenJti.delete(key);
    }
  }
}

function signLeafTokenPayload(payloadB64) {
  return crypto
    .createHmac("sha256", LEAF_TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");
}

function issueLeafAdmissionToken(voteId) {
  const nowSec = Math.floor(Date.now() / 1000);
  cleanupUsedLeafTokens(nowSec);

  const payload = {
    voteId: String(voteId),
    jti: crypto.randomBytes(16).toString("hex"),
    exp: nowSec + LEAF_TOKEN_TTL_SEC
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sigB64 = signLeafTokenPayload(payloadB64);
  return `${payloadB64}.${sigB64}`;
}

function verifyLeafAdmissionToken(token, voteId) {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: "Missing leafAdmissionToken" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "Invalid leafAdmissionToken format" };
  }

  const [payloadB64, providedSigB64] = parts;
  const expectedSigB64 = signLeafTokenPayload(payloadB64);
  const providedSig = Buffer.from(providedSigB64, "base64url");
  const expectedSig = Buffer.from(expectedSigB64, "base64url");
  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    return { ok: false, error: "Invalid leafAdmissionToken signature" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid leafAdmissionToken payload" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  cleanupUsedLeafTokens(nowSec);

  if (String(payload.voteId) !== String(voteId)) {
    return { ok: false, error: "leafAdmissionToken voteId mismatch" };
  }
  if (!Number.isInteger(payload.exp) || payload.exp < nowSec) {
    return { ok: false, error: "leafAdmissionToken expired" };
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    return { ok: false, error: "leafAdmissionToken missing jti" };
  }

  const tokenKey = `${payload.voteId}:${payload.jti}`;
  if (usedLeafTokenJti.has(tokenKey)) {
    return { ok: false, error: "leafAdmissionToken already used" };
  }

  return { ok: true, payload, tokenKey };
}

function consumeLeafAdmissionToken(payload) {
  const tokenKey = `${payload.voteId}:${payload.jti}`;
  usedLeafTokenJti.set(tokenKey, payload.exp);
}

// =====================================
// Input Validation
// =====================================
const LEAF_REGEX = /^0x[0-9a-f]{64}$/i;
const EOA_REGEX = /^0x[0-9a-fA-F]{40}$/;

function isValidLeaf(v) {
  return typeof v === 'string' && LEAF_REGEX.test(v);
}

function isValidEoa(v) {
  return typeof v === 'string' && EOA_REGEX.test(v);
}

function isValidEncryptedVotes(ev) {
  if (!Array.isArray(ev) || ev.length !== 3) return false;
  for (const choice of ev) {
    if (!Array.isArray(choice) || choice.length !== 2) return false;
    for (const point of choice) {
      if (!Array.isArray(point) || point.length !== 2) return false;
      for (const coord of point) {
        if (typeof coord !== 'string') return false;
        try { BigInt(coord); } catch { return false; }
      }
    }
  }
  return true;
}

// =====================================
// Helper: Random weight for demo
// =====================================
function getRandomWeight() {
  return Math.floor(Math.random() * 100) + 1; // 1 ~ 100
}

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

const saveLeafDataTx = db.transaction((voteId, leaf, leafIndex, root, pathElements, pathIndices) => {
  db.prepare(
    "INSERT INTO leaf_data (voteId, leaf, leafIndex, root, pathElements, pathIndices) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(voteId, leaf, leafIndex, root, JSON.stringify(pathElements), JSON.stringify(pathIndices));

  db.prepare(
    "INSERT OR IGNORE INTO root_history (voteId, root) VALUES (?, ?)"
  ).run(voteId, root);
});

const saveSubmitVoteTx = db.transaction((voteId, nullifier, txHash, encryptedVotesJson, encryptedVotesHash) => {
  db.prepare(
    "INSERT INTO used_nullifiers (voteId, nullifier, txHash) VALUES (?, ?, ?)"
  ).run(voteId, nullifier, txHash);

  const lastId = db.prepare(
    "SELECT MAX(id) as maxId FROM permits WHERE voteId = ?"
  ).get(voteId);
  const nextId = (lastId?.maxId ?? 0) + 1;

  db.prepare(
    "INSERT INTO permits (voteId, id, encryptedVotes, encryptedVotesHash) VALUES (?, ?, ?, ?)"
  ).run(voteId, nextId, encryptedVotesJson, encryptedVotesHash);

  return nextId;
});

// =====================================
// 1) Snapshot weight lookup (Demo: auto-register with random weight)
// =====================================
router.post("/weight", (req, res) => {
  try {
    const { voteId, eoa } = req.body;
    if (!voteId) return res.status(400).json({ error: "Missing voteId" });
    if (!eoa) return res.status(400).json({ error: "Missing eoa" });
    if (!isValidEoa(eoa)) return res.status(400).json({ error: "Invalid eoa format" });

    // Check if voteId is active
    const activeVote = db.prepare(
      "SELECT * FROM active_votes WHERE voteId = ? AND closedAt IS NULL"
    ).get(voteId);

    if (!activeVote) return res.status(404).json({ error: "Vote not found or already closed" });

    const lowerEoa = eoa.toLowerCase();
    let row = db.prepare(
      "SELECT * FROM snapshot WHERE voteId = ? AND eoa = ?"
    ).get(voteId, lowerEoa);

    // Demo: auto-register with random weight if not exists
    if (!row) {
      const weight = getRandomWeight();
      db.prepare(
        "INSERT OR IGNORE INTO snapshot (voteId, eoa, weight) VALUES (?, ?, ?)"
      ).run(voteId, lowerEoa, weight);
      
      console.log(`✓ Demo: New EOA registered with weight ${weight}:`, lowerEoa);
      const leafAdmissionToken = issueLeafAdmissionToken(voteId);
      return res.json({
        status: "ok",
        weight: weight.toString(),
        leafAdmissionToken
      });
    }

    const leafAdmissionToken = issueLeafAdmissionToken(voteId);
    return res.json({
      status: "ok",
      weight: row.weight.toString(),
      leafAdmissionToken
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
});

// =====================================
// 2) Leaf Registration (EOA not stored)
// =====================================
router.post("/leaf", async (req, res) => {
  const { voteId, leaf, leafAdmissionToken } = req.body;

  if (!voteId || !leaf)
    return res.status(400).json({ error: "Missing voteId or leaf" });
  if (!isValidLeaf(leaf))
    return res.status(400).json({ error: "Invalid leaf format" });

  // #1 Fix: Poseidon 초기화 대기
  await ensurePoseidon();

  // #2 Fix: voteId별 mutex로 동시 요청 방지
  let release = null;
  let verifiedTokenPayload = null;
  try {
    release = await acquireLeafLock(voteId);
    // Check if leaf is already registered
    const existing = db.prepare(
      "SELECT leafIndex, root, pathElements, pathIndices FROM leaf_data WHERE voteId = ? AND leaf = ?"
    ).get(voteId, leaf);

    if (existing) {
      // Already registered -> return existing data
      writeLeafAuditLog({
        voteId: String(voteId),
        leaf,
        ts: new Date().toISOString(),
        result: "already-registered"
      });
      return res.json({
        status: "ok",
        leaf,
        leafIndex: existing.leafIndex,
        root: existing.root,
        pathElements: JSON.parse(existing.pathElements),
        pathIndices: JSON.parse(existing.pathIndices),
        txHash: null
      });
    }

    const tokenCheck = verifyLeafAdmissionToken(leafAdmissionToken, voteId);
    if (!tokenCheck.ok) {
      writeLeafAuditLog({
        voteId: String(voteId),
        leaf,
        ts: new Date().toISOString(),
        result: `rejected:${tokenCheck.error}`
      });
      return res.status(403).json({ error: tokenCheck.error });
    }
    verifiedTokenPayload = tokenCheck.payload;

    // New leaf -> assign leafIndex
    const count = db.prepare(
      "SELECT COUNT(*) AS c FROM leaf_data WHERE voteId = ?"
    ).get(voteId).c;
    const snapshotCount = db.prepare(
      "SELECT COUNT(*) AS c FROM snapshot WHERE voteId = ?"
    ).get(voteId).c;
    if (count >= snapshotCount) {
      writeLeafAuditLog({
        voteId: String(voteId),
        leaf,
        ts: new Date().toISOString(),
        result: "rejected:registration-cap"
      });
      return res.status(403).json({ error: "Leaf registration cap reached for this vote" });
    }

    // Demo limit: 80 voters
    if (count >= MAX_VOTERS) {
      writeLeafAuditLog({
        voteId: String(voteId),
        leaf,
        ts: new Date().toISOString(),
        result: "rejected:demo-max-voters"
      });
      return res.status(400).json({ error: `Demo limit reached: maximum ${MAX_VOTERS} voters` });
    }

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

    // 온체인 성공 후 DB 저장 (트랜잭션)
    saveLeafDataTx(voteId, leaf, leafIndex, root, pathElements, pathIndices);
    consumeLeafAdmissionToken(verifiedTokenPayload);

    console.log("✓ New leaf registered, index:", leafIndex);
    writeLeafAuditLog({
      voteId: String(voteId),
      leaf,
      ts: new Date().toISOString(),
      result: "registered"
    });

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
    writeLeafAuditLog({
      voteId: String(voteId),
      leaf,
      ts: new Date().toISOString(),
      result: "error"
    });
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

// =====================================
// Coordinator key
// =====================================
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
    const { voteId, token } = req.body;
    if (!token || token !== process.env.INTERNAL_API_TOKEN) {
      return res.status(403).json({ error: "Unauthorized" });
    }
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
    if (!isValidEncryptedVotes(encryptedVotes)) {
      return res.status(400).json({ error: "Invalid encryptedVotes format" });
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
    const proofEncryptedVotesHash = BigInt(publicSignals[3]).toString();

    if (encryptedVotesHash !== proofEncryptedVotesHash) {
      return res.status(400).json({ error: "encryptedVotesHash mismatch with proof publicSignals[3]" });
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

    let nextId;
    try {
      nextId = saveSubmitVoteTx(
        voteId,
        nullifier,
        tx.hash,
        JSON.stringify(encryptedVotes),
        encryptedVotesHash
      );
    } catch (dbErr) {
      writeSubmitVoteRecoveryLog({
        timestamp: new Date().toISOString(),
        voteId: String(voteId),
        nullifier: String(nullifier),
        txHash: tx.hash,
        encryptedVotes,
        encryptedVotesHash,
        reason: dbErr.message || "unknown DB error"
      });
      console.error("submit-vote DB persistence failed after on-chain success:", dbErr);
      return res.status(500).json({
        error: "On-chain vote succeeded but DB persistence failed. Recovery log written."
      });
    }

    console.log("✓ Vote submitted on-chain, tx:", tx.hash);
    console.log("✓ Nullifier + encryptedVotes saved to DB");

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
