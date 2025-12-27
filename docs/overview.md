# System Overview

Commitra is a **privacy-preserving voting system**
that combines off-chain computation with on-chain verification
using zero-knowledge proofs.

The system is designed to ensure that:
- individual votes remain private,
- invalid or duplicate votes are rejected,
- and the final tally is verifiable and immutable on-chain.

This document provides a **high-level architectural overview**
without exposing implementation details.

---

## Design goals

Commitra is built around the following principles:

1. **Privacy by design**  
   Individual vote choices are never revealed,
   even to the system operator.

2. **Verifiable correctness**  
   All critical steps are enforced or validated on-chain.

3. **Gas efficiency**  
   Heavy computation is performed off-chain,
   while correctness is enforced via succinct proofs.

4. **Practical UX**  
   Voters can complete registration, voting,
   and proof generation in a single browser session.

---

## High-level architecture

The system consists of three primary components:

### 1. Client (Browser)

- Generates cryptographic secrets locally
- Encrypts vote choices
- Generates zero-knowledge proofs
- Never exposes private inputs

### 2. Coordinator (Off-chain service)

- Manages vote lifecycle orchestration
- Relays transactions to the blockchain
- Aggregates encrypted votes for tallying

The coordinator **cannot link voters to their votes**
and cannot alter valid results without detection.

### 3. Smart contracts (On-chain)

- Verify zero-knowledge proofs
- Enforce vote validity and uniqueness
- Record final tally results immutably

---

## Voting lifecycle

At a high level, each vote session follows this flow:

1. **Registration**  
   Eligible participants register commitments
   without revealing their identity.

2. **Voting**  
   Votes are encrypted and submitted
   together with a zero-knowledge proof.

3. **Submission**  
   Proofs are verified on-chain,
   and duplicate votes are rejected.

4. **Tally**  
   Encrypted votes are aggregated off-chain,
   and the final result is verified on-chain
   using a zero-knowledge proof.

---

## Multi-vote support

Commitra supports multiple independent vote sessions.

- Each vote session is identified by a unique identifier
- Vote validity, nullifiers, and results are isolated per session
- Participants may take part in multiple sessions
  without linkability across votes

---

## Verification-first design

Commitra is intentionally structured so that:

- Correctness can be verified without access to source code
- On-chain artifacts are sufficient to detect manipulation
- Off-chain computation cannot silently affect outcomes

For verification steps, see `docs/verification.md`.

---

## Summary

Commitra is a **production-ready voting system**
focused on privacy, verifiability, and practical deployment.

The system demonstrates that secure voting
can be achieved without sacrificing usability
or relying on opaque trust assumptions.
