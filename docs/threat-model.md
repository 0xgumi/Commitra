# Threat Model & Trust Assumptions

This document describes the **security assumptions and threat model**
of Commitra v1.5.

The goal is not to claim absolute trustlessness,
but to clearly define **what is trusted, what is enforced, and what is verifiable**.

---

## Adversary model

We consider the following potential adversaries:

- Malicious voters attempting to submit invalid or duplicate votes
- External observers attempting to link voters to votes
- A faulty or dishonest coordinator attempting to manipulate results

We assume standard cryptographic hardness assumptions.

---

## What is enforced cryptographically

The following properties are enforced by cryptography
and on-chain verification:

- Invalid votes cannot be accepted
- Duplicate voting is prevented
- Votes cannot be modified after submission
- The tally corresponds exactly to submitted votes
- Individual vote choices remain private

Any deviation from these properties
results in on-chain rejection or detectable inconsistency.

---

## Coordinator trust assumptions (v1.5)

In v1.5, the coordinator is responsible for:

- Orchestrating vote closure
- Aggregating encrypted votes
- Submitting the final tally proof

However:

- The coordinator **cannot fabricate votes**
- The coordinator **cannot alter valid results**
- Any omission or manipulation is detectable
  via on-chain verification artifacts

The coordinator is trusted only for **liveness and orchestration**,
not for correctness.

---

## What the coordinator cannot do

Even a malicious coordinator cannot:

- Learn individual vote choices
- Submit invalid votes without detection
- Modify the final tally result
- Bypass proof verification

Correctness is enforced by zero-knowledge proofs
and smart contract verification.

---

## Limitations

The following are known and accepted limitations of v1.5:

- Single logical coordinator role
- Bounded voter set in the demo environment
- Manual orchestration of vote finalization

These limitations do not compromise vote correctness
but affect operational decentralization.

---

## Forward security direction

Commitra v2 removes the remaining trust assumptions by:

- Introducing threshold decryption
- Distributing key material across multiple coordinators
- Eliminating single-party control over tally execution

See `docs/roadmap.md` for details.

---

## Summary

Commitra v1.5 minimizes trust
by enforcing correctness on-chain
while maintaining practical deployability.

Trust assumptions are explicit, bounded,
and progressively removed in future versions.
