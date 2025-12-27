# Frequently Asked Questions

This document addresses common questions
about Commitra’s design and repository structure.

---

## Why is the source code not public?

Commitra’s security relies on sensitive cryptographic implementation details.

This repository focuses on **verifiability rather than reproducibility**,
allowing reviewers to validate correctness
without exposing attack surfaces prematurely.

---

## Can the results be trusted without code access?

Yes.

All critical correctness properties are enforced on-chain
via zero-knowledge proof verification.

Public artifacts are sufficient
to detect invalid behavior or manipulation.

---

## Is this a research prototype?

No.

Commitra v1.5 is a **product-ready system**
that has been fully deployed and verified end-to-end.

---

## What is the purpose of the demo?

The demo provides a publicly accessible environment
to evaluate the system’s core guarantees.

It is a controlled simulation,
not a substitute for production deployment.

---

## Can the coordinator manipulate results?

The coordinator cannot:
- Fabricate votes
- Alter valid vote contents
- Change the final tally without detection

However, in v1.5 the coordinator can:
- Choose not to include a vote (censorship)
- Delay finalization

These limitations are addressed in v2
via threshold cryptography and distributed coordination.

---

## Will Commitra become fully trustless?

Yes.

Removing remaining trust assumptions
is a primary goal of v2,
via threshold cryptography and distributed coordination.

---

## Who is this system intended for?

Commitra is designed for:

- Governance systems
- DAOs and organizations
- Research and evaluation of private voting
- Fellowship and grant review contexts
