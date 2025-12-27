# Commitra

Commitra is a **product-ready zero-knowledge voting system (v1.5)** designed to provide
**privacy-preserving, verifiable, and gas-efficient voting** with on-chain enforcement.

The system enables anonymous voting while ensuring that:
- every submitted vote is valid,
- the final tally is not tampered with,
- and all results are verifiable on-chain without revealing individual choices.

This repository intentionally **does not publish source code**.
Instead, it serves as a **verification and demo access portal** for reviewers, researchers,
and partners evaluating the system.

---

## What this is

- A **zero-knowledge voting system** with encrypted ballots and ZK-verified tallying  
- **Product-ready v1.5 implementation**, deployed and end-to-end verified  
- **On-chain verifiable results**, with off-chain computation for gas efficiency  
- Designed for real voting scenarios, not a research-only prototype  

---

## What’s new in v1.5 (Revision 17)

- Support for **multiple independent votes** via `voteId` separation  
- Vote-scoped nullifiers to prevent double voting across sessions  
- Strengthened tally integrity using encrypted batch hashing  
- Single-visit UX: registration, voting, and proof generation in one flow  
- Clear separation between demo assumptions and production assumptions  

> A detailed overview is available in [`docs/overview.md`](docs/overview.md).

---

## What you can verify today

Without accessing any private code, you can verify that Commitra works end-to-end.

### Public demo verification
- Vote submissions verified on Ethereum Sepolia  
- On-chain tally finalized with a zero-knowledge proof  
- Final results stored immutably on-chain  

Representative demo samples:
- [`samples/demo/vote-sample.md`](samples/demo/vote-sample.md)
- [`samples/demo/tally-sample.md`](samples/demo/tally-sample.md)

### Production-assumption verification
- Snapshot-based voting weights  
- Full vote lifecycle executed under intended security assumptions  

Representative production samples:
- [`samples/production/vote-sample.md`](samples/production/vote-sample.md)
- [`samples/production/tally-sample.md`](samples/production/tally-sample.md)

A step-by-step verification checklist is provided in
[`docs/verification.md`](docs/verification.md).

---

## Demo

A public demo is available on **Ethereum Sepolia** for hands-on evaluation.

- Demo access is **request-based**
- Participants can cast encrypted votes and verify the final tally on-chain
- The demo is intentionally simplified to maximize accessibility

**Important:**  
The demo environment differs from the production configuration.
These differences are documented explicitly in [`docs/demo.md`](docs/demo.md).

---

## Security & trust assumptions

In v1.5:
- A coordinator orchestrates vote closure and tally execution  
- Vote validity and tally correctness are enforced by **zero-knowledge proofs and on-chain verification**  
- Tampering, omission, or result manipulation is detectable on-chain  

The trust model and its scope are described concisely in
[`docs/threat-model.md`](docs/threat-model.md).

---

## Roadmap

Commitra is an actively maintained system.

- v1.5: Product-ready ZK voting with verifiable tally  
- v2: Removal of single-coordinator trust via threshold cryptography, scalability improvements, and cross-chain support  

Planned and exploratory items are clearly separated in
[`docs/roadmap.md`](docs/roadmap.md).

---

## Why is the code not public?

Commitra’s security relies heavily on cryptographic implementation details
(circuits, parameters, key handling, and operational constraints).

To prevent misuse and premature hard-forking of sensitive components,
this repository focuses on **verifiability rather than reproducibility**.

Common questions are addressed in [`docs/faq.md`](docs/faq.md).

---

## Contact

For demo access, review discussions, or collaboration inquiries:

- X (Twitter): [@0xgumi](https://x.com/0xgumi)

Please include a short description of your interest or evaluation context.
