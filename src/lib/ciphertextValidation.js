// Server-side sanity check of submitted ElGamal ciphertexts. The vote circuit
// does not constrain point validity, so without this a modified client could
// submit off-curve or small-subgroup points that corrupt the homomorphic sum.
// This is a mitigation, not a replacement for a circuit-level constraint.
const { buildBabyjub } = require("circomlibjs");

let babyJub = null;
let F = null;

const ready = (async () => {
  babyJub = await buildBabyjub();
  F = babyJub.F;
})();

const DECIMAL = /^[0-9]+$/;

function parseCanonicalCoord(value) {
  if (typeof value !== "string" || !DECIMAL.test(value)) return null;
  const v = BigInt(value);
  if (v >= F.p) return null;
  return v;
}

function isIdentity(point) {
  return F.isZero(point[0]) && F.eq(point[1], F.one);
}

// Returns { ok: true } or { ok: false, error }.
function validatePoint(coords, label, { rejectIdentity }) {
  const x = parseCanonicalCoord(coords[0]);
  const y = parseCanonicalCoord(coords[1]);
  if (x === null || y === null) {
    return { ok: false, error: `${label}: coordinate out of canonical field range` };
  }
  const point = [F.e(x), F.e(y)];
  if (!babyJub.inCurve(point)) {
    return { ok: false, error: `${label}: point not on curve` };
  }
  if (!babyJub.inSubgroup(point)) {
    return { ok: false, error: `${label}: point not in prime-order subgroup` };
  }
  if (rejectIdentity && isIdentity(point)) {
    return { ok: false, error: `${label}: identity point` };
  }
  return { ok: true };
}

// encryptedVotes must already be shape-validated (3 choices x [C1, C2] x [x, y]).
async function validateEncryptedVotes(encryptedVotes) {
  await ready;
  for (let choice = 0; choice < 3; choice++) {
    const c1 = validatePoint(encryptedVotes[choice][0], `choice ${choice} C1`, { rejectIdentity: true });
    if (!c1.ok) return c1;
    const c2 = validatePoint(encryptedVotes[choice][1], `choice ${choice} C2`, { rejectIdentity: false });
    if (!c2.ok) return c2;
  }
  return { ok: true };
}

module.exports = { validateEncryptedVotes };
