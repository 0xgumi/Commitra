# Threat Model & Trust Assumptions

This document states, for Commitra v1.5, **what is cryptographically enforced, what is server-enforced, and what is assumed**. It replaces an earlier version of this document that claimed several properties as enforced which are not; those claims are retracted and corrected below.

The authoritative, mechanism-level statement is the proof-scope section of the specification: [`REVISION19.md`](REVISION19.md) §17.3–§17.5. This document is the same content organized by adversary.

---

## Adversaries considered

1. A **chain observer** — anyone reading the public blockchain
2. A **malicious voter** — an eligible participant running a modified client
3. A **malicious or compromised coordinator/server** — the single operator of the off-chain service
4. An **ineligible outsider** — someone not on the snapshot trying to vote

Standard cryptographic hardness assumptions apply throughout, plus one system-specific assumption: the Groth16 trusted setup (see below).

---

## Against a chain observer — enforced

- In the intended relayer flow, the contract records no participant EOA; state-changing vote transactions come from authorized coordinator wallets
- No plaintext vote choice or individual ciphertext coordinates appear on-chain. A vote transaction does publish the proof and all eight public signals: Merkle root, voterID, nullifier, encryptedVotesHash, voteId, pubkeyCommitment, chainId and voteHash
- Nullifiers are voteId-scoped and derived from voter secrets; they do not link across votes
- The recorded result cannot be modified after `finalizeTally` (contract enforces one finalization per voteId)

These are the strongest properties the system has, and they are the ones the demo exercises.

---

## Against an ineligible outsider — NOT identity-enforced

- Submitting a vote requires a Groth16 proof of membership under a root the contract accepts
- New leaf registration requires a short-lived bearer token issued after the **submitted EOA string** appears in the Product snapshot (Demo: after auto-registration), plus a per-vote total cap

The server does not verify ownership of the submitted EOA, does not limit token issuance to once per EOA, and does not bind the token to that EOA or to a leaf. A Basic-Auth holder who knows a snapshot-listed address can obtain its weight/token without owning it and can repeat admission until the total cap is consumed. The token is therefore an admission-rate gate, not identity authentication or cryptographic eligibility. Direction: authenticated once-per-EOA admission, followed by circuit-level eligibility/weight binding.

---

## Against a malicious voter — NOT fully enforced

A voter running a modified client **cannot**:

