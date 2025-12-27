# Demo Environment

This document explains the **design goals, constraints, and assumptions**
of the Commitra demo environment.

The demo is intentionally simplified to enable public evaluation,
while preserving the core security and verification properties
of the production system.

---

## Purpose of the demo

The demo is designed to allow reviewers and external participants to:

- Submit encrypted votes without revealing choices
- Observe on-chain verification of vote validity
- Verify that the final tally is computed correctly
- Confirm that results are immutable once finalized

The demo prioritizes **verifiability and accessibility** over full production realism.

---

## Key differences from the production configuration

The demo environment differs from the production system
in the following **intentional and explicit ways**.

These differences do not weaken the cryptographic guarantees
demonstrated by the demo.

---

## 1. Snapshot replacement mechanism

### Production
- Voting weights are derived from a predefined snapshot
- Each participant’s weight is fixed and externally determined

### Demo
- No snapshot is available for public participants
- Upon wallet connection and message signing, a **temporary weight**
  is assigned within a bounded range

This mechanism replaces the snapshot solely for demo purposes
and does not affect vote privacy or tally correctness.

---

## 2. Single vote session (single voteId)

### Production
- Multiple vote sessions (`voteId`) can coexist
- Each vote session is fully isolated

### Demo
- Each demo instance supports **a single vote session**
- This simplifies coordination and reduces operational overhead

Vote isolation and nullifier scoping are preserved internally,
even though only one session is exposed.

---

## 3. Bounded number of participants

### Production
- Designed to support large voter sets

### Demo
- Participation is capped (e.g., ≤ 80 voters)
- This limit ensures predictable execution time
  and stable demo operation

The bound does not alter vote validity or tally enforcement.

---

## 4. Public test network

- The demo operates exclusively on **Ethereum Sepolia**
- All transactions, proofs, and results are publicly visible
- No mainnet assets are involved

This enables independent verification without economic risk.

---

## What the demo demonstrates

Despite these constraints, the demo **faithfully demonstrates** that:

- Votes are submitted with valid zero-knowledge proofs
- Double voting is prevented
- Vote contents remain private
- The tally corresponds exactly to submitted votes
- Final results are verifiable and immutable on-chain

---

## What the demo does not demonstrate

The demo does **not** attempt to showcase:

- Snapshot generation logic
- Production-scale coordination
- High-throughput voting scenarios
- Operational automation

These aspects are covered by the production system
and are outside the scope of a public demo.

---

## Summary

The Commitra demo is a **controlled, public-facing simulation**
of the production system.

It preserves the system’s core security guarantees
while making evaluation accessible to external reviewers.

For verification steps, see `docs/verification.md`.  
For production assumptions, see `samples/production/README.md`.
