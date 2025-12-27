# Demo Samples

This directory documents the **Commitra demo environment**.

The demo is designed to allow external reviewers, researchers,
and community members to **interactively verify** Commitra’s
zero-knowledge voting system **without accessing private code**.

At the time of writing, no demo transactions are included yet.
_As of this release, the demo has not yet been exercised by external participants._
This is intentional.

---

## Purpose of the demo

The Commitra demo serves a different purpose than production samples.

- **Production samples** demonstrate representative, finalized evidence
  under full security assumptions.
- **Demo** provides a live environment where third parties can:
  - Cast votes
  - Observe on-chain verification
  - Confirm tally correctness
  - Validate privacy guarantees

The demo is explicitly designed for **external verification**.

---

## How the demo differs from production

The demo environment intentionally differs from the production system
to enable open participation.

### Key differences

| Aspect | Production | Demo |
|------|-----------|------|
| Voting weights | Snapshot-based | Randomly assigned (1–100) |
| Vote sessions | Multiple `voteId`s | Single `voteId` per demo |
| Participants | Predefined voters | Open to demo participants |
| Scale | Configurable | Max 80 votes |
| Chain | Ethereum Mainnet(planned) / L2 | Ethereum Sepolia |

### Why random weights?

In production, voting weights are derived from a predefined snapshot.

In the demo, participant addresses are unknown in advance.
To preserve the structure of weighted voting,
each participant is assigned a **random weight between 1 and 100**
at registration time.

This mechanism replaces the snapshot **for demonstration purposes only**.

---

## What you can verify in the demo

Even with these simplifications, the demo preserves all **core security properties**:

- Votes are encrypted client-side
- Individual vote choices are never revealed on-chain
- Each address can vote only once
- Votes are aggregated homomorphically
- Final results are verified via ZK proofs
- The tally result is immutably recorded on-chain

Participants can independently verify:

- Their vote was accepted on-chain
- The final tally transaction succeeded
- The recorded result matches the emitted events

---

## Demo workflow (high-level)

1. Request a demo access code
2. Connect a wallet (EOA)
3. Receive a random voting weight
4. Cast a vote (YES / NO / ABSTAIN)
5. Wait for the voting period to close
6. Verify the tally result on-chain

No gas fees are required from participants.

---

## Access to the demo

Demo access is currently granted **by request**.

If you are interested in testing the system, please reach out via:

- X (Twitter): https://x.com/0xgumi

Access codes are issued manually to ensure
controlled testing and meaningful feedback.

---

## Demo samples (future)

This directory will be populated with **externally generated samples**
once the demo is exercised by participants.

Planned artifacts include:

- Representative vote submission transactions
- Representative tally finalization transactions
- Verification notes derived from real demo usage

No synthetic or developer-generated demo transactions
will be included here.

---

## Important note

The demo exists to validate **verifiability and privacy**,
not to showcase internal cryptographic implementations.

Circuit code, proving keys, and coordinator secrets
are intentionally not exposed.

For architectural details and trust assumptions,
refer to the documentation in the `docs/` directory.