- Reuse a nullifier (each nullifier is spendable once per voteId, enforced on-chain)
- Have the server tally different ciphertexts than their proof committed to (server recomputes the ciphertext hash against the proof's public signal)

A voter running a modified client **can, currently**:

- **Vote multiple times from the same leaf.** The nullifier is `Poseidon(secret_nullifier, voteId)` where `secret_nullifier` is an unconstrained private input — the circuit does not bind it to the leaf or the voter's key. A standard client derives it deterministically (so honest re-votes are rejected), but a modified client can pick a fresh `secret_nullifier` per submission and generate unlimited valid proofs from one leaf. **One-voter-one-vote is not cryptographically enforced**
- Submit ciphertexts that are **not well-formed ElGamal encryptions** (invalid or small-subgroup curve points) — the circuit does not constrain point validity. The server now rejects off-curve, small-subgroup, non-canonical and identity-`C1` points before relaying, which closes this path *as long as the server is honest*; it is a mitigation, not a proof
- Submit plaintexts **outside `{0, weight}`** — no range constraint; weight splitting, negative or overflow encodings are not excluded by the proof
- Commit to a **weight that does not match any snapshot entry**, if they get past the server-side admission gate

Any of these can corrupt the aggregate or the tally's decodability. This is the most important gap in the current circuits. Detection after the fact is possible in some cases (a tally that fails to decode), but prevention is not proven.

---

## Against a malicious coordinator — NOT fully enforced

The coordinator **cannot**:

- Forge a vote proof for a leaf it does not control (Groth16 soundness, assuming the setup — see below). Note the limit of this statement: it does not prevent the coordinator from voting with leaves it *does* control — see root stuffing below
- Publish aggregate/result signals that do not satisfy the tally circuit's group equations for *some* private batch of 100 ciphertext sets
- Finalize a tally twice, or before voting is closed on-chain

The coordinator **can, currently**:

- **Decrypt individual ciphertexts.** It holds the single ElGamal private key. Aggregate-only decryption is a protocol norm the implementation follows, not an enforced property. Removing this requires threshold decryption (planned)
- **Stuff or preserve voter roots.** `updateRoot` marks any supplied bytes32 (including zero) valid without tying it to the snapshot. Every accepted historical root remains valid; there is no root revocation
- **Close early and irreversibly.** The contract enforces no deadline, quorum, minimum ballot count or root-existence condition
- **Set an unvalidated dummy-registration flag.** `registerDummyVotes` accepts arbitrary hashes/count (including an empty array), emits them and sets a boolean; it does not prove zero-weight padding or bind padding to the tally
- **Choose the batch.** The contracts do not reconstruct the tally commitment from `VoteSubmitted`/dummy events. Omission/substitution is not automatically detectable on-chain
- **Replay a tally proof across voteIds/deployments.** voteId, chainId and contract identity are absent from tally public signals. Per-voteId storage prevents only a second write to the same key; it does not bind the proof to that key
- **Publish a non-canonical tally scalar.** The circuit checks equality as a BabyJub group element, while neither circuit nor contract bounds the results to a unique canonical integer/tally range
- **Censor**: decline to relay a vote (the vote then never appears on-chain at all)
- **Correlate EOA↔leaf at registration time** via snapshot records, timing, source address, token order and logs. Demo registration also prints new EOAs to server stdout; the absence of an EOA column in `leaf_data` is not cryptographic unlinkability
- **Delay** finalization indefinitely

Administrative/deployment trust is also centralized: the deployment owner is an unremovable coordinator, there is no ownership-transfer function, and configured verifier/contract addresses are checked for nonzero rather than code identity. These are external provenance and operator assumptions.

The earlier version of this document claimed "omission or manipulation is detectable via on-chain verification artifacts" and "even a malicious coordinator cannot learn individual vote choices". Both claims were false for this implementation and are retracted.

---

## Trusted setup

Both proving keys were produced with a **single phase-2 contribution by the author**. If that contribution's randomness were retained, false proofs could be forged. Treat proof soundness accordingly. Artifact hashes and details: [`PROVENANCE.md`](PROVENANCE.md).

---

## Out of scope (intentional)

- **Receipt-freeness / anti-collusion**: a voter can reveal ElGamal randomness to prove how they voted. This design prioritizes data minimization (limiting what everyone, operator included, learns) over bribery resistance — a different threat model from MACI-style systems, not a stronger one
- **Availability**: single server, single operator

---

## Summary table

| Property | Status |
|----------|--------|
| Vote choice hidden from chain observers | Enforced |
| Participant EOA absent from intended relayed vote data | Enforced by the contract interface/relayer path; the contract does not require coordinator and participant addresses to differ |
| Nullifier single-use (per voteId) | Enforced on-chain |
| One vote per voter | **Not enforced** (nullifier not circuit-bound to the leaf; holds for standard clients only) |
| Tallied ciphertexts = proof-committed ciphertexts | Enforced (server + circuit hash binding) |
| Aggregate group element = homomorphic sum/decryption representation of a committed batch | Enforced (proof) |
| Unique canonical integer tally | **Not enforced** (scalar alias/range gap) |
| Ciphertext point validity | **Server-mitigated** (rejected before relay; not circuit-constrained) |
| Plaintext in `{0, weight}`, one choice | **Not enforced** |
| Committed weight = snapshot weight | **Not enforced** (server-gated only) |
| Tallied batch = canonical submitted set | **Not enforced** |
| Tally proof bound to voteId/deployment | **Not enforced** (cross-vote/deployment replay possible when state checks pass) |
| Dummy contents/count are canonical | **Not enforced** (only one post-close registration call is recorded) |
| Aggregate-only decryption by coordinator | **Not enforced** (norm) |
| Censorship resistance | **Not provided** |
| Receipt-freeness | **Not provided** (intentional) |
