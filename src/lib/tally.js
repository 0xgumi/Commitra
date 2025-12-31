// src/lib/tally.js
const path = require("path");
const fs = require("fs");
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const snarkjs = require("snarkjs");

// DB 연결
const Database = require("better-sqlite3");
const dbPath = path.join(__dirname, "../db/voting.db");
const db = new Database(dbPath);

// Coordinator key from environment
require('dotenv').config({ path: '.env.tally' });

const coordinatorPubkey = JSON.parse(process.env.COORDINATOR_PUBKEY);
const coordinatorPrivkey = process.env.COORDINATOR_PRIVKEY;

async function runTally(voteId = 1) {
  console.log("\n=== Tally 시작 ===\n");

  //----------------------------------
  // 1. 초기화
  //----------------------------------
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = babyJub.F;

  //----------------------------------
  // 2. DB에서 permits 로드 (id 순서)
  //----------------------------------
  console.log("1. Permits 로드 중...");
  const rows = db.prepare(
    "SELECT encryptedVotes, encryptedVotesHash FROM permits WHERE voteId = ? ORDER BY id"
  ).all(voteId);

  console.log(`✓ ${rows.length}개 permit 로드\n`);

  if (rows.length === 0) {
    console.error("❌ permit 없음");
    return null;
  }

  const nVoters = rows.length;

  //----------------------------------
  // 3. encryptedVotes 파싱 + encryptedVotesHashes 검증
  //----------------------------------
  console.log("2. encryptedVotesHashes 검증 중...");
  
  const encryptedVotesAll = [];
  const encryptedVotesHashes = [];

  for (const row of rows) {
    const enc = JSON.parse(row.encryptedVotes);
    encryptedVotesAll.push(enc);

    // flatten to 12 values for Poseidon
    const flat = [];
    for (let choice = 0; choice < 3; choice++) {
      for (let c = 0; c < 2; c++) {
        for (let coord = 0; coord < 2; coord++) {
          flat.push(BigInt(enc[choice][c][coord]));
        }
      }
    }
    const calculatedHash = F.toObject(poseidon(flat));
    
    // DB 값과 비교 검증
    if (calculatedHash.toString() !== row.encryptedVotesHash) {
      throw new Error(`encryptedVotesHash mismatch at permit id`);
    }
    
    encryptedVotesHashes.push(calculatedHash);
  }

  console.log("✓ encryptedVotesHashes 검증 완료\n");

  //----------------------------------
  // 4. encryptedBatchHash 계산 (Poseidon 체이닝)
  //----------------------------------
  console.log("3. encryptedBatchHash 계산 중...");

  let encryptedBatchHash = encryptedVotesHashes[0];
  for (let i = 1; i < nVoters; i++) {
    encryptedBatchHash = F.toObject(poseidon([encryptedBatchHash, encryptedVotesHashes[i]]));
  }

  console.log("✓ encryptedBatchHash:", encryptedBatchHash.toString(), "\n");

  //----------------------------------
  // 5. aggregatedCiphertext 계산 (동형 덧셈)
  //----------------------------------
  console.log("4. 동형 암호 합산 중...");

  const aggregatedCiphertext = [];

  for (let choice = 0; choice < 3; choice++) {
    let sumC1 = [
      F.e(encryptedVotesAll[0][choice][0][0]),
      F.e(encryptedVotesAll[0][choice][0][1])
    ];
    let sumC2 = [
      F.e(encryptedVotesAll[0][choice][1][0]),
      F.e(encryptedVotesAll[0][choice][1][1])
    ];

    for (let i = 1; i < nVoters; i++) {
      const c1Point = [
        F.e(encryptedVotesAll[i][choice][0][0]),
        F.e(encryptedVotesAll[i][choice][0][1])
      ];
      const c2Point = [
        F.e(encryptedVotesAll[i][choice][1][0]),
        F.e(encryptedVotesAll[i][choice][1][1])
      ];

      sumC1 = babyJub.addPoint(sumC1, c1Point);
      sumC2 = babyJub.addPoint(sumC2, c2Point);
    }

    aggregatedCiphertext.push([
      [F.toObject(sumC1[0]).toString(), F.toObject(sumC1[1]).toString()],
      [F.toObject(sumC2[0]).toString(), F.toObject(sumC2[1]).toString()]
    ]);
  }

  console.log("✓ 동형 합산 완료\n");

  //----------------------------------
  // 6. Decryption (BSGS)
  //----------------------------------
  console.log("5. Decrypting...");

  const privkey = BigInt(coordinatorPrivkey);
  const tallyResult = [];

  for (let choice = 0; choice < 3; choice++) {
    const C1 = [
      F.e(aggregatedCiphertext[choice][0][0]),
      F.e(aggregatedCiphertext[choice][0][1])
    ];
    const C2 = [
      F.e(aggregatedCiphertext[choice][1][0]),
      F.e(aggregatedCiphertext[choice][1][1])
    ];

    // M = C2 - privkey * C1
    const privkeyC1 = babyJub.mulPointEscalar(C1, privkey);
    const negPrivkeyC1 = [F.neg(privkeyC1[0]), privkeyC1[1]];
    const M = babyJub.addPoint(C2, negPrivkeyC1);

    // BSGS
    const result = await bsgsDiscreteLog(babyJub, F, M, 1_000_000);
    tallyResult.push(result.toString());
  }

  console.log("✓ Decryption complete\n");

  //----------------------------------
  // 7. Generate tally_input.json
  //----------------------------------
  console.log("6. Generating tally_input.json...");

  const tallyInput = {
    encryptedBatchHash: encryptedBatchHash.toString(),
    aggregatedCiphertext: aggregatedCiphertext,
    tallyResult: tallyResult,
    coordinatorPubkey: coordinatorPubkey,
    encryptedVotes: encryptedVotesAll,
    coordinatorPrivkey: coordinatorPrivkey.toString()
  };

  const inputPath = path.join(__dirname, `../../tally_input_${voteId}.json`);
  fs.writeFileSync(inputPath, JSON.stringify(tallyInput, null, 2));

  console.log("✓ tally_input.json saved\n");
  
  //----------------------------------
  // 8. Tally proof 생성
  //----------------------------------
  console.log("7. Tally proof 생성 중...");

  const wasmPath = path.join(__dirname, "../../circuits/tally/tally_js/tally.wasm");
  const zkeyPath = path.join(__dirname, "../../circuits/tally/tally_final.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    tallyInput,
    wasmPath,
    zkeyPath
  );

  // pbSwap 적용
  const pA = [proof.pi_a[0], proof.pi_a[1]];
  const pB = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]]
  ];
  const pC = [proof.pi_c[0], proof.pi_c[1]];

  console.log("✓ Tally proof 생성 완료\n");

  //----------------------------------
  // 9. tally_proof.json 저장
  //----------------------------------
  console.log("8. tally_proof.json 저장 중...");

  const proofOutput = { pA, pB, pC, publicSignals };
  const proofPath = path.join(__dirname, `../../tally_proof_${voteId}.json`);
  fs.writeFileSync(proofPath, JSON.stringify(proofOutput, null, 2));

  console.log("✓ tally_proof.json 저장 완료\n");

  //----------------------------------
  // 10. 결과 출력
  //----------------------------------
  console.log("=== 최종 투표 결과 ===");
  console.log("YES:", tallyResult[0]);
  console.log("NO:", tallyResult[1]);
  console.log("ABSTAIN:", tallyResult[2]);
  console.log("======================\n");

  return {
    yes: tallyResult[0],
    no: tallyResult[1],
    abstain: tallyResult[2],
    proof: proofOutput
  };
}

