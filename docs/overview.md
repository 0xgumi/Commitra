# System Overview

Commitra is a research implementation of privacy-preserving, token-weighted voting that combines off-chain computation with on-chain Groth16 proof verification.

The design goal is **data minimization**: the system publishes only the aggregate result, and by protocol design no individual vote is decrypted — while being explicit that, in the current single-coordinator version, this is a norm the operator follows, not a property cryptography enforces (see [`threat-model.md`](threat-model.md)).

This document is a high-level orientation. The precise specification — circuit I/O, contract internals, API, proof scope — is [`REVISION19.md`](REVISION19.md).

---

## Design goals

1. **Voter address privacy against chain observers**
   The voter's EOA never appears on-chain; all transactions are relayed by the coordinator. Nothing on-chain links an address to a vote.

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

The server stores leaves without EOAs. It could, however, correlate EOA↔leaf at registration time through session metadata — the unlinkability guarantee is against chain observers, not against the server itself.

### 3. Smart contracts (Ethereum Sepolia)

- `VotingContract` + auto-generated verifier: checks each vote proof, enforces per-vote nullifier uniqueness, records Merkle roots
- `TallyContract` + auto-generated verifier: checks the tally proof and records the final result immutably per voteId

---

## Voting lifecycle

1. **Snapshot** — coordinator registers the eligible EOA → weight list for a voteId
2. **Registration** — voter derives secrets, registers a commitment leaf (gated by a short-lived admission token issued after the snapshot check)
3. **Voting** — encrypt, prove, submit; the server verifies the ciphertexts match the proof's public hash before relaying on-chain
4. **Finalize** — voting closed on-chain; batch padded to 100 with zero-weight dummy votes
5. **Tally** — homomorphic sum → aggregate decryption (BSGS discrete log) → tally proof → on-chain result

---

## Multi-vote support

Vote sessions are isolated per `voteId`: separate snapshots, Merkle trees, nullifier sets, and results. The same EOA can participate in multiple sessions; nullifiers are voteId-scoped, so votes are not linkable across sessions on-chain.

---

## Status

v1.5 implementation, exercised end-to-end on Sepolia ([`../samples/`](../samples/)). Known gaps between "implemented" and "proven" are the core of the published material — start with the proof-scope table in [`REVISION19.md`](REVISION19.md) §17.3 and the [`threat-model.md`](threat-model.md). This is not a production system.
