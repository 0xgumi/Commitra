# Verification Guide

This document explains **what can be verified today** for Commitra
without access to any private source code.

Verification is based on **on-chain artifacts**, **transaction records**,
and **zero-knowledge proof validation**, all of which are publicly observable.

---

## Scope of verification

Using the materials linked in this repository, you can verify that:

- Votes are submitted with valid zero-knowledge proofs
- Double voting is prevented
- Votes are tallied correctly without revealing individual choices
- Final results are immutably recorded on-chain
- The demo and production samples follow clearly stated assumptions

This guide does **not** describe how the system is implemented.
It focuses exclusively on **where and how correctness can be checked**.

---

## 1. Vote submission verification

### What to verify
- Each vote submission corresponds to a successful on-chain transaction
- The submitted proof is verified on-chain
- Duplicate voting is prevented via vote-scoped nullifiers

### How to verify
1. Open a representative vote submission transaction:
   - Demo sample:  
     `samples/demo/vote-sample.md`
   - Production sample:  
     `samples/production/vote-sample.md`

2. In the transaction details, confirm:
   - The transaction status is **Success**
   - A zero-knowledge proof verification occurred
   - A vote submission event was emitted

3. Confirm that:
   - The same participant cannot submit two votes
   - Attempts to reuse a nullifier are rejected on-chain

---

## 2. Vote integrity verification

### What to verify
- Submitted votes cannot be altered or removed
- Any omission or manipulation would be detectable

### How to verify
1. Each vote submission includes a cryptographic commitment
   recorded on-chain as part of the transaction data.

2. These commitments are later bound into the tally process
   through a public batch hash.

3. The batch hash used for tallying can be traced back to
   the set of submitted votes.

This ensures that the tally corresponds exactly to the submitted votes.

---

## 3. Tally verification

### What to verify
- The final tally is computed from the submitted encrypted votes
- The tally result is validated by a zero-knowledge proof
- The result is stored immutably on-chain

### How to verify
1. Open a representative tally finalization transaction:
   - Demo sample:  
     `samples/demo/tally-sample.md`
   - Production sample:  
     `samples/production/tally-sample.md`

2. In the transaction details, confirm:
   - The transaction status is **Success**
   - A zero-knowledge proof verification occurred
   - The final vote counts were recorded on-chain

3. Verify that:
   - The recorded result matches the public inputs of the proof
   - The tally was finalized only after voting was closed

---

## 4. Demo vs production verification context

Verification artifacts are grouped into two categories:

### Demo samples
- Generated from the public demo environment
- Use simplified assumptions for accessibility
- Intended to demonstrate end-to-end verifiability

See:
- `samples/demo/README.md`

### Production samples
- Generated under intended production assumptions
- Use snapshot-based voting weights
- Reflect the system’s real security model

See:
- `samples/production/README.md`

This separation ensures that demo constraints
are not confused with production limitations.

---

## 5. What is enforced on-chain

From the on-chain records alone, you can verify that:

- Invalid votes cannot be accepted
- Double voting is prevented
- The tally corresponds to the submitted votes
- The final result cannot be modified after publication

No trust in off-chain computation is required
to validate the correctness of the final outcome.

---

## 6. What this verification does not cover

This guide intentionally does **not** expose:

- Circuit source code
- Cryptographic parameters
- Key material or key management details
- Internal server logic

These components are outside the scope of public verification
and are not required to validate correctness of the results.

---

## Summary

Commitra is verifiable without code access because:

- All critical state transitions are enforced on-chain
- Zero-knowledge proofs bind off-chain computation to on-chain verification
- Public artifacts are sufficient to detect manipulation or inconsistency

For demo assumptions, see `docs/demo.md`.  
For trust assumptions, see `docs/threat-model.md`.