//----------------------------------
// BSGS 내장 함수
//----------------------------------
async function bsgsDiscreteLog(babyJub, F, targetPoint, maxRange) {
  const m = Math.ceil(Math.sqrt(maxRange));
  const G = babyJub.Base8;

  // Baby steps: G, 2G, 3G, ..., mG
  const babySteps = new Map();
  let current = [F.zero, F.one]; // identity

  for (let j = 0; j <= m; j++) {
    const key = F.toObject(current[0]).toString() + "," + F.toObject(current[1]).toString();
    babySteps.set(key, j);
    current = babyJub.addPoint(current, G);
  }

  // Giant step: -mG
  const mG = babyJub.mulPointEscalar(G, BigInt(m));
  const negMG = [F.neg(mG[0]), mG[1]];

  // Giant steps
  let gamma = targetPoint;
  for (let i = 0; i <= m; i++) {
    const key = F.toObject(gamma[0]).toString() + "," + F.toObject(gamma[1]).toString();
    if (babySteps.has(key)) {
      const j = babySteps.get(key);
      return BigInt(i * m + j);
    }
    gamma = babyJub.addPoint(gamma, negMG);
  }

  throw new Error("Discrete log not found in range");
}

// 직접 실행 시
if (require.main === module) {
  const voteId = process.argv[2] || 1;
  runTally(voteId)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runTally };
