const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { buildBabyjub } = require("circomlibjs");
const { validateEncryptedVotes } = require("../src/lib/ciphertextValidation");

let babyJub, F, G, pubkey;

test.before(async () => {
  babyJub = await buildBabyjub();
  F = babyJub.F;
  G = babyJub.Base8;
  const sk = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % babyJub.subOrder;
  pubkey = babyJub.mulPointEscalar(G, sk);
});

function toCoords(point) {
  return [F.toObject(point[0]).toString(), F.toObject(point[1]).toString()];
}

function encrypt(message, r) {
  const C1 = babyJub.mulPointEscalar(G, r);
  const C2 = babyJub.addPoint(babyJub.mulPointEscalar(G, message), babyJub.mulPointEscalar(pubkey, r));
  return [toCoords(C1), toCoords(C2)];
}

function randomScalar() {
  return BigInt("0x" + crypto.randomBytes(32).toString("hex")) % babyJub.subOrder;
}

function validBallot(weight = 7n, choice = 0) {
  return [0, 1, 2].map((i) => encrypt(i === choice ? weight : 0n, randomScalar()));
}

test("well-formed ballot passes", async () => {
  assert.deepEqual(await validateEncryptedVotes(validBallot()), { ok: true });
});

test("dummy ballot (r=1, weight=0 for all choices) passes", async () => {
  const zero = encrypt(0n, 1n);
  assert.deepEqual(await validateEncryptedVotes([zero, zero, zero]), { ok: true });
});

test("C1 identity point is rejected", async () => {
  const ballot = validBallot();
  ballot[1][0] = ["0", "1"];
  const res = await validateEncryptedVotes(ballot);
  assert.equal(res.ok, false);
  assert.match(res.error, /identity/);
});

test("off-curve point is rejected", async () => {
  const ballot = validBallot();
  ballot[0][1] = ["1", "2"];
  const res = await validateEncryptedVotes(ballot);
  assert.equal(res.ok, false);
  assert.match(res.error, /not on curve/);
});

test("small-order (torsion) point is rejected", async () => {
  // (0, -1) is on the curve with order 2, so it is outside the prime-order subgroup
  const torsion = ["0", (F.p - 1n).toString()];
  const ballot = validBallot();
  ballot[2][1] = torsion;
  const res = await validateEncryptedVotes(ballot);
  assert.equal(res.ok, false);
  assert.match(res.error, /subgroup/);
});

test("valid point shifted by a torsion point is rejected", async () => {
  const torsion = [F.zero, F.neg(F.one)];
  const ballot = validBallot();
  const shifted = babyJub.addPoint(babyJub.mulPointEscalar(G, randomScalar()), torsion);
  ballot[0][0] = toCoords(shifted);
  const res = await validateEncryptedVotes(ballot);
  assert.equal(res.ok, false);
  assert.match(res.error, /subgroup/);
});

test("non-canonical coordinate (>= p alias) is rejected", async () => {
  const ballot = validBallot();
  const aliased = (BigInt(ballot[0][0][0]) + F.p).toString();
  ballot[0][0][0] = aliased;
  const res = await validateEncryptedVotes(ballot);
  assert.equal(res.ok, false);
  assert.match(res.error, /canonical/);
});

test("negative or non-decimal coordinate is rejected", async () => {
  for (const bad of ["-1", "0x1f", "12abc", ""]) {
    const ballot = validBallot();
    ballot[1][1][1] = bad;
    const res = await validateEncryptedVotes(ballot);
    assert.equal(res.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});
