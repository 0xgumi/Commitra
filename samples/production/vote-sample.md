# Product-Configuration Vote Submission Sample

**Environment:** Product configuration (snapshot-based weights)
**Network:** Ethereum Sepolia
**Vote session:** voteId = 11

---

## Transaction

| Field | Value |
|-------|-------|
| Type | Vote submission |
| Status | Success |
| Tx hash | `0x6ecc43b1d3be6a4308cc160d3fe490e7b50dada5b844e9f0f3ffc4636d1bad9d` |
| Block | `9923666` |
| Explorer | [View on Etherscan](https://sepolia.etherscan.io/tx/0x6ecc43b1d3be6a4308cc160d3fe490e7b50dada5b844e9f0f3ffc4636d1bad9d) |

---

## Contract

| Field | Value |
|-------|-------|
| VotingContract | `0xdd200F4cb1f559D6c3FC76752B9e6221e32254e1` |

---

## What this transaction establishes

- The on-chain Groth16 verifier accepted a proof of Merkle membership under a coordinator-accepted root, with an exact nullifier not previously used within voteId 11
- The proof's public signals bind a specific ciphertext hash — the ciphertexts the server stores for tallying are the ones this proof committed to
- No participant EOA, plaintext vote choice or individual ciphertext coordinates appear in the transaction. The proof and all eight public signals (root, voterID, nullifier, ciphertext hash, voteId, pubkey commitment, chainId, voteHash) are public

## What it does not establish

- That the encrypted ballot is a well-formed encryption of an in-range vote — the current circuit does not constrain this
- That this leaf holder voted only once — the nullifier is not circuit-bound to the leaf, so a modified client could vote again under a different nullifier
- That the committed weight matches the snapshot entry — server-gated, not circuit-bound
- That the caller owned the EOA submitted to `/weight` — the server does not currently verify EOA ownership

See [`../../docs/verification.md`](../../docs/verification.md) and [`../../docs/threat-model.md`](../../docs/threat-model.md).

---

## Verification steps

1. Open the transaction in the explorer
2. Confirm status is **Success**
3. Check for the `VoteSubmitted` event in logs
4. Confirm the nullifier had not appeared before for this voteId
