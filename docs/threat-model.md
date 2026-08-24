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

- No voter EOA appears on-chain; all transactions come from coordinator wallets
- No vote choice appears on-chain; only ciphertext hashes, proofs, nullifiers, and the final aggregate
- Nullifiers are voteId-scoped and derived from voter secrets; they do not link across votes
- The recorded result cannot be modified after `finalizeTally` (contract enforces one finalization per voteId)

These are the strongest properties the system has, and they are the ones the demo exercises.

---

## Against an ineligible outsider — enforced, with a caveat

- Submitting a vote requires a Groth16 proof of Merkle membership under a root the contract accepts; without a registered leaf there is no proof
- Leaf registration is gated by a short-lived, single-use admission token issued only after the server's snapshot check, plus a per-vote registration cap

Caveat: the admission token is a **server-side gate, not a cryptographic binding** — it deliberately encodes neither the EOA nor the leaf (to avoid storing an EOA↔leaf link). Nothing cryptographically ties a registered leaf's committed weight to a specific snapshot entry. Circuit-level snapshot binding is future work.

---

## Against a malicious voter — NOT fully enforced

A voter running a modified client **cannot**:

- Reuse a nullifier (each nullifier is spendable once per voteId, enforced on-chain)
- Have the server tally different ciphertexts than their proof committed to (server recomputes the ciphertext hash against the proof's public signal)

A voter running a modified client **can, currently**:

- **Vote multiple times from the same leaf.** The nullifier is `Poseidon(secret_nullifier, voteId)` where `secret_nullifier` is an unconstrained private input — the circuit does not bind it to the leaf or the voter's key. A standard client derives it deterministically (so honest re-votes are rejected), but a modified client can pick a fresh `secret_nullifier` per submission and generate unlimited valid proofs from one leaf. **One-voter-one-vote is not cryptographically enforced**
- Submit ciphertexts that are **not well-formed ElGamal encryptions** (invalid or small-subgroup curve points) — the circuit does not constrain point validity, and the server checks format only
- Submit plaintexts **outside `{0, weight}`** — no range constraint; weight splitting, negative or overflow encodings are not excluded by the proof
- Commit to a **weight that does not match any snapshot entry**, if they get past the server-side admission gate

Any of these can corrupt the aggregate or the tally's decodability. This is the most important gap in the current circuits. Detection after the fact is possible in some cases (a tally that fails to decode), but prevention is not proven.

---

## Against a malicious coordinator — NOT fully enforced

The coordinator **cannot**:

- Forge a vote proof for a leaf it does not control (Groth16 soundness, assuming the setup — see below). Note the limit of this statement: it does not prevent the coordinator from voting with leaves it *does* control — see root stuffing below
- Publish a tally result that is not the correct sum-and-decryption of *some* batch of 100 ciphertext sets (tally proof)
- Finalize a tally twice, or before voting is closed on-chain

The coordinator **can, currently**:

- **Decrypt individual ciphertexts.** It holds the single ElGamal private key. Aggregate-only decryption is a protocol norm the implementation follows, not an enforced property. Removing this requires threshold decryption (planned)
- **Stuff the voter set.** `updateRoot` is coordinator-only and marks any submitted root valid without constraint — a coordinator can insert leaves it controls (or an entirely fabricated tree) into the accepted root set and then vote with those leaves using valid proofs. Nothing on-chain ties accepted roots to the published snapshot
- **Choose the batch.** The tally proof commits to a batch hash, but the contract does not reconstruct that hash from the on-chain `VoteSubmitted` events. A coordinator could tally a batch that omits or substitutes submitted votes and still produce a valid proof. Omission/substitution is **not** automatically detectable on-chain today; a participant can only compare the on-chain event count against the claimed batch out-of-band
- **Censor**: decline to relay a vote (the vote then never appears on-chain at all)
- **Correlate EOA↔leaf at registration time** via session metadata (timing, source address, token issuance order), even though no such link is persisted
- **Delay** finalization indefinitely

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
| Voter EOA hidden from chain observers | Enforced |
| Nullifier single-use (per voteId) | Enforced on-chain |
| One vote per voter | **Not enforced** (nullifier not circuit-bound to the leaf; holds for standard clients only) |
| Tallied ciphertexts = proof-committed ciphertexts | Enforced (server + circuit hash binding) |
| Tally = correct sum + decryption of a committed batch | Enforced (proof) |
| Ciphertext well-formedness / plaintext range | **Not enforced** |
| Committed weight = snapshot weight | **Not enforced** (server-gated only) |
| Tallied batch = canonical submitted set | **Not enforced** |
| Aggregate-only decryption by coordinator | **Not enforced** (norm) |
| Censorship resistance | **Not provided** |
| Receipt-freeness | **Not provided** (intentional) |
