# System Overview

Commitra is a research implementation of privacy-preserving, token-weighted voting that combines off-chain computation with on-chain Groth16 proof verification.

The design goal is **data minimization**: only the aggregate is published as a plaintext voting result. Proofs, public signals/hashes and the aggregate are on-chain; individual ciphertext coordinates remain server-side. The implemented tally path decrypts the aggregate rather than individual ballots, but in the current single-coordinator version this is an operator norm, not a cryptographically enforced property (see [`threat-model.md`](threat-model.md)).

This document is a high-level orientation. The precise specification — circuit I/O, contract internals, API, proof scope — is [`REVISION19.md`](REVISION19.md).

---

## Design goals

1. **Voter address privacy against chain observers**
   In the intended relayer flow, no participant EOA appears in vote calldata, state or events; proofs/public signals remain public, and the contract does not require coordinator and participant addresses to differ.

2. **Aggregate-only decryption by construction**
   Votes are ElGamal-encrypted and homomorphically summed; the tally pipeline decrypts the sum, not the parts. (The single coordinator key *could* decrypt parts — see trust assumptions.)

3. **Verifiable computation, precisely scoped**
   Vote validity and tally aggregation/decryption are ZK-proven and verified on-chain. What each proof does and does not constrain is stated exactly in [`REVISION19.md`](REVISION19.md) §17.3.

4. **Practical UX**
   Registration, encryption, and proof generation complete in a single browser session (~30 s proving time). Voters pay no gas.

---

## Components

### 1. Client (browser)

- Derives a deterministic BabyJubJub keypair and secrets from one wallet signature
- Encrypts the vote: `encrypt(weight)` for the chosen option, `encrypt(0)` for the others
- Generates the Groth16 vote proof (`vote.wasm` + `vote_final.zkey`, served statically)

### 2. Coordinator (off-chain server)

- Manages per-vote snapshots (EOA → weight) and the Merkle tree of voter commitments
- Relays all transactions; pays all gas
- After closing: homomorphically sums ciphertexts, decrypts the aggregate, generates the tally proof

The server stores EOA→weight records in `snapshot`; `leaf_data` has no explicit EOA column. Timing/session/order/logs can still correlate EOA↔leaf. Demo masks new registration EOAs in stdout and deletes a voteId's `snapshot` rows once its tally is finalized on-chain (process/infrastructure logs are separate). The unlinkability guarantee is against chain observers, not the server.

### 3. Smart contracts (Ethereum Sepolia)

- `VotingContract` + auto-generated verifier: checks each vote proof, enforces exact-nullifier uniqueness per voteId, and records coordinator-accepted roots
- `TallyContract` + auto-generated verifier: checks the tally proof and records result signals once per caller-supplied voteId; the proof itself is not voteId/deployment-bound and the result scalars are not canonically range-bounded

---

## Voting lifecycle

1. **Snapshot** — coordinator registers the eligible EOA → weight list for a voteId
2. **Registration** — voter derives secrets, registers a commitment leaf (gated by a short-lived admission token issued after the snapshot check)
3. **Voting** — encrypt, prove, submit; the server verifies the ciphertexts match the proof's public hash before relaying on-chain
4. **Finalize** — the standard script closes voting and pads the DB batch to 100 with zero-weight dummy votes; on-chain the contract validates only that dummy registration was called once after closure, not padding contents/count
5. **Tally** — homomorphic sum → aggregate decryption (BSGS discrete log) → tally proof → on-chain result

---

## Multi-vote support

Snapshots, Merkle-root/nullifier mappings and result storage are keyed per `voteId`. The same EOA can participate in multiple sessions, and the standard client derives vote-specific credentials. The tally proof itself is **not** voteId/deployment-bound, so tally finalization is not yet cryptographically isolated between voteIds.

---

## Status

v1.5 implementation, exercised end-to-end on Sepolia ([`../samples/`](../samples/)). Known gaps between "implemented" and "proven" are the core of the published material — start with the proof-scope table in [`REVISION19.md`](REVISION19.md) §17.3 and the [`threat-model.md`](threat-model.md). This is not a production system.
