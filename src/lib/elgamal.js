// elgamal.js - BabyJubJub ElGamal 구현
const { buildBabyjub } = require("circomlibjs");

let babyJub;
let F;
let G; // Generator point

// 초기화
async function init() {
  if (!babyJub) {
    babyJub = await buildBabyjub();
    F = babyJub.F;
    G = babyJub.Base8; // BabyJubJub generator
  }
}

// 키 생성
async function generateKeys() {
  await init();
  
  const crypto = require("crypto");
  const privkey = BigInt("0x" + crypto.randomBytes(32).toString("hex")) % babyJub.subOrder;
  const pubkey = babyJub.mulPointEscalar(G, privkey);
  
  return { privkey, pubkey };
}

// 암호화
async function encrypt(plaintext, pubkey) {
  await init();
  
  const crypto = require("crypto");
  const r = BigInt("0x" + crypto.randomBytes(32).toString("hex")) % babyJub.subOrder;
  
  // C1 = r × G
  const C1 = babyJub.mulPointEscalar(G, r);
  
  // C2 = m × G + r × pubkey
  const mG = babyJub.mulPointEscalar(G, plaintext);
  const rPubkey = babyJub.mulPointEscalar(pubkey, r);
  const C2 = babyJub.addPoint(mG, rPubkey);
  
  return { C1, C2 };
}

// 동형 덧셈
async function add(cipher1, cipher2) {
  await init();
  
  const C1 = babyJub.addPoint(cipher1.C1, cipher2.C1);
  const C2 = babyJub.addPoint(cipher1.C2, cipher2.C2);
  
  return { C1, C2 };
}

// 복호화 (수정 완료)
async function decrypt(cipher, privkey) {
  await init();
  
  // S = privkey × C1
  const S = babyJub.mulPointEscalar(cipher.C1, privkey);
  
  // ❗ Twisted Edwards negation: (-x, y)
  const negS = [F.neg(S[0]), S[1]];
  
  // M = C2 + (-S)
  const M = babyJub.addPoint(cipher.C2, negS);
  
  return M; // m × G
}

// 항등원 (0 암호화용)
async function getIdentity() {
  await init();
  return {
    C1: [F.zero, F.one],
    C2: [F.zero, F.one]
  };
}

module.exports = {
  generateKeys,
  encrypt,
  add,
  decrypt,
  getIdentity
};
