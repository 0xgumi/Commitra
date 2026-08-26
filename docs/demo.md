# Demo Environment

The demo is a live, request-based deployment of Commitra on Ethereum Sepolia. It exists to let an outside party run the full honest-participant flow — encrypt, prove, submit, tally — and verify the result on-chain themselves.

**What the demo is:** an **honest-client flow demonstration** and a **self-verification device**.

**What the demo is not:** an adversarially secure election. All of the trust assumptions and proof-scope gaps in [`threat-model.md`](threat-model.md) apply to the demo exactly as they do to the rest of the system. The demo does not (and cannot) demonstrate resistance to malicious clients or a malicious coordinator.

---

## The intended way to use it: self-verification

Vote from **several wallets you control**. Record your own weights and choices. After finalization, check that the on-chain tally equals your sums.

This makes the arithmetic check yours: if the finalized totals differ from the sums you recorded, the run omitted, substituted or miscounted something that changed those totals. Matching totals do **not** establish exact batch identity, because a different batch can produce the same aggregate. A recorded honest-flow example: [`../samples/demo/walkthrough.md`](../samples/demo/walkthrough.md).

---

## Differences from the Product configuration

| Aspect | Product configuration | Demo |
|--------|----------------------|------|
| Eligibility | Predefined snapshot (EOA → weight) | Auto-registered on first weight request |
| Voting weight | Fixed by snapshot | Random, 1–100, assigned at registration |
| Participants per vote | Snapshot size (tree supports ~32k) | Capped at 80 |
| Server / database | Separate instance and DB | Separate instance and DB |

Product and Demo use byte-identical circuit/contract source and parallel encryption/proof/tally logic, but they are separate deployments with separate configuration, databases, server/router entrypoints and UI disclosure. Open auto-registration is the main protocol-policy difference.

Notes on the constraints:

- **Random weights** exist because demo participants aren't known in advance; they preserve the weighted-voting structure without a real snapshot.
- **The 80-voter cap** keeps each vote inside the fixed tally batch of 100 (padding fills the rest with zero-weight dummy votes). Slots are consumed as participants register; when a vote fills up, a new voteId is created on request.

---

## Practical details

- **Network**: Ethereum Sepolia only; no mainnet assets
- **Gas**: in the standard client flow, participant wallets sign but submit no transaction; coordinator/owner wallets relay and pay gas
- **Access**: request-based — DM [@0xgumi](https://x.com/0xgumi) with a sentence about your context. You'll get the URL, access password, and an active voteId
- **Contracts**: listed in the [README](../README.md#deployments-ethereum-sepolia); all demo transactions are publicly visible

---

## What a demo run shows — precisely

- The full lifecycle works end-to-end: registration → encrypted ballot → browser-side Groth16 proof (~30 s) → on-chain verification → homomorphic tally → on-chain finalization
- No plaintext vote choice or participant EOA appears in the intended on-chain vote path; proofs, public signals/hashes and the final aggregate are public
- Double voting from the same wallet is rejected (standard client)
- The finalized result can be compared with participant-known sums; equality checks arithmetic, not exact batch identity

What it does not show: that a *hostile* participant or operator couldn't break the properties above. That boundary is drawn, precisely, in [`REVISION19.md`](REVISION19.md) §17.3.
