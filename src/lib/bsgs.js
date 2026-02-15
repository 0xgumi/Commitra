// bsgs.js - Baby-step Giant-step for Discrete Log
const { buildBabyjub } = require("circomlibjs");

let babyJub;
let F;
let G;

// 초기화
async function init() {
  if (!babyJub) {
    babyJub = await buildBabyjub();
    F = babyJub.F;
    G = babyJub.Base8;
  }
}

// BSGS: M = m × G → m 찾기
async function discreteLog(M, maxRange = 100000000000) {
  await init();
  
  const sqrtN = Math.ceil(Math.sqrt(maxRange));
  
  // Baby step: j × G 저장
  const babySteps = new Map();
  let current = [F.zero, F.one]; // identity
  
  for (let j = 0; j < sqrtN; j++) {
    const key = `${F.toString(current[0])},${F.toString(current[1])}`;
    babySteps.set(key, j);
    
    if (j === 0) {
      // 첫 단계는 G 더하기
      current = G;
    } else {
      current = babyJub.addPoint(current, G);
    }
  }
  
  // Giant step: M - i × (sqrtN × G)
  const giantStep = babyJub.mulPointEscalar(G, BigInt(sqrtN));
  let gamma = M;
  
  for (let i = 0; i < sqrtN; i++) {
    const key = `${F.toString(gamma[0])},${F.toString(gamma[1])}`;
    
    if (babySteps.has(key)) {
      const j = babySteps.get(key);
      const m = i * sqrtN + j;
      return BigInt(m);
    }
    
    // gamma = gamma - giantStep
    // Twisted Edwards curve: negation of (x, y) is (-x, y)
    const negGiantStep = [F.neg(giantStep[0]), giantStep[1]];
    gamma = babyJub.addPoint(gamma, negGiantStep);
  }
  
  throw new Error(`Discrete log not found in range [0, ${maxRange}]`);
}

module.exports = {
  discreteLog
};