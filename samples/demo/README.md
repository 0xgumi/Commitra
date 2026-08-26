# Demo Samples

This directory documents recorded runs of the **Commitra demo environment** on Ethereum Sepolia.

The demo is an **honest-client flow demonstration**: it shows the full lifecycle working end-to-end with cooperating participants. It does not demonstrate adversarial robustness — the trust assumptions and proof-scope gaps in [`../../docs/threat-model.md`](../../docs/threat-model.md) apply here unchanged.

---

## End-to-end walkthrough

A complete vote lifecycle recorded and verifiable on Sepolia:

**[View the full walkthrough](./walkthrough.md)** — vote creation, three encrypted vote submissions, vote closure, and on-chain tally finalization, with browser screenshots and transaction links.

The walkthrough follows the **self-verification pattern**: all three voters were wallets controlled by the operator, so the finalized result could be checked against known arithmetic totals. This detects changes to those totals; it does not prove exact batch identity (see [`../../docs/verification.md`](../../docs/verification.md) §3).

---

## How the demo differs from the Product configuration

| Aspect | Product configuration | Demo |
|--------|----------------------|------|
| Eligibility | Predefined snapshot (EOA → weight) | Auto-registered on first weight request |
| Voting weight | Fixed by snapshot | Random, 1–100, at registration |
| Participants per vote | Snapshot size | Capped at 80 |
| Network | Ethereum Sepolia | Ethereum Sepolia |

Circuit/contract source and the cryptographic flow are parallel, while Demo uses separate deployments, server/router entrypoints, database, configuration and UI disclosure. Open auto-registration is the main policy difference. Full context: [`../../docs/demo.md`](../../docs/demo.md).

(An earlier version of this page stated demo weights of "1–80"; the correct range in the code is 1–100. The 80 figure is the participant cap.)

---

## What a demo run shows

- Ballots encrypted client-side; browser-generated Groth16 proofs verified on-chain
- No vote choice and no voter EOA in any on-chain transaction
- Per-vote nullifier single-use, so the standard client cannot vote twice (a modified client could — the nullifier is not circuit-bound to the voter's leaf; see the threat model)
- A finalized on-chain result that matches participant-known sums when you vote with your own wallets

What it cannot show: that malicious clients or a malicious coordinator couldn't break these properties. That boundary is documented, precisely, in [`../../docs/REVISION19.md`](../../docs/REVISION19.md) §17.3.

---

## Access

Demo access is granted by request — DM [@0xgumi](https://x.com/0xgumi) with a sentence about your context. Participants pay no gas.
