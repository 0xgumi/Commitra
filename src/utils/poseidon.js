const { buildPoseidon } = require("circomlibjs");

let poseidon = null;
let F = null;

(async () => {
  poseidon = await buildPoseidon();
  F = poseidon.F;
})();

function hash2(a, b) {
  const h = poseidon([BigInt(a), BigInt(b)]);
  return "0x" + BigInt(F.toString(h)).toString(16).padStart(64, "0");
}

function buildRoot(leaves, depth = 15) {
  if (leaves.length === 0) return "0x" + "0".repeat(64);

  let level = leaves.slice();
  for (let i = 0; i < depth; i++) {
    const next = [];
    for (let j = 0; j < level.length; j += 2) {
      const left = level[j];
      const right = level[j + 1] || "0x" + "0".repeat(64);
      next.push(hash2(left, right));
    }
    level = next;
  }
  return level[0];
}

module.exports = {
  hash2,
  buildRoot
};
